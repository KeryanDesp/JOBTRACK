import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { RateLimiterService, RateLimitHit } from '../../../../common/rate-limiter.service';
import { SourceAuthError, SourceRateLimitedError, SourceUnavailableError } from '../source.errors';
import { FranceTravailClient } from './france-travail.client';

// `process.cwd()` vaut `apps/api` sous `vitest run` (cf. `cv-import.e2e.spec.ts`).
const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'france-travail');
const readFixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));

const TOKEN_FIXTURE = readFixture('token.json') as { access_token: string };
const SEARCH_PAGE_1 = readFixture('search-page-1.json');
const OFFER_DETAIL = readFixture('offer-detail.json');
const COMMUNES_SAMPLE = readFixture('communes-sample.json');

const OPTIONS = {
  clientId: 'id-partenaire-test',
  clientSecret: 'secret-partenaire-ne-jamais-logguer',
  apiUrl: 'https://api.francetravail.io/partenaire/offresdemploi/v2',
  tokenUrl: 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
  scope: 'api_offresdemploiv2 o2dsoffre',
};

/** Redis en mémoire : seules les commandes utilisées par le client (`get/set/del`). */
class FakeRedis {
  private readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }
}

function fakeRateLimiter(hit: RateLimiterService['hit'] = vi.fn<RateLimiterService['hit']>().mockResolvedValue({ count: 1, allowed: true })): RateLimiterService {
  return { hit } as unknown as RateLimiterService;
}

/**
 * Les journaux exposés sont des mocks bruts (pas des méthodes lues sur l'objet
 * `Logger` casté) : on évite ainsi tout accès à une méthode « non liée » et on
 * peut inspecter `log`/`warn`/`error` directement dans les tests.
 */
interface FakeLogger {
  instance: Logger;
  log: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function fakeLogger(): FakeLogger {
  const log = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const verbose = vi.fn();
  return { instance: { log, warn, error, debug, verbose } as unknown as Logger, log, warn, error };
}

/** Convertit l'entrée `fetch` en URL sans jamais passer par le `toString()` par défaut d'un objet. */
function fetchInputToUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Route les appels `fetch` selon l'URL : jeton (`access_token`) ou point de donnée. */
function scriptedFetch(script: { token?: Array<() => Response>; data?: Array<() => Response> }): typeof fetch {
  const tokenQueue = [...(script.token ?? [])];
  const dataQueue = [...(script.data ?? [])];
  return vi.fn((input: string | URL | Request) => {
    const url = fetchInputToUrl(input);
    if (url.includes('access_token')) {
      const next = tokenQueue.shift();
      if (!next) throw new Error('jeton demandé sans réponse scriptée disponible');
      return Promise.resolve(next());
    }
    const next = dataQueue.shift();
    if (!next) throw new Error('appel de donnée demandé sans réponse scriptée disponible');
    return Promise.resolve(next());
  });
}

function createClient(
  fetchImpl: typeof fetch,
  overrides: { redis?: FakeRedis; rateLimiter?: RateLimiterService; logger?: FakeLogger } = {},
) {
  const redis = overrides.redis ?? new FakeRedis();
  const rateLimiter = overrides.rateLimiter ?? fakeRateLimiter();
  const logger = overrides.logger ?? fakeLogger();
  const client = new FranceTravailClient({
    ...OPTIONS,
    fetchImpl,
    redis: redis as unknown as Redis,
    rateLimiter,
    logger: logger.instance,
  });
  return { client, redis, rateLimiter, logger };
}

const tokenOk = (): Response => new Response(JSON.stringify(TOKEN_FIXTURE), { status: 200 });
const searchOkWithRange = (rangeHeader: string): (() => Response) => () =>
  new Response(JSON.stringify(SEARCH_PAGE_1), { status: 206, headers: { 'Content-Range': rangeHeader } });
const search204 = (): Response => new Response(null, { status: 204 });
const search429 = (): Response => new Response(JSON.stringify({ message: 'quota dépassé' }), { status: 429 });
const search500 = (): Response => new Response(JSON.stringify({ message: 'erreur interne' }), { status: 500 });
const search400 = (): Response =>
  new Response(JSON.stringify({ message: 'requête invalide', codeErreur: 'PARAM_INVALIDE' }), { status: 400 });
const searchForbidden = (): Response => new Response(JSON.stringify({ message: 'accès refusé' }), { status: 403 });
const searchUnauthorized = (): Response => new Response(JSON.stringify({ message: 'jeton invalide' }), { status: 401 });
const searchMalformedJson = (): Response => new Response('ceci n_est pas du json {', { status: 200 });
const networkFailure = (): Response => {
  throw new Error('panne réseau simulée');
};
const offer204 = (): Response => new Response(null, { status: 204 });
const offer404 = (): Response => new Response(null, { status: 404 });
const offerOk = (): Response => new Response(JSON.stringify(OFFER_DETAIL), { status: 200 });
const communesOk = (): Response => new Response(JSON.stringify(COMMUNES_SAMPLE), { status: 200 });

describe('FranceTravailClient', () => {
  it('met le jeton en cache Redis puis le renouvelle une fois le cache vidé (expiration)', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk, tokenOk] });
    const { client, redis } = createClient(fetchImpl);

