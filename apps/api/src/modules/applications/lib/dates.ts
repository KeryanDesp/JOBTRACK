/**
 * Dates d'une candidature (spec §4/§5) : `appliedAt` est un **jour**, jamais un instant.
 * Deux conventions cohabitent ici, et une seule ligne les sépare :
 *
 * - le **stockage** reste à minuit UTC (colonne `DATE` côté Postgres, `Date` à minuit UTC côté
 *   Prisma) — un jour n'a pas de fuseau une fois enregistré ;
 * - la **dérivation** du « jour courant » se fait dans le fuseau de l'utilisateur
 *   (`Europe/Paris`, seul public de l'application) : sans ça, une candidature envoyée le
 *   17 septembre à 00 h 30 à Paris serait datée du 16 (il est encore 22 h 30 UTC la veille),
 *   et le compteur « envoyées cette semaine » basculerait deux heures trop tard chaque lundi.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fuseau de référence de l'application (spec §1 : marché français). */
const APP_TIME_ZONE = 'Europe/Paris';

/** `fr-CA` formate une date en `AAAA-MM-JJ`, exactement le format de `isoDateSchema` — le
 * formateur est construit une fois (coûteux) et n'a aucun état mutable entre deux appels. */
const APP_DATE_FORMAT = new Intl.DateTimeFormat('fr-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date calendaire `AAAA-MM-JJ` d'une valeur stockée (toujours minuit UTC). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `AAAA-MM-JJ` → minuit UTC. Le format est déjà validé par `isoDateSchema` (contrat partagé). */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Jour courant **à Paris**, ramené à minuit UTC : valeur de `appliedAt` posée
 * automatiquement (spec §5). `now` est un paramètre pour que les tests n'aient jamais à
 * simuler d'horloge. */
export function todayUtc(now: Date = new Date()): Date {
  return parseIsoDate(APP_DATE_FORMAT.format(now));
}

/**
 * Lundi 00:00 (UTC) de la semaine en cours **à Paris** (`appliedThisWeek`, spec §4). Le calcul
 * part du jour local déjà ramené à minuit UTC par `todayUtc` : l'arithmétique porte donc sur
 * des jours entiers, sans décalage de fuseau ni surprise au changement d'heure. La semaine
 * commence le lundi (usage français) : `getUTCDay()` renvoie 0 pour dimanche, d'où le `+ 6 % 7`.
 */
export function startOfWeekUtc(now: Date = new Date()): Date {
  const today = todayUtc(now);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - daysSinceMonday * MS_PER_DAY);
}
