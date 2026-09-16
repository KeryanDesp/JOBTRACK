import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import type { RateLimiterService} from '../../../../common/rate-limiter.service';
import { type RateLimitHit } from '../../../../common/rate-limiter.service';
import { SourceAuthError, SourceRateLimitedError, SourceUnavailableError } from '../source.errors';
import {
  franceTravailCommuneSchema,
  franceTravailOfferSchema,
  franceTravailSearchResponseSchema,
  franceTravailTokenSchema,
  type FranceTravailCommune,
  type FranceTravailOffer,
} from './france-travail.schemas';

const SOURCE_KIND = 'FRANCE_TRAVAIL' as const;

const TOKEN_REDIS_KEY = 'jobs:ft:token';
const RATE_LIMIT_KEY = 'jobs:ft:calls';
const RATE_LIMIT_PER_SECOND = 8;
const RATE_LIMIT_WAIT_MS = 150;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const MIN_TOKEN_TTL_SECONDS = 30;
const DEFAULT_TOKEN_TTL_SECONDS = 1500;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 500;

export interface FranceTravailSearchParams {
  motsCles?: string;
  commune?: string;
  distance?: number;
  typeContrat?: string;
  publieeDepuis?: number;
  sort?: number;
  range: string;
}

export interface FranceTravailSearchResult {
  offers: FranceTravailOffer[];
  first: number | null;
  last: number | null;
  total: number;
}

export interface FranceTravailClientOptions {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  tokenUrl: string;
  scope: string;
  redis: Redis;
  rateLimiter: RateLimiterService;
  /** Injectable pour les tests : `fetch` natif par défaut. */
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Client pour l'API France Travail — Offres d'emploi v2. `fetch` natif
 * uniquement (aucune dépendance). Jamais de journal contenant un secret
 * (jeton, identifiants) ou le contenu d'une offre : seulement méthode,
 * chemin (sans les valeurs de requête), code HTTP et durée.
 */
export class FranceTravailClient {
  readonly kind = SOURCE_KIND;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiUrl: string;
  private readonly tokenUrl: string;
  private readonly scope: string;
  private readonly redis: Redis;
  private readonly rateLimiter: RateLimiterService;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;

  // Un seul rafraîchissement de jeton en vol par processus : des recherches
  // concurrentes qui trouvent le cache Redis vide ne déclenchent qu'un seul
  // appel `POST /access_token`, les autres attendent la même promesse.
  private tokenPromise: Promise<string> | null = null;

  constructor(options: FranceTravailClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.tokenUrl = options.tokenUrl;
    this.scope = options.scope;
    this.redis = options.redis;
    this.rateLimiter = options.rateLimiter;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? new Logger(FranceTravailClient.name);
  }

  /** Jeton OAuth2 valide : lu depuis Redis, ou renouvelé s'il est absent/expiré. */
  async getToken(): Promise<string> {
    const cached = await this.redis.get(TOKEN_REDIS_KEY);
    if (cached) return cached;

    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  /** `GET /offres/search` — 200/206 : offres + `Content-Range` ; 204 : aucun résultat. */
  async search(params: FranceTravailSearchParams): Promise<FranceTravailSearchResult> {
    const searchParams = new URLSearchParams();
    if (params.motsCles) searchParams.set('motsCles', params.motsCles);
    if (params.commune) searchParams.set('commune', params.commune);
    if (params.distance !== undefined) searchParams.set('distance', String(params.distance));
    if (params.typeContrat) searchParams.set('typeContrat', params.typeContrat);
    if (params.publieeDepuis !== undefined) searchParams.set('publieeDepuis', String(params.publieeDepuis));
    if (params.sort !== undefined) searchParams.set('sort', String(params.sort));
    searchParams.set('range', params.range);

    const response = await this.request('/offres/search', searchParams);
    if (response.status === 204) {
      return { offers: [], first: null, last: null, total: 0 };
    }

    const { first, last, total: headerTotal } = this.parseContentRange(response.headers.get('content-range'));
    const offers = await this.parseTolerant(response, franceTravailSearchResponseSchema, '/offres/search');
    const resultats = offers?.resultats ?? [];

    return { offers: resultats, first, last, total: headerTotal ?? resultats.length };
  }

  /** `GET /offres/{id}` — offre, ou `null` sur 204/404 (offre retirée ou inconnue). */
  async getOffer(externalId: string): Promise<FranceTravailOffer | null> {
    const response = await this.request(`/offres/${encodeURIComponent(externalId)}`);
    if (response.status === 204 || response.status === 404) return null;

    return this.parseTolerant(response, franceTravailOfferSchema, '/offres/{id}');
  }

  /** `GET /referentiel/communes` — ~35 000 lignes, tolérant aux lignes invalides. */
  async listCommunes(): Promise<FranceTravailCommune[]> {
    const response = await this.request('/referentiel/communes');
    const json = await this.readJson(response, '/referentiel/communes');
    if (!Array.isArray(json)) {
      this.logger.warn('Référentiel des communes France Travail : réponse inattendue (pas une liste), ignorée.');
      return [];
    }

    const communes: FranceTravailCommune[] = [];
    for (const item of json) {
      const parsed = franceTravailCommuneSchema.safeParse(item);
      if (parsed.success) communes.push(parsed.data);
    }
    return communes;
  }

  /** Invalide le jeton en cache : force un renouvellement au prochain `getToken()`. */
  private async invalidateToken(): Promise<void> {
    await this.redis.del(TOKEN_REDIS_KEY);
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      this.logCall('POST', '/connexion/oauth2/access_token', 'erreur_réseau', Date.now() - startedAt);
      throw new SourceUnavailableError(SOURCE_KIND);
    }
    this.logCall('POST', '/connexion/oauth2/access_token', response.status, Date.now() - startedAt);

    if (response.status === 401 || response.status === 403) {
      throw new SourceAuthError(SOURCE_KIND);
    }
    if (!response.ok) {
      throw new SourceUnavailableError(SOURCE_KIND);
    }

    const json = await response.json().catch(() => null);
    const parsed = franceTravailTokenSchema.safeParse(json);
    if (!parsed.success) {
      // Jamais le corps de la réponse : il pourrait, en théorie, porter un fragment de jeton.
      this.logger.warn('Réponse de jeton France Travail invalide (forme inattendue).');
      throw new SourceUnavailableError(SOURCE_KIND);
    }

    const ttl = Math.max((parsed.data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) - 60, MIN_TOKEN_TTL_SECONDS);
    await this.redis.set(TOKEN_REDIS_KEY, parsed.data.access_token, 'EX', ttl);
    return parsed.data.access_token;
  }

