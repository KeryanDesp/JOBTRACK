import type { CoverLetterSummaryDto } from '@jobtrack/shared';
import { COVER_LETTER_TONE_LABELS } from '@jobtrack/shared';
import { Mail, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDeleteLetter } from '../hooks/use-resume';

interface LetterListProps {
  letters: CoverLetterSummaryDto[];
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(iso));
}

/**
 * Liste des lettres de motivation (`/resume`, spec §2) : carte par lettre
 * (offre, ton, date), « Ouvrir » (→ `/resume/letter/:jobId?lettre=:id`, spec
 * §7), « Supprimer » avec confirmation et suppression optimiste
 * (`useDeleteLetter`), même principe que `ResumeList`. Une lettre dont
 * l'offre a été supprimée (`jobId: null`) n'a plus de destination :
 * « Ouvrir » reste alors désactivé.
 */
export function LetterList({ letters }: LetterListProps) {
  const [pendingDelete, setPendingDelete] = useState<CoverLetterSummaryDto | null>(null);
  const deleteLetter = useDeleteLetter();

  if (letters.length === 0) {
    return <EmptyState icon={Mail} title="Aucune lettre." description="Générez une lettre de motivation depuis une offre." />;
  }

  function handleConfirmDelete(): void {
    if (!pendingDelete) return;
    deleteLetter.mutate(pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <>
      <ul className="space-y-3">
        {letters.map((letter) => (
          <li key={letter.id}>
            <Card>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{letter.jobTitle ?? 'Offre supprimée'}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(letter.updatedAt)} · {COVER_LETTER_TONE_LABELS[letter.tone]}
                    {letter.company && ` · ${letter.company}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  {letter.jobId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/resume/letter/${letter.jobId}?lettre=${letter.id}`}>Ouvrir</Link>
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" disabled>
                      Ouvrir
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Supprimer la lettre pour ${letter.jobTitle ?? 'cette offre'}`}
                    onClick={() => setPendingDelete(letter)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette lettre ?</DialogTitle>
            <DialogDescription>Cette action est irréversible.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDelete}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
