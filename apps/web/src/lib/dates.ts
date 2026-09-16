/**
 * Formate une date calendaire `'AAAA-MM-JJ'` en « mois abrégé année »
 * (ex. « janv. 2024 »), pour l'affichage des périodes d'expérience/formation.
 * `T00:00:00Z` : une date-seule interprétée en UTC, jamais dans le fuseau du
 * navigateur (un `new Date('2024-01-01')` affiché à l'ouest de Greenwich
 * retomberait sur « déc. 2023 »).
 */
export function formatMonthYear(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
