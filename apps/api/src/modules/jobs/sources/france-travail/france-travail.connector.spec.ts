import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { RateLimiterService } from '../../../../common/rate-limiter.service';
import { FranceTravailClient, type FranceTravailSearchResult } from './france-travail.client';
import { FranceTravailConnector } from './france-travail.connector';
import type { FranceTravailOffer } from './france-travail.schemas';

/** Offre minimale valide : les trois listes sont les seuls champs non optionnels du schéma. */
function buildOffer(overrides: Partial<FranceTravailOffer> = {}): FranceTravailOffer {
  return { formations: [], langues: [], competences: [], ...overrides };
}

/**
 * Seul cast du fichier : le connecteur n'utilise que `search`, `getOffer` et
 * `listCommunes` de `FranceTravailClient`, jamais le reste de sa surface —
 * un faux client complet n'apporterait rien et alourdirait chaque test.
 */
function fakeClient(overrides: {
  search?: (...args: never[]) => Promise<FranceTravailSearchResult>;
  getOffer?: (...args: never[]) => Promise<FranceTravailOffer | null>;
  listCommunes?: (...args: never[]) => Promise<unknown>;
} = {}): FranceTravailClient {
  return {
    search: vi.fn(overrides.search ?? (() => Promise.resolve({ offers: [], first: null, last: null, total: 0 }))),
    getOffer: vi.fn(overrides.getOffer ?? (() => Promise.resolve(null))),
    listCommunes: vi.fn(overrides.listCommunes ?? (() => Promise.resolve([]))),
  } as unknown as FranceTravailClient;
}

// `process.cwd()` vaut `apps/api` sous `vitest run` (cf. `cv-import.e2e.spec.ts`).
const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'france-travail');
const readFixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));

