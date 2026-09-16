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
  const diffMs = new Date(iso).getTime() - now.getTime();

  if (Math.abs(diffMs) < MINUTE) return "à l'instant";
  if (Math.abs(diffMs) < HOUR) return RELATIVE_TIME_FORMAT.format(Math.round(diffMs / MINUTE), 'minute');
  if (Math.abs(diffMs) < DAY) return RELATIVE_TIME_FORMAT.format(Math.round(diffMs / HOUR), 'hour');
  if (Math.abs(diffMs) < WEEK) return RELATIVE_TIME_FORMAT.format(Math.round(diffMs / DAY), 'day');

  const diffWeeks = Math.round(diffMs / WEEK);
  if (Math.abs(diffWeeks) < 4) return RELATIVE_TIME_FORMAT.format(diffWeeks, 'week');

  // Mois/années approximés à 30/365 jours : suffisant pour un affichage relatif
  // (« il y a 3 mois »), jamais utilisé pour un calcul exact de date.
  const diffDays = diffMs / DAY;
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return RELATIVE_TIME_FORMAT.format(diffMonths, 'month');

  return RELATIVE_TIME_FORMAT.format(Math.round(diffDays / 365), 'year');
}

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: '€' };

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

interface FormattedBound {
  text: string;
  /** `true` quand la valeur a été réduite en milliers (« k€ »). */
  compact: boolean;
}

// Sous 1000, un salaire s'affiche brut (« 800 € ») : le raccourci en milliers
// n'a de sens que pour des montants annuels à cinq chiffres ou plus.
function formatBound(value: number): FormattedBound {
  if (Math.abs(value) < 1000) return { text: String(value), compact: false };
  return { text: String(Math.round(value / 1000)), compact: true };
}

/**
 * Fourchette de salaire annuel (spec §7 : « 45–70 k€ », « à partir de 30 k€ »,
 * « jusqu'à 40 k€ »). `null` quand aucune des deux bornes n'est connue —
 * jamais une estimation inventée (cahier des charges §55, cf. spec §5).
 */
export function formatSalaryRange(min: number | null, max: number | null, currency = 'EUR'): string | null {
  if (min === null && max === null) return null;
  const symbol = currencySymbol(currency);

  if (min !== null && max !== null) {
    const minBound = formatBound(min);
    const maxBound = formatBound(max);
    const unit = minBound.compact || maxBound.compact ? `k${symbol}` : symbol;
    return `${minBound.text}–${maxBound.text} ${unit}`;
  }

  if (min !== null) {
    const bound = formatBound(min);
    return `à partir de ${bound.text} ${bound.compact ? `k${symbol}` : symbol}`;
  }

  if (max !== null) {
    const bound = formatBound(max);
    return `jusqu'à ${bound.text} ${bound.compact ? `k${symbol}` : symbol}`;
  }

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
