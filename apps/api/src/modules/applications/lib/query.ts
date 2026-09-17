import type { Prisma } from '@prisma/client';
import type { ApplicationSort } from '@jobtrack/shared';

/**
 * Neutralise les métacaractères LIKE/ILIKE (`%`, `_`, `\`) avant un `contains` Prisma — même
 * précaution que `JobsService.buildWhere` : sans elle, `q=%` redeviendrait le joker « tout »
 * plutôt qu'une recherche littérale.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Tri de la vue table (spec §4/§6). `nulls: 'last'` sur les colonnes optionnelles : une
 * candidature sans date de candidature (« À postuler ») ou sans entreprise ne doit jamais
 * occuper le haut de la liste. Un second critère stable (`updatedAt`, puis `id`) évite qu'une
 * page 2 réordonne des ex æquo déjà affichés en page 1.
 */
export function buildOrderBy(sort: ApplicationSort): Prisma.ApplicationOrderByWithRelationInput[] {
  switch (sort) {
    case 'applied_desc':
      return [{ appliedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'desc' }];
    case 'company_asc':
      return [{ company: { sort: 'asc', nulls: 'last' } }, { jobTitle: 'asc' }, { id: 'desc' }];
    case 'updated_desc':
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }
}
