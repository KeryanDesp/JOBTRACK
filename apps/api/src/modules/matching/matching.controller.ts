import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { JobAnalysisStatus } from '@prisma/client';
import {
  analyzeJobsSchema,
  type AnalyzeJobsInput,
  type AnalyzeJobsResponseDto,
  type MatchScoreDto,
} from '@jobtrack/shared';
import { rateLimitKey } from '../../common/rate-limit.guard';
import { RateLimiterService } from '../../common/rate-limiter.service';
import { UserRateLimit, UserRateLimitGuard } from '../../common/user-rate-limit.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { AiNotConfiguredError, AiUnavailableError } from './job-analysis.errors';
import { JobAnalysisService, type JobAnalysisOutcomeStatus } from './job-analysis.service';
import { MatchService } from './match.service';

/** Nom partagé par le budget compté manuellement (`POST /jobs/analyses`, une frappe par offre
 * réellement lancée) et par la garde locale du retry (`@UserRateLimit`, tâche 6) : les deux
 * routes consomment le même budget « 60 analyses / heure / utilisateur » (spec §4). */
const JOB_ANALYSIS_BUCKET = 'job-analysis';
const JOB_ANALYSIS_RATE_LIMIT = { limit: 60, windowSeconds: 3600 } as const;

const RATE_LIMITED_MESSAGE = "Trop d'analyses. Réessayez dans une heure.";
const AI_NOT_CONFIGURED_MESSAGE = "L'analyse des offres nécessite le service IA (non configuré).";
const AI_UNAVAILABLE_MESSAGE = 'Le service IA ne répond pas. Réessayez.';
const JOB_NOT_FOUND_MESSAGE = 'Offre introuvable.';

/** Une offre déjà `DONE` (à la version courante, vérifiée par `JobAnalysisService` lui-même) ne
 * compte jamais sur le budget : c'est le seul statut qui n'a jamais besoin d'un nouvel appel
 * Claude. Un `FAILED` (jamais rejoué automatiquement) ni une offre inconnue ne comptent pas non
 * plus contre le budget de cet appel-ci : seule une relance explicite (`retry`) les concerne. */
function needsAnalysis(status: JobAnalysisStatus | null): boolean {
  return status === null || status === 'PENDING';
}

/**
 * Routes de correspondance (spec §6, tâche 6) : montées sous `/jobs`, aux côtés de
 * `JobsController` (contrôleur distinct, mêmes garanties d'authentification/CSRF par défaut).
 * Le contrôleur orchestre `JobAnalysisService`/`MatchService` — ni l'un ni l'autre ne connaît
 * Nest ni les codes HTTP, cette traduction se fait ici (même principe que `CvImportController`).
 */
@Controller('jobs')
export class MatchingController {
  constructor(
    private readonly jobAnalysis: JobAnalysisService,
    private readonly matchService: MatchService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Post('analyses')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Body(new ZodValidationPipe(analyzeJobsSchema)) body: AnalyzeJobsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<AnalyzeJobsResponseDto> {
    const userId = request.user.id;
    const statuses = await this.jobAnalysis.getStatus(body.jobIds);
    const needed = body.jobIds.filter((jobId) => needsAnalysis(statuses.get(jobId) ?? null));

    let analyzed = 0;
    let failed = 0;
    let pending = 0;

    if (needed.length > 0) {
      if (!this.jobAnalysis.isConfigured()) throw this.aiNotConfigured();

      // Décompte manuel, une frappe par offre réellement candidate à l'analyse (spec §4, §8) :
      // s'arrête dès que le budget est épuisé, les offres restantes ne sont jamais tentées.
      const key = rateLimitKey(JOB_ANALYSIS_BUCKET, `user:${userId}`);
      const launched: string[] = [];
      for (const jobId of needed) {
        const { allowed } = await this.rateLimiter.hit(key, JOB_ANALYSIS_RATE_LIMIT.limit, JOB_ANALYSIS_RATE_LIMIT.windowSeconds);
        if (!allowed) break;
        launched.push(jobId);
      }

      if (launched.length === 0) throw this.rateLimited();

      try {
        const outcome = await this.jobAnalysis.analyzeMany(launched);
        analyzed = outcome.done;
        failed = outcome.failed;
        // `outcome.skipped` (déjà `DONE`/`FAILED`) ne peut pas survenir ici (`needed` les exclut
        // déjà) : seul `outcome.pending` (verrou tenu ailleurs, `PENDING` frais) s'ajoute aux
        // offres jamais lancées faute de budget, toutes deux « en attente » du point de vue de
        // l'appelant.
        pending = outcome.pending + (needed.length - launched.length);
      } catch (error) {
        if (error instanceof AiNotConfiguredError) throw this.aiNotConfigured();
        if (error instanceof AiUnavailableError) throw this.aiUnavailable();
        throw error;
      }
    }

    const { scores, profileComplete } = await this.matchService.ensureScores(userId, body.jobIds);

    return {
      analyzed,
      pending,
      failed,
      notConfigured: !this.jobAnalysis.isConfigured(),
      profileComplete,
      scores,
    };
  }

  @Get(':id/match')
  async detail(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<MatchScoreDto> {
    const detail = await this.matchService.getDetail(request.user.id, id);
    if (!detail) throw this.notFound();
    return detail;
  }

  @Post(':id/analyses/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ ...JOB_ANALYSIS_RATE_LIMIT, bucket: JOB_ANALYSIS_BUCKET })
  async retry(@Param('id') id: string): Promise<{ status: JobAnalysisOutcomeStatus }> {
    try {
      const outcome = await this.jobAnalysis.retry(id);
      return { status: outcome.status };
    } catch (error) {
      if (error instanceof AiNotConfiguredError) throw this.aiNotConfigured();
      if (error instanceof AiUnavailableError) throw this.aiUnavailable();
      throw error;
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'JOB_NOT_FOUND', message: JOB_NOT_FOUND_MESSAGE });
  }

  private rateLimited(): HttpException {
    return new HttpException({ code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private aiNotConfigured(): HttpException {
    return new HttpException(
      { code: 'AI_NOT_CONFIGURED', message: AI_NOT_CONFIGURED_MESSAGE },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private aiUnavailable(): HttpException {
    return new HttpException({ code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
