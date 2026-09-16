import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import type { RateLimiterService, RateLimitHit } from '../../../../common/rate-limiter.service';
import {
  JobSourceError,
  SourceAuthError,
  SourceNotConfiguredError,
  SourceRateLimitedError,
  SourceUnavailableError,
} from '../source.errors';
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
const RATE_LIMIT_MAX_ATTEMPTS = 5;
// Somme > 1 s (150+300+600+1200 = 2250 ms) : la fenêtre du limiteur (1 s) est
// toujours dépassée avant d'abandonner, laissant le compteur Redis se réinitialiser
// avant la prochaine synchronisation plutôt que d'échouer sur une rafale courte.
const RATE_LIMIT_BACKOFFS_MS = [150, 300, 600, 1200];
const MIN_TOKEN_TTL_SECONDS = 30;
const DEFAULT_TOKEN_TTL_SECONDS = 1500;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 500; // 5xx / erreur réseau
const RETRY_DELAY_429_MS = 1500; // 429 sans en-tête `Retry-After`
const RETRY_AFTER_CAP_MS = 5000;
const COMMUNES_PATH = '/referentiel/communes';
const MAX_BODY_BYTES_DEFAULT = 8 * 1024 * 1024;
const MAX_BODY_BYTES_COMMUNES = 64 * 1024 * 1024;

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

/** Réponse brute déjà lue en intégralité (dans la fenêtre de délai), avant tout parsing JSON/Zod. */
interface RawResponse {
  status: number;
  headers: Headers;
  bodyText: string;
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

  // Évite de répéter le même avertissement Redis à chaque appel tant que la
  // panne persiste ; réinitialisé dès qu'une commande Redis réussit.
  private redisIssueWarned = false;

  constructor(options: FranceTravailClientOptions) {
    // Garde-fou de configuration : `buildUrl` ajoute lui-même les paramètres de
    // requête à `apiUrl` ; une base qui contiendrait déjà un `?` produirait une
    // URL corrompue. Déjà empêché par la validation d'environnement
    // (`packages/shared/src/env.ts`), mais un client construit directement
    // (tests, futur appelant) doit échouer tôt plutôt que produire des requêtes
    // silencieusement fausses.
    if (options.apiUrl.includes('?')) {
      throw new SourceNotConfiguredError(SOURCE_KIND);
    }
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
    const cached = await this.safeRedisGet();
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
    const path = '/offres/search';
    const searchParams = new URLSearchParams();
    if (params.motsCles) searchParams.set('motsCles', params.motsCles);
    if (params.commune) searchParams.set('commune', params.commune);
    if (params.distance !== undefined) searchParams.set('distance', String(params.distance));
    if (params.typeContrat) searchParams.set('typeContrat', params.typeContrat);
    if (params.publieeDepuis !== undefined) searchParams.set('publieeDepuis', String(params.publieeDepuis));
    if (params.sort !== undefined) searchParams.set('sort', String(params.sort));
    searchParams.set('range', params.range);

    const raw = await this.request(path, searchParams);
    if (raw.status === 204) {
      return { offers: [], first: null, last: null, total: 0 };
    }

    const { first, last, total: headerTotal } = this.parseContentRange(raw.headers.get('content-range'));
    const parsed = this.parseTolerant(raw.bodyText, franceTravailSearchResponseSchema, path);
    const resultats = parsed?.resultats ?? [];

    // `headerTotal` peut rester > 0 alors que `resultats` est vide : le corps a
    // pu échouer le schéma (réponse malformée) indépendamment de l'en-tête
    // `Content-Range`, qui reste la seule source de vérité pour la pagination
    // (cf. `FranceTravailConnector.search`, qui se fie à `first`/`last`, jamais
    // à la taille de ce tableau).
    return { offers: resultats, first, last, total: headerTotal ?? resultats.length };
  }

  /** `GET /offres/{id}` — offre, ou `null` sur 204/404 (offre retirée ou inconnue). */
  async getOffer(externalId: string): Promise<FranceTravailOffer | null> {
    const path = `/offres/${encodeURIComponent(externalId)}`;
    const raw = await this.request(path);
    if (raw.status === 204 || raw.status === 404) return null;

    return this.parseTolerant(raw.bodyText, franceTravailOfferSchema, path);
  }

  /** `GET /referentiel/communes` — ~35 000 lignes, tolérant aux lignes invalides. */
  async listCommunes(): Promise<FranceTravailCommune[]> {
    const raw = await this.request(COMMUNES_PATH);
    const json = this.parseJsonSafe(raw.bodyText, COMMUNES_PATH);
    if (!Array.isArray(json)) {
      this.logger.warn(`Référentiel des communes France Travail : réponse inattendue (pas une liste) pour ${COMMUNES_PATH}, ignorée.`);
      return [];
    }

    const communes: FranceTravailCommune[] = [];
    for (const item of json) {
      const parsed = franceTravailCommuneSchema.safeParse(item);
      if (parsed.success) communes.push(parsed.data);
    }
    return communes;
  }

