import { createHash } from 'node:crypto';

/**
 * Champs qui influencent réellement l'appel à la source (spec §5) : `sort`,
 * `tab`, `page`… n'y figurent pas volontairement. `contractCodes` porte les
 * codes France Travail déjà mappés (`mapContractTypesToFranceTravail`),
 * jamais l'énumération locale `ContractType[]` : deux combinaisons qui
 * produisent le même appel (ex. `APPRENTICESHIP` et `INTERNSHIP`, tous deux
 * sans code) partagent la même clé de cache.
 */
export interface QueryHashInput {
  q: string;
  communes: readonly string[];
  distance: number;
  contractCodes: readonly string[];
}

/** Forme canonique (triée, normalisée) d'une recherche — stockée telle quelle dans `JobSearchSync.queryJson`. */
export interface CanonicalQuery {
  q: string;
  communes: string[];
  distance: number | null;
  contractCodes: string[];
}

/**
 * Construit la forme canonique d'une recherche : `q` sans casse ni espaces de
 * bord, communes et codes de contrat triés (l'ordre de saisie ne doit jamais
 * changer la clé), `distance` mise à `null` en recherche nationale (sans
 * commune, ce paramètre n'est jamais envoyé à la source — deux distances
 * différentes y produiraient le même appel).
 */
export function buildCanonicalQuery(input: QueryHashInput): CanonicalQuery {
  const communes = [...input.communes].sort();
  return {
    q: input.q.trim().toLowerCase(),
    communes,
    distance: communes.length > 0 ? input.distance : null,
    contractCodes: [...input.contractCodes].sort(),
  };
}

/**
 * Empreinte stable d'une recherche, pour le cache de synchronisation
 * (`jobs:sync:{hash}`) et la mémoire `JobSearchSync` (spec §5).
 */
export function computeQueryHash(input: QueryHashInput): string {
  return createHash('sha256').update(JSON.stringify(buildCanonicalQuery(input))).digest('hex');
}