  /**
   * Requête authentifiée avec débit, jeton, délai et nouvelles tentatives.
   * `attempt` vaut 1 au premier essai, 2 à la (unique) nouvelle tentative.
   */
  private async request(path: string, searchParams?: URLSearchParams, attempt = 1): Promise<Response> {
    await this.throttle();
    const token = await this.getToken();
    const url = this.buildUrl(path, searchParams);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch {
      this.logCall('GET', path, 'erreur_réseau', Date.now() - startedAt);
      if (attempt === 1) {
        await delay(RETRY_DELAY_MS);
        return this.request(path, searchParams, 2);
      }
      throw new SourceUnavailableError(SOURCE_KIND);
    }
    this.logCall('GET', path, response.status, Date.now() - startedAt);

    if (response.status === 401) {
      if (attempt === 1) {
        await this.invalidateToken();
        return this.request(path, searchParams, 2);
      }
      throw new SourceAuthError(SOURCE_KIND);
    }
    if (response.status === 403) {
      throw new SourceAuthError(SOURCE_KIND);
    }
    if (response.status === 429) {
      if (attempt === 1) {
        await delay(RETRY_DELAY_MS);
        return this.request(path, searchParams, 2);
      }
      throw new SourceRateLimitedError(SOURCE_KIND);
    }
    if (response.status >= 500) {
      if (attempt === 1) {
        await delay(RETRY_DELAY_MS);
        return this.request(path, searchParams, 2);
      }
      throw new SourceUnavailableError(SOURCE_KIND);
    }
    if (response.status === 400) {
      const codeErreur = await this.extractErrorCode(response);
      // Jamais nos propres paramètres de requête dans le message : seul le code renvoyé par la source.
      throw new SourceUnavailableError(
        SOURCE_KIND,
        `France Travail a refusé la requête (code ${codeErreur ?? 'inconnu'}).`,
      );
    }

    return response;
  }

  /** Limiteur de débit partagé (8 appels/s) : attend puis échoue proprement au-delà. */
  private async throttle(): Promise<void> {
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      let hit: RateLimitHit;
      try {
        hit = await this.rateLimiter.hit(RATE_LIMIT_KEY, RATE_LIMIT_PER_SECOND, 1);
      } catch {
        // `RateLimiterService.hit` échoue fermé (Redis indisponible) : la source
        // devient indisponible, ce n'est pas une limite de débit.
        throw new SourceUnavailableError(SOURCE_KIND);
      }
      if (hit.allowed) return;
      await delay(RATE_LIMIT_WAIT_MS);
    }
    throw new SourceRateLimitedError(SOURCE_KIND);
  }

  private buildUrl(path: string, searchParams?: URLSearchParams): string {
    const url = new URL(`${this.apiUrl}${path}`);
    if (searchParams) {
      for (const [key, value] of searchParams) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Lit le JSON de la réponse ; jamais d'échec : une forme inattendue devient `null`, avec un avertissement. */
  private async readJson(response: Response, path: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      this.logger.warn(`Réponse France Travail non JSON pour ${path}, ignorée.`);
      return null;
    }
  }

  /**
   * Valide la réponse par le schéma tolérant fourni. Une réponse malformée ou
   * hors schéma n'interrompt jamais l'appelant : elle est journalée puis
   * traitée comme absente (spec §4 — « un champ inattendu ne casse jamais
   * l'ingestion »).
   */
  private async parseTolerant<Output, Input>(
    response: Response,
    schema: z.ZodType<Output, z.ZodTypeDef, Input>,
    path: string,
  ): Promise<Output | null> {
    const json = await this.readJson(response, path);
    if (json === null) return null;

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(`Réponse France Travail hors schéma pour ${path}, ignorée.`);
      return null;
    }
    return parsed.data;
  }

  private parseContentRange(header: string | null): { first: number | null; last: number | null; total: number | null } {
    if (!header) return { first: null, last: null, total: null };
    const match = /(\d+)-(\d+)\/(\d+)/.exec(header);
    if (!match) return { first: null, last: null, total: null };
    return { first: Number(match[1]), last: Number(match[2]), total: Number(match[3]) };
  }

  private async extractErrorCode(response: Response): Promise<string | null> {
    const json = await this.readJson(response, '/offres/search');
    if (json && typeof json === 'object' && 'codeErreur' in json) {
      const value = (json).codeErreur;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }

  /** Journal sans valeur sensible : méthode, chemin (sans requête), statut, durée. */
  private logCall(method: string, path: string, status: number | string, durationMs: number): void {
    this.logger.log(`${method} ${path} — statut=${status} durée_ms=${durationMs}`);
  }
}
