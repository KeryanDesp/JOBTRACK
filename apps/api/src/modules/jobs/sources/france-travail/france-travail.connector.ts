import type { JobSourceKind } from '@prisma/client';
import type { JobSourceConnector, SourceCommune, SourceOffer, SourceQuery } from '../job-source.connector';
import type { FranceTravailClient } from './france-travail.client';

const SOURCE_KIND: JobSourceKind = 'FRANCE_TRAVAIL';

// Une page fait au plus 150 offres (borne de l'API) ; on ne dépasse jamais la
// borne haute documentée (1149) même si `maxPages` autoriserait davantage.
const PAGE_SIZE = 150;
const MAX_RANGE_UPPER_BOUND = 1149;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_PUBLISHED_WITHIN_DAYS = 31;
// `sort=1` : plus récentes d'abord (spec §4).
const SORT_MOST_RECENT = 1;

/** Connecteur France Travail : traduit `SourceQuery` en paramètres de recherche, pagine, mappe les résultats. */
export class FranceTravailConnector implements JobSourceConnector {
  readonly kind = SOURCE_KIND;

  constructor(private readonly client: FranceTravailClient) {}

  async search(query: SourceQuery): Promise<SourceOffer[]> {
    const maxPages = query.maxPages ?? DEFAULT_MAX_PAGES;
    const offers: SourceOffer[] = [];

    let pageIndex = 0;
    let rangeStart = 0;
    while (pageIndex < maxPages && rangeStart <= MAX_RANGE_UPPER_BOUND) {
      const rangeEnd = Math.min(rangeStart + PAGE_SIZE - 1, MAX_RANGE_UPPER_BOUND);
      const result = await this.client.search({
        motsCles: query.keywords,
        commune: query.communeCode,
        distance: query.communeCode ? query.distanceKm ?? undefined : undefined,
        typeContrat: query.contractCodes?.length ? query.contractCodes.join(',') : undefined,
        publieeDepuis: query.publishedWithinDays ?? DEFAULT_PUBLISHED_WITHIN_DAYS,
        sort: SORT_MOST_RECENT,
        range: `${rangeStart}-${rangeEnd}`,
      });

      for (const raw of result.offers) {
        if (!raw.id) continue; // Sans identifiant, l'offre ne peut pas être dédupliquée ni référencée.
        offers.push({ kind: SOURCE_KIND, externalId: raw.id, raw });
      }

      pageIndex += 1;
      const pageLength = result.offers.length;
      // On ne redemande une page suivante que si la précédente était pleine :
      // une page courte signifie qu'il n'y a plus de résultat au-delà.
      if (pageLength < PAGE_SIZE) break;
      rangeStart = rangeEnd + 1;
    }

    return offers;
  }

  async getOffer(externalId: string): Promise<SourceOffer | null> {
    const raw = await this.client.getOffer(externalId);
    if (!raw || !raw.id) return null;
    return { kind: SOURCE_KIND, externalId: raw.id, raw };
  }

  async listCommunes(): Promise<SourceCommune[]> {
    const communes = await this.client.listCommunes();
    const result: SourceCommune[] = [];
    for (const commune of communes) {
      if (!commune.code || !commune.libelle || !commune.codeDepartement) continue;
      result.push({
        code: commune.code,
        name: commune.libelle,
        postalCode: commune.codePostal ?? null,
        departmentCode: commune.codeDepartement,
      });
    }
    return result;
  }
}
