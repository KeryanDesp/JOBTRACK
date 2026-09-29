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

/**
 * Aplat de couleur d'un statut, pour les graphiques du tableau de bord et des statistiques.
 * Mêmes jetons de thème que `ApplicationStatusBadge` (`--muted-foreground`, `--primary`,
 * `--warning`, `--success`, `--destructive`) : un segment de barre et la pastille de la même
 * candidature ne doivent jamais être de deux couleurs différentes. Teinte pleine ici (et non
 * diluée comme sur la pastille) parce qu'un segment de quelques pixels de haut disparaîtrait
 * à 10 % d'opacité.
 */
export const STATUS_FILL_CLASSES: Record<ApplicationStatus, string> = {
  TO_APPLY: 'bg-muted-foreground/40',
  APPLIED: 'bg-primary',
  INTERVIEW: 'bg-warning',
  OFFER: 'bg-success',
  REJECTED: 'bg-destructive/70',
};
