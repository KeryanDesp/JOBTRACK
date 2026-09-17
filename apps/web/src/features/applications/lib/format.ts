import type { ApplicationDto } from '@jobtrack/shared';
import { APPLICATION_SOURCE_LABELS } from '@jobtrack/shared';

/** Tiret cadratin : valeur absente affichée dans la table (spec §2), jamais une case vide. */
export const EMPTY_VALUE = '—';

// Instance partagée : `Intl.DateTimeFormat` est coûteux à construire et sans
// état mutable entre deux formatages (même principe que `RELATIVE_TIME_FORMAT`
// dans `features/jobs/lib/format.ts`). `timeZone: 'UTC'` : une date calendaire
// n'a pas d'heure, et l'interpréter dans le fuseau du navigateur ferait
// reculer d'un jour à l'ouest de Greenwich.
const APPLICATION_DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' });

/**
 * Date de candidature (`appliedAt`, `'AAAA-MM-JJ'`) en français abrégé :
 * « 15 sept. 2026 ». `null`, chaîne vide ou date inexploitable donnent le
 * tiret : la table n'invente jamais une date (cahier des charges §55).
 *
 * Seuls les dix premiers caractères sont lus, ce qui accepte aussi bien une
 * date calendaire nue qu'un horodatage complet renvoyé par une version
 * ultérieure de l'API, sans jamais laisser le fuseau du navigateur décaler
 * le jour affiché.
 */
export function formatApplicationDate(isoDate: string | null | undefined): string {
  if (isoDate === null || isoDate === undefined || isoDate === '') return EMPTY_VALUE;
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return APPLICATION_DATE_FORMAT.format(date);
}

/**
 * CV utilisé (spec §4/§7) : le titre du CV adapté quand il est encore
 * accessible, « CV principal » quand la candidature a été envoyée avec le CV
 * du profil (`usedBaseResume`), le tiret sinon. Un `resumeId` dont le CV a
 * depuis été supprimé (`resume: null`, `SetNull` côté base) retombe sur le
 * tiret plutôt que d'afficher un lien mort.
 */
export function resumeLabel(application: Pick<ApplicationDto, 'resume' | 'usedBaseResume'>): string {
  if (application.resume) return application.resume.title;
  if (application.usedBaseResume) return 'CV principal';
  return EMPTY_VALUE;
}

/** Libellé français de la source (spec §4) : « France Travail », « LinkedIn »… */
export function sourceLabel(application: Pick<ApplicationDto, 'source'>): string {
  return APPLICATION_SOURCE_LABELS[application.source];
}