describe('FranceTravailConnector', () => {
  it('traduit SourceQuery vers les paramètres France Travail (mots-clés, lieu, contrats, défauts)', async () => {
    const search = vi.fn().mockResolvedValue({ offers: [], first: null, last: null, total: 0 });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    await connector.search({
      keywords: 'développeur',
      communeCode: '57463',
      distanceKm: 25,
      contractCodes: ['CDI', 'CDD'],
    });

    expect(search).toHaveBeenCalledWith({
      motsCles: 'développeur',
      commune: '57463',
      distance: 25,
      typeContrat: 'CDI,CDD',
      publieeDepuis: 31,
      sort: 1,
      range: '0-149',
    });
  });

  it('recherche nationale (sans lieu) quand aucune commune n_est fournie', async () => {
    const search = vi.fn().mockResolvedValue({ offers: [], first: null, last: null, total: 0 });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    await connector.search({ keywords: 'comptable' });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ commune: undefined, distance: undefined, motsCles: 'comptable' }),
    );
  });

  it('enchaîne sur la page suivante quand la première page est pleine (150 offres)', async () => {
    const fullPage = Array.from({ length: 150 }, (_, i) => buildOffer({ id: `A-${i}` }));
    const shortPage = [buildOffer({ id: 'B-1' })];
    const search = vi
      .fn()
      .mockResolvedValueOnce({ offers: fullPage, first: 0, last: 149, total: 300 })
      .mockResolvedValueOnce({ offers: shortPage, first: 150, last: 150, total: 300 });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    const offers = await connector.search({ keywords: 'x' });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]?.[0]).toMatchObject({ range: '150-299' });
    expect(offers).toHaveLength(151);
  });

  it('ne demande pas de seconde page quand la première est courte', async () => {
    const search = vi.fn().mockResolvedValueOnce({
      offers: [buildOffer({ id: 'A-1' })],
      first: 0,
      last: 0,
      total: 1,
    });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    const offers = await connector.search({ keywords: 'x' });

    expect(search).toHaveBeenCalledTimes(1);
    expect(offers).toHaveLength(1);
  });

  it('respecte maxPages : ne demande pas de seconde page si maxPages vaut 1', async () => {
    const fullPage = Array.from({ length: 150 }, (_, i) => buildOffer({ id: `A-${i}` }));
    const search = vi.fn().mockResolvedValueOnce({ offers: fullPage, first: 0, last: 149, total: 500 });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    const offers = await connector.search({ keywords: 'x', maxPages: 1 });

    expect(search).toHaveBeenCalledTimes(1);
    expect(offers).toHaveLength(150);
  });

  it('écarte les offres sans identifiant', async () => {
    const search = vi.fn().mockResolvedValueOnce({
      offers: [buildOffer({ id: 'A-1' }), buildOffer({ id: null })],
      first: 0,
      last: 1,
      total: 2,
    });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    const offers = await connector.search({ keywords: 'x' });

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ kind: 'FRANCE_TRAVAIL', externalId: 'A-1' });
  });

  it('getOffer renvoie null quand le client ne trouve pas l_offre ou qu_elle n_a pas d_identifiant', async () => {
    const getOffer = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(buildOffer({ id: null }));
    const client = fakeClient({ getOffer });
    const connector = new FranceTravailConnector(client);

    expect(await connector.getOffer('X')).toBeNull();
    expect(await connector.getOffer('Y')).toBeNull();
  });

  it('getOffer mappe l_offre en SourceOffer quand un identifiant est présent', async () => {
    const getOffer = vi.fn().mockResolvedValueOnce(buildOffer({ id: 'FT-0001', intitule: 'Test' }));
    const client = fakeClient({ getOffer });
    const connector = new FranceTravailConnector(client);

    const result = await connector.getOffer('FT-0001');

    expect(result).toMatchObject({ kind: 'FRANCE_TRAVAIL', externalId: 'FT-0001' });
    expect(result?.raw.intitule).toBe('Test');
  });

  it('mappe les communes et écarte les lignes sans code, libellé ou département', async () => {
    const listCommunes = vi.fn().mockResolvedValueOnce([
      { code: '57463', libelle: 'Metz', codePostal: '57000', codeDepartement: '57' },
      { code: null, libelle: 'Sans code', codePostal: '00000', codeDepartement: '00' },
      { code: '99999', libelle: null, codePostal: null, codeDepartement: '99' },
      { code: '75101', libelle: 'Paris 1er Arrondissement', codePostal: '75001', codeDepartement: null },
    ]);
    const client = fakeClient({ listCommunes });
    const connector = new FranceTravailConnector(client);

    const communes = await connector.listCommunes();

    expect(communes).toEqual([{ code: '57463', name: 'Metz', postalCode: '57000', departmentCode: '57' }]);
  });

  it('se fie à first/last (Content-Range), jamais à offers.length, pour décider de la page suivante', async () => {
    // Le en-tête indique une page pleine (150) alors que le tableau d'offres est
    // plus court : des lignes ont pu être écartées par le schéma tolérant. La
    // pagination doit continuer malgré tout — s'arrêter ici serait une régression
    // silencieuse qui tronquerait la recherche.
    const search = vi
      .fn()
      .mockResolvedValueOnce({ offers: [buildOffer({ id: 'A-1' })], first: 0, last: 149, total: 300 })
      .mockResolvedValueOnce({ offers: [buildOffer({ id: 'B-1' })], first: 150, last: 150, total: 300 });
    const client = fakeClient({ search });
    const connector = new FranceTravailConnector(client);

    const offers = await connector.search({ keywords: 'x' });

    expect(search).toHaveBeenCalledTimes(2);
    expect(offers).toHaveLength(2);
  });

  it('intégration : pagine sur un vrai FranceTravailClient jusqu_à une page non pleine (fixtures search-page-1/2)', async () => {
    const SEARCH_PAGE_1 = readFixture('search-page-1.json');
    const SEARCH_PAGE_2 = readFixture('search-page-2.json');
    const TOKEN_FIXTURE = readFixture('token.json');

    // En-tête Content-Range indépendant de la taille réelle des corps (9 puis 3
    // offres fictives) : c'est lui, pas `offers.length`, qui pilote la pagination.
    const fetchImpl = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('access_token')) return new Response(JSON.stringify(TOKEN_FIXTURE), { status: 200 });
      if (url.includes('range=0-149')) {
        return new Response(JSON.stringify(SEARCH_PAGE_1), { status: 206, headers: { 'Content-Range': 'offres 0-149/12' } });
      }
      return new Response(JSON.stringify(SEARCH_PAGE_2), { status: 206, headers: { 'Content-Range': 'offres 150-161/12' } });
    }) as unknown as typeof fetch;

    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;
    const rateLimiter = { hit: vi.fn().mockResolvedValue({ count: 1, allowed: true }) } as unknown as RateLimiterService;

    const client = new FranceTravailClient({
      clientId: 'id-test',
      clientSecret: 'secret-test',
      apiUrl: 'https://api.francetravail.io/partenaire/offresdemploi/v2',
      tokenUrl: 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
      scope: 'api_offresdemploiv2 o2dsoffre',
      fetchImpl,
      redis,
      rateLimiter,
    });
    const connector = new FranceTravailConnector(client);

    const offers = await connector.search({ keywords: 'développeur' });

    // 9 offres (search-page-1.json) + 3 offres (search-page-2.json) ; la seconde
    // page (last - first + 1 = 12, pas 150) arrête la pagination sans 3e appel.
    expect(offers).toHaveLength(12);
    expect(offers.map((offer) => offer.externalId)).toContain('FT-0001');
    expect(offers.map((offer) => offer.externalId)).toContain('FT-0011');
  });
});
