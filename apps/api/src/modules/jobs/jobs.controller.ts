import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, type PipeTransform } from '@nestjs/common';
import {
  JOB_SEARCH_PARAM_KEYS,
  jobSearchQuerySchema,
  type CommuneDto,
  type JobDetailDto,
  type JobListResponseDto,
  type JobSearchQuery,
  type JobSummaryDto,
  type JobsCapabilitiesDto,
} from '@jobtrack/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { CommuneService } from './commune.service';
import { JobsService } from './jobs.service';
import { SavedJobsService } from './saved-jobs.service';

const MIN_COMMUNE_QUERY_LENGTH = 2;

/** Clé courte d'URL (`lieu`, `rayon`…) → clé canonique du contrat, table inverse de `JOB_SEARCH_PARAM_KEYS`. */
const CANONICAL_BY_SHORT_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(JOB_SEARCH_PARAM_KEYS).map(([canonical, short]) => [short, canonical]),
);

/** Renomme les clés courtes reçues par Fastify (`?lieu=&rayon=…`) en clés canoniques du contrat. */
function toCanonicalQuery(raw: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const [shortKey, value] of Object.entries(raw)) {
    const canonicalKey = CANONICAL_BY_SHORT_KEY[shortKey];
    if (canonicalKey !== undefined) canonical[canonicalKey] = value;
  }
  return canonical;
}

/**
 * Renomme puis valide la query de `GET /jobs` : l'API n'expose que les clés
 * courtes du contrat (`JOB_SEARCH_PARAM_KEYS`), jamais les noms canoniques —
 * la même table que le web sérialise dans l'URL (spec §6).
 */
class JobSearchQueryPipe implements PipeTransform<Record<string, unknown>, JobSearchQuery> {
  private readonly delegate = new ZodValidationPipe(jobSearchQuerySchema);

  transform(value: Record<string, unknown>): JobSearchQuery {
    return this.delegate.transform(toCanonicalQuery(value ?? {}));
  }
}

// Authentifié et protégé par CSRF par défaut (aucun @Public()/@NoCsrf()) : les offres sont
// publiques une fois authentifié, seuls les favoris sont personnels (spec §6).
@Controller('jobs')
export class JobsController {
  // Fire-and-forget déclenché une seule fois par processus (spec tâche 6) : le référentiel des
  // communes se charge en arrière-plan, jamais synchrone sur une requête `/jobs/communes`.
  private communesEnsureLoadedTriggered = false;

  constructor(
    private readonly jobs: JobsService,
    private readonly savedJobs: SavedJobsService,
    private readonly communes: CommuneService,
  ) {}

  @Get('capabilities')
  capabilities(): JobsCapabilitiesDto {
    return this.jobs.capabilities();
  }

  @Get('communes')
  async searchCommunes(@Query('q') rawQ?: string | string[]): Promise<CommuneDto[]> {
    this.triggerCommunesEnsureLoaded();

    const q = Array.isArray(rawQ) ? rawQ[0] ?? '' : rawQ ?? '';
    if (q.trim().length < MIN_COMMUNE_QUERY_LENGTH) return [];
    return this.communes.search(q);
  }

  @Get('saved')
  listSaved(@Req() request: AuthenticatedRequest): Promise<JobSummaryDto[]> {
    return this.savedJobs.list(request.user.id);
  }

  @Get()
  list(
    @Query(new JobSearchQueryPipe()) query: JobSearchQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<JobListResponseDto> {
    return this.jobs.search(request.user.id, query);
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<JobDetailDto> {
    return this.jobs.getDetail(request.user.id, id);
  }

  @Post(':id/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    return this.savedJobs.save(request.user.id, id);
  }

  @Delete(':id/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsave(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    return this.savedJobs.unsave(request.user.id, id);
  }

  private triggerCommunesEnsureLoaded(): void {
    if (this.communesEnsureLoadedTriggered) return;
    this.communesEnsureLoadedTriggered = true;
    void this.communes.ensureLoaded().catch(() => {
      // `CommuneService.ensureLoaded` journalise déjà ses propres pannes (source, Redis) ;
      // ce `catch` n'est qu'un filet pour qu'une erreur inattendue ne devienne jamais un
      // rejet non géré du processus.
    });
  }
}
