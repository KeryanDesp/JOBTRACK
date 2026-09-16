import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CommuneDto } from '@jobtrack/shared';
import type { Commune } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { normalizeForKey } from './lib/text';
import { JOB_SOURCE_CONNECTORS, type JobSourceConnector, type SourceCommune } from './sources/job-source.connector';

const LOADED_REDIS_KEY = 'jobs:communes:loadedAt';
const LOADED_TTL_SECONDS = 30 * 24 * 60 * 60;
const UPSERT_BATCH_SIZE = 1000;
const DEFAULT_SEARCH_LIMIT = 10;
const POSTAL_CODE_PATTERN = /^\d{2,5}$/;

function toCommuneDto(commune: Commune): CommuneDto {
  return {
    code: commune.code,
    name: commune.name,
    postalCode: commune.postalCode,
    departmentCode: commune.departmentCode,
  };
}

/**
 * Référentiel des communes France Travail (spec §3 et §5, ~35 000 lignes) :
 * chargé à la première utilisation puis tous les 30 jours (`jobs:communes:loadedAt`
 * en Redis), jamais synchrone au démarrage. Une panne de la source pendant le
 * chargement est journalisée, jamais levée : `/jobs/communes` reste utilisable
 * (liste vide ou référentiel déjà en base).
 */
@Injectable()
export class CommuneService {
  private readonly logger = new Logger(CommuneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(JOB_SOURCE_CONNECTORS) private readonly connectors: JobSourceConnector[],
  ) {}

  async ensureLoaded(): Promise<void> {
    const alreadyLoaded = await this.safeRedisGet(LOADED_REDIS_KEY);
    if (alreadyLoaded) return;

    const connector = this.connectors.find((candidate) => candidate.kind === 'FRANCE_TRAVAIL');
    if (!connector) return;

    let communes: SourceCommune[];
    try {
      communes = await connector.listCommunes();
    } catch (error) {
      this.logger.warn(`Référentiel des communes indisponible (${(error as Error).constructor.name}).`);
      return;
    }

    if (communes.length === 0) {
      // Réponse vide (panne silencieuse, schéma inattendu…) : jamais posée comme
      // « chargée » pour 30 jours, sinon `/jobs/communes` resterait vide tout ce temps.
      this.logger.warn('Référentiel des communes vide, non posé comme chargé.');
      return;
    }

    for (let index = 0; index < communes.length; index += UPSERT_BATCH_SIZE) {
      const batch = communes.slice(index, index + UPSERT_BATCH_SIZE).map((commune) => ({
        code: commune.code,
        name: commune.name,
        nameNormalized: normalizeForKey(commune.name),
        postalCode: commune.postalCode,
        departmentCode: commune.departmentCode,
      }));
      // `skipDuplicates` : un rechargement (30 jours) ne fait que compléter les codes
      // manquants — le référentiel évolue trop rarement pour justifier un upsert ligne
      // à ligne sur ~35 000 lignes à chaque cycle.
      await this.prisma.commune.createMany({ data: batch, skipDuplicates: true });
    }

    await this.safeRedisSetEx(LOADED_REDIS_KEY, new Date().toISOString(), LOADED_TTL_SECONDS);
  }

  /** Préfixe sur `nameNormalized`, ou sur `postalCode` pour une saisie numérique (2 à 5 chiffres). */
  async search(q: string, limit = DEFAULT_SEARCH_LIMIT): Promise<CommuneDto[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];

    const rows = await this.prisma.commune.findMany({
      where: POSTAL_CODE_PATTERN.test(trimmed)
        ? { postalCode: { startsWith: trimmed } }
        : { nameNormalized: { startsWith: normalizeForKey(trimmed) } },
      orderBy: { name: 'asc' },
      take: limit,
    });
    return rows.map(toCommuneDto);
  }

  /**
   * Correspondance exacte (normalisée) d'abord, puis préfixe. Plusieurs communes
   * homonymes (même nom normalisé, communes distinctes) donnent `null` plutôt qu'un
   * choix arbitraire : aucun ordre ne rendrait ce choix sûr, jamais de préférence
   * silencieuse pour l'une d'entre elles.
   */
  async resolveByName(name: string): Promise<CommuneDto | null> {
    const key = normalizeForKey(name);
    if (!key) return null;

    const exactMatches = await this.prisma.commune.findMany({ where: { nameNormalized: key }, take: 2 });
    if (exactMatches.length > 1) return null;
    const [exact] = exactMatches;
    if (exact) return toCommuneDto(exact);

    const prefix = await this.prisma.commune.findFirst({
      where: { nameNormalized: { startsWith: key } },
      orderBy: { name: 'asc' },
    });
    return prefix ? toCommuneDto(prefix) : null;
  }

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.client.get(key);
    } catch (error) {
      this.logger.warn(`Lecture Redis impossible pour ${key} : ${(error as Error).message}`);
      return null;
    }
  }

  private async safeRedisSetEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.client.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Écriture Redis impossible pour ${key} : ${(error as Error).message}`);
    }
  }
}
