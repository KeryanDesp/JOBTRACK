import { createHash } from 'node:crypto';

/**
 * Champs de `JobSearchQuery` qui influencent réellement l'appel à la source
 * (spec §5) : `sort`, `tab`, `page`… n'y figurent pas volontairement — deux
 * recherches qui ne diffèrent que par le tri ou la page partagent le même
 * cache de synchronisation.
 */
export interface QueryHashInput {
  q: string;
  communes: readonly string[];
  distance: number;
  contractTypes: readonly string[];
}

/**
 * Empreinte stable d'une recherche, pour le cache de synchronisation
 * (`jobs:sync:{hash}`) et la mémoire `JobSearchSync` (spec §5). `q` est
 * comparé sans tenir compte de la casse ni des espaces de bord ; les tableaux
 * sont triés avant sérialisation pour que l'ordre de saisie (communes,
 * contrats) n'influence jamais la clé.
 */
export function computeQueryHash(input: QueryHashInput): string {
  const canonical = {
    q: input.q.trim().toLowerCase(),
    communes: [...input.communes].sort(),
    distance: input.distance,
    contractTypes: [...input.contractTypes].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