  /** Lecture Redis tolérante : un échec (Redis indisponible) devient une absence de jeton en cache, jamais une erreur qui remonte. */
  private async safeRedisGet(): Promise<string | null> {
    try {
      const value = await this.redis.get(TOKEN_REDIS_KEY);
      this.redisIssueWarned = false;
      return value;
    } catch (error) {
      this.warnRedisIssueOnce('lecture du jeton en cache', error);
      return null;
    }
  }

  /** Mise en cache tolérante : un échec n'empêche jamais de renvoyer le jeton obtenu de France Travail. */
  private async safeRedisSet(value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(TOKEN_REDIS_KEY, value, 'EX', ttlSeconds);
      this.redisIssueWarned = false;
    } catch (error) {
      this.warnRedisIssueOnce('mise en cache du jeton', error);
    }
  }

  /** Invalidation tolérante : un échec n'empêche jamais la nouvelle tentative après un 401 (elle redemandera juste un jeton frais côté France Travail au prochain appel, sans jeton périmé en cache). */
  private async invalidateToken(): Promise<void> {
    try {
      await this.redis.del(TOKEN_REDIS_KEY);
      this.redisIssueWarned = false;
    } catch (error) {
      this.warnRedisIssueOnce('invalidation du jeton en cache', error);
    }
  }

  private warnRedisIssueOnce(context: string, error: unknown): void {
    if (this.redisIssueWarned) return;
    this.redisIssueWarned = true;
    // Jamais le jeton : seulement le message d'erreur ioredis (ex. ECONNREFUSED).
    this.logger.warn(`Redis indisponible pour le connecteur France Travail (${context}) : ${(error as Error).message}`);
  }

  private async fetchToken(): Promise<string> {
    const path = '/connexion/oauth2/access_token';
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const startedAt = Date.now();
    let raw: RawResponse;
    try {
      raw = await this.performRequest(
        this.tokenUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
        path,
      );
    } catch (error) {
      if (error instanceof JobSourceError) throw error;
      this.logCall('POST', path, 'erreur_réseau', Date.now() - startedAt);
      throw new SourceUnavailableError(SOURCE_KIND);
    }
    this.logCall('POST', path, raw.status, Date.now() - startedAt);

    if (raw.status === 401 || raw.status === 403) {
      throw new SourceAuthError(SOURCE_KIND);
    }
    if (raw.status < 200 || raw.status >= 300) {
      throw new SourceUnavailableError(SOURCE_KIND);
    }

    const json = this.parseJsonSafe(raw.bodyText, path);
    const parsed = franceTravailTokenSchema.safeParse(json);
    if (!parsed.success) {
      // Jamais le corps de la réponse : il pourrait, en théorie, porter un fragment de jeton.
      this.logger.warn('Réponse de jeton France Travail invalide (forme inattendue).');
      throw new SourceUnavailableError(SOURCE_KIND);
    }

    const ttl = Math.max((parsed.data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) - 60, MIN_TOKEN_TTL_SECONDS);
    await this.safeRedisSet(parsed.data.access_token, ttl);
    return parsed.data.access_token;
  }

  /**
   * Requête authentifiée avec débit, jeton, délai et nouvelles tentatives.
   * `attempt` vaut 1 au premier essai, 2 à la (unique) nouvelle tentative.
   */
  private async request(path: string, searchParams?: URLSearchParams, attempt = 1): Promise<RawResponse> {
    await this.throttle();
    const token = await this.getToken();
    const url = this.buildUrl(path, searchParams);

    const startedAt = Date.now();
    let raw: RawResponse;
    try {
      raw = await this.performRequest(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, path);
    } catch (error) {
      // Une erreur de source déjà qualifiée (ex. corps trop volumineux) ne doit
      // jamais être ré-étiquetée en simple panne réseau : elle est repropagée telle quelle.
      if (error instanceof JobSourceError) throw error;
      this.logCall('GET', path, 'erreur_réseau', Date.now() - startedAt);
      if (attempt === 1) {
        await delay(RETRY_DELAY_MS);
        return this.request(path, searchParams, 2);
      }
      throw new SourceUnavailableError(SOURCE_KIND);
    }
    this.logCall('GET', path, raw.status, Date.now() - startedAt);

    if (raw.status === 401) {
      if (attempt === 1) {
        await this.invalidateToken();
        return this.request(path, searchParams, 2);
      }
      throw new SourceAuthError(SOURCE_KIND);
    }
    if (raw.status === 403) {
      throw new SourceAuthError(SOURCE_KIND);
    }
    if (raw.status === 429) {
      if (attempt === 1) {
        await delay(this.retryAfterDelayMs(raw.headers));
        return this.request(path, searchParams, 2);
      }
      throw new SourceRateLimitedError(SOURCE_KIND);
    }
    if (raw.status >= 500) {
      if (attempt === 1) {
        await delay(RETRY_DELAY_MS);
        return this.request(path, searchParams, 2);
      }
      throw new SourceUnavailableError(SOURCE_KIND);
    }
    if (raw.status === 400) {
      const codeErreur = this.extractErrorCode(raw.bodyText, path);
      // Jamais nos propres paramètres de requête dans le message : seul le code renvoyé par la source.
      throw new SourceUnavailableError(
        SOURCE_KIND,
        `France Travail a refusé la requête sur ${path} (code ${codeErreur ?? 'inconnu'}).`,
      );
    }

    return raw;
  }

  /** Délai avant la nouvelle tentative sur 429 : honore `Retry-After` (secondes, plafonné à 5 s) s'il est présent, sinon un délai par défaut plus long qu'une panne 5xx ordinaire. */
  private retryAfterDelayMs(headers: Headers): number {
    const header = headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
      }
    }
    return RETRY_DELAY_429_MS;
  }

  /** Limiteur de débit partagé (8 appels/s) : attend avec un délai croissant (150/300/600/1200 ms, total > 1 s) puis échoue proprement au-delà de 5 tentatives, sans jamais appeler `hit` une sixième fois. */
  private async throttle(): Promise<void> {
    for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
      let hit: RateLimitHit;
      try {
        hit = await this.rateLimiter.hit(RATE_LIMIT_KEY, RATE_LIMIT_PER_SECOND, 1);
      } catch {
        // `RateLimiterService.hit` échoue fermé (Redis indisponible) : la source
        // devient indisponible, ce n'est pas une limite de débit.
        throw new SourceUnavailableError(SOURCE_KIND);
      }
      if (hit.allowed) return;
      const backoff = RATE_LIMIT_BACKOFFS_MS[attempt];
      if (backoff !== undefined) await delay(backoff);
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

  /**
   * Effectue l'appel et lit le corps entièrement à l'intérieur de la même
   * fenêtre d'abandon : le délai de 10 s doit couvrir la réception du corps,
   * pas seulement les en-têtes — sinon un corps qui n'arrive jamais bloquerait
   * la requête indéfiniment malgré le délai. Le corps est aussi plafonné en
   * taille (en-tête `content-length` vérifié d'abord ; à défaut, lu puis
   * mesuré) pour ne jamais charger une réponse démesurée en mémoire.
   */
  private async performRequest(url: string, init: RequestInit, path: string): Promise<RawResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const bodyText = await this.readBodyWithCap(response, path, controller.signal);
      return { status: response.status, headers: response.headers, bodyText };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readBodyWithCap(response: Response, path: string, signal: AbortSignal): Promise<string> {
    if (response.status === 204) return '';

    const cap = path === COMMUNES_PATH ? MAX_BODY_BYTES_COMMUNES : MAX_BODY_BYTES_DEFAULT;
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = Number(contentLength);
      if (Number.isFinite(size) && size > cap) {
        throw new SourceUnavailableError(SOURCE_KIND, `Réponse France Travail trop volumineuse pour ${path}.`);
      }
    }

    const text = await this.readTextUntilAborted(response, signal);
    if (Buffer.byteLength(text, 'utf-8') > cap) {
      throw new SourceUnavailableError(SOURCE_KIND, `Réponse France Travail trop volumineuse pour ${path}.`);
    }
    return text;
  }

  /**
   * Lit le corps en le liant explicitement au signal d'abandon : `response.text()`
   * d'un corps qui n'arrive jamais ne se résoudrait sinon pas avant la fin du
   * délai global — ce qui est précisément ce que le délai de 10 s doit empêcher.
   */
  private readTextUntilAborted(response: Response, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(new Error('requête annulée (délai dépassé pendant la lecture du corps)'));
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => reject(new Error('requête annulée (délai dépassé pendant la lecture du corps)'));
      signal.addEventListener('abort', onAbort, { once: true });
      response.text().then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private parseJsonSafe(bodyText: string, path: string): unknown {
    if (!bodyText) return null;
    try {
      return JSON.parse(bodyText);
    } catch {
      this.logger.warn(`Réponse France Travail non JSON pour ${path}, ignorée.`);
      return null;
    }
  }

  /**
   * Valide le corps par le schéma tolérant fourni. Une réponse malformée ou
   * hors schéma n'interrompt jamais l'appelant : elle est journalée puis
   * traitée comme absente (spec §4 — « un champ inattendu ne casse jamais
   * l'ingestion »).
   */
  private parseTolerant<Output, Input>(bodyText: string, schema: z.ZodType<Output, z.ZodTypeDef, Input>, path: string): Output | null {
    const json = this.parseJsonSafe(bodyText, path);
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

  private extractErrorCode(bodyText: string, path: string): string | null {
    const json = this.parseJsonSafe(bodyText, path);
    if (json && typeof json === 'object' && 'codeErreur' in json) {
      const value = json.codeErreur;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }

  /** Journal sans valeur sensible : méthode, chemin (sans requête), statut, durée. */
  private logCall(method: string, path: string, status: number | string, durationMs: number): void {
    this.logger.log(`${method} ${path} — statut=${status} durée_ms=${durationMs}`);
  }
}
