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
import { JOB_ANALYSIS_VERSION } from './job-analysis.prompt';
import { JobAnalysisService, type JobAnalysisOutcomeStatus, type JobAnalysisStatusInfo } from './job-analysis.service';
import { MatchService } from './match.service';

/** Nom partagé par le budget compté manuellement (`POST /jobs/analyses`, une frappe par offre
 * réellement lancée) et par la garde locale du retry (`@UserRateLimit`, tâche 6) : les deux
 * routes consomment le même budget « 60 analyses / heure / utilisateur » (spec §4). Une offre
 * introuvable (`analyze()` renvoie `{status:'failed'}` sans jamais lever) ou dont le verrou
 * Redis est tenu par un autre appelant (`skipped_pending`) coûte tout de même une frappe : le
 * budget borne le nombre de tentatives, jamais seulement les appels Claude effectivement
 * exécutés — c'est un plafond volontairement large plutôt qu'un compteur d'appels réels. */
const JOB_ANALYSIS_BUCKET = 'job-analysis';
const JOB_ANALYSIS_RATE_LIMIT = { limit: 60, windowSeconds: 3600 } as const;

const RATE_LIMITED_MESSAGE = "Trop d'analyses. Réessayez dans une heure.";
const AI_NOT_CONFIGURED_MESSAGE = "L'analyse des offres nécessite le service IA (non configuré).";
const AI_UNAVAILABLE_MESSAGE = 'Le service IA ne répond pas. Réessayez.';
const JOB_NOT_FOUND_MESSAGE = 'Offre introuvable.';

/**
 * Une offre déjà `DONE` **à la version courante** ne compte jamais sur le budget : c'est le seul
 * cas qui n'a jamais besoin d'un nouvel appel Claude. Une offre jamais analysée, `PENDING`
 * (fraîcheur vérifiée par `JobAnalysisService` lui-même), ou `DONE`/`FAILED` à une version
 * antérieure (évolution du prompt/schéma, `JOB_ANALYSIS_VERSION`) est réanalysée — un `FAILED`
 * n'est en revanche jamais rejoué automatiquement à la version courante : seule une relance
 * explicite (`retry`) le concerne.
 */
function needsAnalysis(info: JobAnalysisStatusInfo | null): boolean {
  if (!info) return true;
  if (info.version !== JOB_ANALYSIS_VERSION) return true;
  return info.status === 'PENDING';
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

    if (needed.length > 0 && this.jobAnalysis.isConfigured()) {
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
        // `outcome.skipped` (déjà `DONE`/`FAILED` à la version courante) ne peut pas survenir
        // ici (`needed` les exclut déjà) : seul `outcome.pending` (verrou tenu ailleurs,
        // `PENDING` frais) s'ajoute aux offres jamais lancées faute de budget, toutes deux
        // « en attente » du point de vue de l'appelant.
        pending = outcome.pending + (needed.length - launched.length);
      } catch (error) {
        if (error instanceof AiUnavailableError) throw this.aiUnavailable();
        // Le service devient indisponible en cours d'appel (ex. clé révoquée entre le contrôle
        // ci-dessus et cet appel) : jamais un 503 sur cette route (seul `retry` le renvoie,
        // amendement revue UX) — les offres de ce lot restent simplement « en attente ».
        if (!(error instanceof AiNotConfiguredError)) throw error;
        pending += launched.length + (needed.length - launched.length);
      }
    } else if (needed.length > 0) {
      // Service IA non configuré : rien n'est tenté, jamais un 503 ici (amendement revue UX) —
      // le client doit tout de même recevoir les scores déjà disponibles (offres partagées déjà
      // analysées par un autre utilisateur) ci-dessous, `notConfigured: true` portant l'état.
      pending = needed.length;
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
