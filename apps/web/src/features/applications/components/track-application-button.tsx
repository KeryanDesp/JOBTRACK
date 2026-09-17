import type { JobDetailDto } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { BookmarkCheck, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export interface TrackApplicationButtonProps {
  job: JobDetailDto;
  /**
   * Ouverture de `ApplicationFormDialog` (spec §2 item 1, tâche 7) : état
   * possédé et rendu par l'appelant (`JobDetailHeader`), jamais par ce
   * composant lui-même. `JobDetailHeader` rend ce bouton deux fois (inline et
   * barre d'actions collante mobile) — un état local par instance ouvrirait
   * deux dialogues distincts au lieu d'un seul lorsque les deux boutons
   * doivent le partager.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Barre d'actions collante mobile (spec tâche 9) : libellé court
   * (« Suivre »/« Suivie »). L'`aria-label` complet n'est posé que dans ce
   * mode (revue tâche 7, point 6) : en pleine largeur, le texte visible porte
   * déjà ce même libellé, un `aria-label` identique ne ferait que le dupliquer.
   */
  compact?: boolean;
}

/**
 * Bouton de suivi d'une candidature depuis une offre (spec §2 item 1, tâche
 * 7) : sans candidature (`job.application === null`) → bouton secondaire qui
 * ouvre `ApplicationFormDialog` en mode offre (rendu par l'appelant) ; avec
 * candidature → lien vers sa fiche (`/applications?candidature=<id>`)
 * portant son statut. La création elle-même (toast « Candidature ajoutée »,
 * invalidation de `jobKeys.detail`) est entièrement gérée par
 * `ApplicationFormDialog`/`useCreateApplication` (revue `use-applications.ts`)
 * : une fois la candidature créée, `job.application` finit par arriver via
 * cette invalidation et ce composant bascule seul sur le rendu « suivie »,
 * sans état local à synchroniser ici — ni double toast à éviter.
 */
export function TrackApplicationButton({ job, open, onOpenChange, compact = false }: TrackApplicationButtonProps) {
  if (job.application) {
    const statusLabel = APPLICATION_STATUS_LABELS[job.application.status];
    const fullLabel = `Candidature suivie · ${statusLabel}`;
    return (
      <Button asChild variant="outline">
        {/* `aria-label` uniquement en mode compact (revue tâche 7, point 6) :
            en pleine largeur, le texte visible porte déjà `fullLabel` — y
            répéter le même `aria-label` ne ferait que dupliquer le « · » pour
            un lecteur d'écran, sans rien ajouter. */}
        <Link to={`/applications?candidature=${job.application.id}`} aria-label={compact ? fullLabel : undefined}>
          <BookmarkCheck aria-hidden="true" />
          {compact ? 'Suivie' : fullLabel}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      // `aria-haspopup="dialog"` (revue tâche 7, point 6) : ce bouton ouvre
      // `ApplicationFormDialog`, jamais un menu. Même raisonnement que
      // `job.application` ci-dessus pour `aria-label`, omis hors mode compact.
      aria-haspopup="dialog"
      aria-label={compact ? 'Suivre cette candidature' : undefined}
      aria-expanded={open}
      onClick={() => onOpenChange(true)}
    >
      <Send aria-hidden="true" />
      {compact ? 'Suivre' : 'Suivre cette candidature'}
    </Button>
  );
}
