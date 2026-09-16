import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobSourceKind } from '@prisma/client';
import type { FranceTravailOffer } from '../sources/france-travail/france-travail.schemas';
import type { JobSourceConnector, SourceCommune, SourceOffer, SourceQuery } from '../sources/job-source.connector';
import type { JobSourceError } from '../sources/source.errors';

// `process.cwd()` vaut `apps/api` sous `vitest run` (invoqué depuis ce paquet), comme dans
// `cv-import.e2e.spec.ts` : pas de dépendance à `import.meta.url`.
const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'france-travail');

interface RawCommune {
  code: string;
  libelle: string;
  codePostal: string | null;
  codeDepartement: string;
}

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), 'utf-8')) as T;
}

/**
 * Offre synthétique, hors fixtures : aucune offre France Travail fictive
 * (spec §9) ne mentionne « react » dans son titre — nécessaire pour exercer le
 * filtre `q` (mots-clés) sans modifier les fixtures partagées avec les tests
 * du mapper et du client, qui portent sur leur contenu exact.
 */
const SYNTHETIC_OFFERS: FranceTravailOffer[] = [
  {
    id: 'FT-9001',
    intitule: 'Développeuse React senior (H/F)',
    description:
      'Piloto Software recrute une développeuse React senior pour renforcer son équipe front, basée à Metz.',
    dateCreation: new Date().toISOString(),
    dateActualisation: new Date().toISOString(),
    lieuTravail: { libelle: '57 - METZ', latitude: 49.1193, longitude: 6.1757, codePostal: '57000', commune: '57463' },
    entreprise: { nom: 'Piloto Software', description: null, logo: null, url: null },
    typeContrat: 'CDI',
    typeContratLibelle: 'Contrat à durée indéterminée',
    natureContrat: 'Contrat travail',
    experienceExige: 'S',
    experienceLibelle: '2 An(s)',
    formations: [],
    langues: [],
    competences: [{ code: 'react', libelle: 'React', exigence: 'E' }],
    salaire: { libelle: 'Annuel de 48000.00 Euros à 52000.00 Euros', commentaire: null, complement1: null, complement2: null },
    nombrePostes: 1,
    accessibleTH: false,
    tempsPlein: true,
  },
];

/**
 * Décalage (en heures, par rapport à l'instant de l'appel) appliqué à `dateCreation`/
 * `dateActualisation` de chaque offre du catalogue (tâche 6) : les fixtures portent des
 * dates figées (2026-09-xx), inexploitables pour exercer de façon stable les filtres de
 * fraîcheur (`depuis`, onglet « Nouvelles »). FT-0001 et l'offre synthétique restent
 * toujours « nouvelles » (< 24 h) ; les autres sont toujours plus anciennes qu'elles.
 */
const HOURS_AGO_BY_ID: Record<string, number> = {
  'FT-0001': 2,
  'FT-0002': 10 * 24,
  'FT-0003': 3 * 24,
  'FT-0004': 5 * 24,
  'FT-0005': 4 * 24,
  'FT-0006': 6 * 24,
  'FT-0007': 7 * 24,
  'FT-0008': 8 * 24,
  'FT-0009': 9 * 24,
  'FT-0010': 11 * 24,
  'FT-0011': 12 * 24,
  'FT-0020': 13 * 24,
  'FT-9001': 1,
};

function withFreshDate(offer: FranceTravailOffer, now: Date): FranceTravailOffer {
  const hoursAgo = offer.id ? HOURS_AGO_BY_ID[offer.id] : undefined;
  if (hoursAgo === undefined) return offer;
  const shifted = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
  return { ...offer, dateCreation: shifted, dateActualisation: shifted };
}

function loadCatalog(): FranceTravailOffer[] {
  const page1 = loadJson<{ resultats: FranceTravailOffer[] }>('search-page-1.json').resultats;
  const page2 = loadJson<{ resultats: FranceTravailOffer[] }>('search-page-2.json').resultats;
  return [...page1, ...page2, ...SYNTHETIC_OFFERS];
}

/**
 * Connecteur factice pour les tests e2e du module `jobs` (spec §9, tâche 6) : alimenté par
 * les fixtures France Travail (recherche filtrée par commune et par mots-clés sur
 * `intitule`, comme une source réelle) plus l'offre synthétique ci-dessus. `failNext` fait
 * échouer le prochain appel (`search` ou `getOffer`) avec l'erreur donnée ; `markRemoved`
 * fait disparaître une offre de la source (`getOffer` renvoie alors `null`, comme une
 * offre dépubliée).
 */
export class FakeConnector implements JobSourceConnector {
  readonly kind: JobSourceKind = 'FRANCE_TRAVAIL';
  calls = 0;

  private readonly catalog: FranceTravailOffer[];
  private readonly removedIds = new Set<string>();
  private pendingError: JobSourceError | null = null;

  constructor() {
    this.catalog = loadCatalog();
  }

  failNext(error: JobSourceError): void {
    this.pendingError = error;
  }

  markRemoved(externalId: string): void {
    this.removedIds.add(externalId);
  }

  // Ni `search`, ni `getOffer`, ni `listCommunes` n'attendent réellement quelque chose (tout
  // vient de fixtures déjà en mémoire) : pas de `async`/`await` inutile, seulement l'enveloppe
  // `Promise` exigée par `JobSourceConnector`, comme le ferait un vrai connecteur réseau.
  search(query: SourceQuery): Promise<SourceOffer[]> {
    this.calls += 1;
    this.consumePendingError();

    const now = new Date();
    let offers = this.catalog.filter((offer) => !!offer.id && !this.removedIds.has(offer.id));

    if (query.communeCode) {
      offers = offers.filter((offer) => offer.lieuTravail?.commune === query.communeCode);
    }
    if (query.keywords && query.keywords.trim() !== '') {
      const keyword = query.keywords.trim().toLowerCase();
      offers = offers.filter((offer) => (offer.intitule ?? '').toLowerCase().includes(keyword));
    }

    return Promise.resolve(
      offers.map((offer) => {
        const raw = withFreshDate(offer, now);
        // `offer.id` est garanti non nul par le filtre ci-dessus.
        return { kind: this.kind, externalId: raw.id as string, raw };
      }),
    );
  }

  getOffer(externalId: string): Promise<SourceOffer | null> {
    this.calls += 1;
    this.consumePendingError();

    if (this.removedIds.has(externalId)) return Promise.resolve(null);
    const offer = this.catalog.find((candidate) => candidate.id === externalId);
    if (!offer) return Promise.resolve(null);
    return Promise.resolve({ kind: this.kind, externalId, raw: withFreshDate(offer, new Date()) });
  }

  listCommunes(): Promise<SourceCommune[]> {
    const communes = loadJson<RawCommune[]>('communes-sample.json');
    return Promise.resolve(
      communes
        .filter((commune) => commune.code !== '' && commune.libelle !== '' && commune.codeDepartement !== '')
        .map((commune) => ({
          code: commune.code,
          name: commune.libelle,
          postalCode: commune.codePostal,
          departmentCode: commune.codeDepartement,
        })),
    );
  }

  private consumePendingError(): void {
    if (!this.pendingError) return;
    const error = this.pendingError;
    this.pendingError = null;
    throw error;
  }
}
