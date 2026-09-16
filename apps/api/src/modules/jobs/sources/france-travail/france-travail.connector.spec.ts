import { describe, expect, it, vi } from 'vitest';
import { FranceTravailConnector } from './france-travail.connector';
import type { FranceTravailClient, FranceTravailSearchResult } from './france-travail.client';
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
});