    expect(await client.getToken()).toBe(TOKEN_FIXTURE.access_token);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Deuxième appel : servi depuis Redis, aucun nouvel appel HTTP.
    expect(await client.getToken()).toBe(TOKEN_FIXTURE.access_token);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await redis.del('jobs:ft:token'); // simule l'expiration du TTL
    expect(await client.getToken()).toBe(TOKEN_FIXTURE.access_token);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('envoie le bon corps et la bonne URL pour le jeton, et ne journalise jamais de secret', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk] });
    const { client, logger } = createClient(fetchImpl);

    await client.getToken();

    const call = vi.mocked(fetchImpl).mock.calls[0];
    expect(call?.[0]).toBe(OPTIONS.tokenUrl);
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe(OPTIONS.clientId);
    expect(body.get('client_secret')).toBe(OPTIONS.clientSecret);
    expect(body.get('scope')).toBe(OPTIONS.scope);

    const loggedLines = [...logger.log.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]
      .flat()
      .map(String);
    for (const line of loggedLines) {
      expect(line).not.toContain(OPTIONS.clientSecret);
      expect(line).not.toContain(TOKEN_FIXTURE.access_token);
    }
  });

  it('lit le total depuis l_entete Content-Range plutôt que la taille du corps', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [searchOkWithRange('offres 0-149/3456')] });
    const { client } = createClient(fetchImpl);

    const result = await client.search({ range: '0-149' });

    expect(result.first).toBe(0);
    expect(result.last).toBe(149);
    expect(result.total).toBe(3456);
    expect(result.offers).toHaveLength(8);
  });

  it('renvoie une liste vide sur un 204 (aucun résultat)', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [search204] });
    const { client } = createClient(fetchImpl);

    const result = await client.search({ range: '0-149' });

    expect(result).toEqual({ offers: [], first: null, last: null, total: 0 });
  });

  it('sur 401 persistant : invalide le jeton, retente une fois, puis lève SourceAuthError', async () => {
    const fetchImpl = scriptedFetch({
      token: [tokenOk, tokenOk],
      data: [searchUnauthorized, searchUnauthorized],
    });
    const { client } = createClient(fetchImpl);

    await expect(client.search({ range: '0-149' })).rejects.toBeInstanceOf(SourceAuthError);
    // 2 jetons (le second après invalidation) + 2 appels de données.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('lève SourceAuthError sur 403, sans nouvelle tentative', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [searchForbidden] });
    const { client } = createClient(fetchImpl);

    await expect(client.search({ range: '0-149' })).rejects.toBeInstanceOf(SourceAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 jeton + 1 appel, pas de retry sur 403
  });

  it('lève SourceRateLimitedError après deux 429 consécutifs', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [search429, search429] });
    const { client } = createClient(fetchImpl);

    await expect(client.search({ range: '0-149' })).rejects.toBeInstanceOf(SourceRateLimitedError);
  });

  it('retente une fois sur 5xx puis réussit', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [search500, searchOkWithRange('offres 0-149/8')] });
    const { client } = createClient(fetchImpl);

    const result = await client.search({ range: '0-149' });

    expect(result.offers).toHaveLength(8);
  });

  it('lève SourceUnavailableError après deux échecs réseau consécutifs (délai/panne)', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [networkFailure, networkFailure] });
    const { client } = createClient(fetchImpl);

    await expect(client.search({ range: '0-149' })).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it('traite une réponse JSON malformée comme un résultat vide, avec un avertissement journalisé', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [searchMalformedJson] });
    const { client, logger } = createClient(fetchImpl);

    const result = await client.search({ range: '0-149' });

    expect(result.offers).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('attend puis réussit quand le limiteur de débit refuse d_abord (allowed:false)', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [searchOkWithRange('offres 0-149/8')] });
    const hit = vi
      .fn<RateLimiterService['hit']>()
      .mockResolvedValueOnce({ count: 9, allowed: false } satisfies RateLimitHit)
      .mockResolvedValueOnce({ count: 9, allowed: false } satisfies RateLimitHit)
      .mockResolvedValueOnce({ count: 1, allowed: true } satisfies RateLimitHit);
    const { client } = createClient(fetchImpl, { rateLimiter: fakeRateLimiter(hit) });

    const result = await client.search({ range: '0-149' });

    expect(result.offers).toHaveLength(8);
    expect(hit).toHaveBeenCalledTimes(3);
  });

  it('renvoie null pour une offre absente (204 puis 404)', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [offer204, offer404] });
    const { client } = createClient(fetchImpl);

    expect(await client.getOffer('FT-9999')).toBeNull();
    expect(await client.getOffer('FT-8888')).toBeNull();
  });

  it('renvoie l_offre validée quand elle existe', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [offerOk] });
    const { client } = createClient(fetchImpl);

    const offer = await client.getOffer('FT-0001');

    expect(offer?.id).toBe('FT-0001');
    expect(offer?.entreprise?.nom).toBe('Solaris Ingénierie');
  });

  it('lève SourceUnavailableError avec le seul codeErreur sur un 400, sans écho des paramètres', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [search400] });
    const { client } = createClient(fetchImpl);

    try {
      await client.search({ motsCles: 'mot-cle-secret-utilisateur', range: '0-149' });
      throw new Error('la recherche devait échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceUnavailableError);
      const message = (error as Error).message;
      expect(message).toContain('PARAM_INVALIDE');
      expect(message).not.toContain('mot-cle-secret-utilisateur');
    }
  });

  it('renvoie les communes validées par le schéma', async () => {
    const fetchImpl = scriptedFetch({ token: [tokenOk], data: [communesOk] });
    const { client } = createClient(fetchImpl);

    const communes = await client.listCommunes();

    expect(communes.length).toBeGreaterThanOrEqual(12);
    expect(communes.find((commune) => commune.code === '57463')?.libelle).toBe('Metz');
  });
});
