// `numeric: 'auto'` : les valeurs proches (hier, ce mois-ci...) reçoivent un
// mot dédié quand la locale en a un (« hier ») ; les autres restent
// numériques (« il y a 3 jours »). Instance partagée : `Intl.RelativeTimeFormat`
// est coûteux à construire et n'a aucun état mutable entre deux formatages.
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Fraîcheur relative en français (spec §2/§7 : « Publié il y a 2 heures »).
 * `now` par défaut à l'appel plutôt qu'à la définition du module : chaque
 * appel reflète l'heure réelle, et les tests peuvent figer une référence
 * stable sans dépendre d'horloge simulée.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  // Une offre ne devrait jamais être publiée dans le futur ; par sécurité
  // (horloges serveur/client légèrement désynchronisées), tout écart positif
  // est ramené à 0 plutôt que d'afficher un trompeur « dans X ... ».
  const diffMs = Math.min(0, new Date(iso).getTime() - now.getTime());

  if (Math.abs(diffMs) < MINUTE) return "à l'instant";
  // Troncature (jamais `Math.round`) sur les minutes/heures/jours : 23 h 59
  // reste « il y a 23 heures », pas « il y a 24 heures » par un arrondi qui
  // anticiperait une heure pas encore entièrement écoulée.
  if (Math.abs(diffMs) < HOUR) return RELATIVE_TIME_FORMAT.format(Math.trunc(diffMs / MINUTE), 'minute');
  if (Math.abs(diffMs) < DAY) return RELATIVE_TIME_FORMAT.format(Math.trunc(diffMs / HOUR), 'hour');
  if (Math.abs(diffMs) < WEEK) return RELATIVE_TIME_FORMAT.format(Math.trunc(diffMs / DAY), 'day');

  const diffWeeks = Math.round(diffMs / WEEK);
  if (Math.abs(diffWeeks) < 4) return RELATIVE_TIME_FORMAT.format(diffWeeks, 'week');

  // Mois/années approximés à 30/365 jours : suffisant pour un affichage relatif
  // (« il y a 3 mois »), jamais utilisé pour un calcul exact de date.
  const diffDays = diffMs / DAY;
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return RELATIVE_TIME_FORMAT.format(diffMonths, 'month');

  return RELATIVE_TIME_FORMAT.format(Math.round(diffDays / 365), 'year');
}

/**
 * Fourchette de salaire annuel (spec §7 : « 45–70 k€ », « à partir de 30 k€ »,
 * « jusqu'à 40 k€ »). `null` quand aucune des deux bornes n'est connue —
 * jamais une estimation inventée (cahier des charges §55, cf. spec §5).
 *
 * EUR reçoit un format compact maison plutôt que `Intl.NumberFormat` : la
 * notation compacte de cette locale répéterait le symbole sur chaque borne
 * (« 45 k€–70 k€ ») au lieu du regroupement attendu par la maquette
 * (« 45–70 k€ »). Les autres devises (peu probables ici, cf. spec §4 — seule
 * l'API France Travail en EUR est branchée) passent par `Intl.NumberFormat`
 * en notation compacte, qui gère alors elle-même le symbole propre à chacune.
 */
export function formatSalaryRange(min: number | null, max: number | null, currency = 'EUR'): string | null {
  if (min === null && max === null) return null;

  if (currency !== 'EUR') {
    const formatter = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 0,
    });
    if (min !== null && max !== null) {
      return min === max ? formatter.format(min) : `${formatter.format(min)}–${formatter.format(max)}`;
    }
    if (min !== null) return `à partir de ${formatter.format(min)}`;
    if (max !== null) return `jusqu'à ${formatter.format(max)}`;
    // Inatteignable : le premier retour couvre déjà le cas des deux bornes nulles.
    return null;
  }

  // La borne de référence pour décider de l'unité (k€ ou brut) est toujours
  // `max` quand elle est connue, même si `min` est seul sous 1000 : les deux
  // bornes d'une même fourchette partagent une seule unité, jamais l'une en
  // milliers et l'autre brute.
  const reference = max ?? min;
  const compact = reference !== null && Math.abs(reference) >= 1000;
  const unit = compact ? 'k€' : '€';
  const boundText = (value: number) => (compact ? String(Math.round(value / 1000)) : String(value));

  if (min !== null && max !== null) {
    return min === max ? `${boundText(min)} ${unit}` : `${boundText(min)}–${boundText(max)} ${unit}`;
  }
  if (min !== null) return `à partir de ${boundText(min)} ${unit}`;
  if (max !== null) return `jusqu'à ${boundText(max)} ${unit}`;

  // Inatteignable : le premier retour couvre déjà le cas des deux bornes nulles.
  return null;
}

/**
 * Lieu affiché sur une carte/un détail d'offre. `locationLabel` porte déjà un
 * libellé nettoyé côté serveur (« Metz (57) », spec §5) ; sans lui, on retombe
 * sur le seul département connu plutôt que de masquer complètement le lieu.
 */
export function formatLocation(label: string | null, departmentCode: string | null): string {
  if (label !== null && label.trim() !== '') return label;
  if (departmentCode !== null) return `Département ${departmentCode}`;
  return 'Lieu non précisé';
}
