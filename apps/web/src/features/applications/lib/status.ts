import type { ApplicationStatus } from '@jobtrack/shared';
import { APPLICATION_STATUSES } from '@jobtrack/shared';

/**
 * Garde de type sur un statut de candidature, partagée par tout ce qui reçoit
 * une chaîne non typée à rapprocher du contrat : l'identifiant d'une colonne
 * déposée (`applications-board.tsx`, où `@dnd-kit` ne connaît que des
 * `UniqueIdentifier`) comme la valeur d'un sélecteur.
 *
 * `APPLICATION_STATUSES` est élargi en `readonly string[]` le temps de la
 * comparaison : `includes` d'un tuple littéral n'accepte sinon que ses propres
 * membres en argument, ce qui interdirait justement la chaîne à valider.
 */
export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}
