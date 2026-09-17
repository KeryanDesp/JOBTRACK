import type { ResumeSummaryDto } from '@jobtrack/shared';
import { RESUME_TEMPLATE_LABELS } from '@jobtrack/shared';
import { FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDeleteResume } from '../hooks/use-resume';

interface ResumeListProps {
  resumes: ResumeSummaryDto[];
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(iso));
}

/**
 * Liste des CV adaptés (`/resume`, spec §2, tâche 7) : carte par CV (titre,
 * date, modèle, offre liée), « Ouvrir » (→ `/resume/:id`), « Supprimer » avec
 * confirmation (même principe que `CollectionSection`, `Dialog` piloté par
 * l'état plutôt que `DialogTrigger`) et suppression optimiste (`useDeleteResume`).
 * État vide avec un lien vers les offres (spec §2 : « Aucun CV adapté.
 * Générez-en un depuis une offre. »).
 */
export function ResumeList({ resumes }: ResumeListProps) {
  const [pendingDelete, setPendingDelete] = useState<ResumeSummaryDto | null>(null);
  const deleteResume = useDeleteResume();

  if (resumes.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState icon={FileText} title="Aucun CV adapté." description="Générez-en un depuis une offre." />
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link to="/jobs">Voir les offres</Link>
          </Button>
        </div>
      </div>
    );
  }

  function handleConfirmDelete(): void {
    if (!pendingDelete) return;
    deleteResume.mutate(pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <>
      <ul className="space-y-3">
        {resumes.map((resume) => (
          <li key={resume.id}>
            <Card>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{resume.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(resume.updatedAt)} · {RESUME_TEMPLATE_LABELS[resume.template]}
                    {resume.jobTitle && ` · ${resume.jobTitle}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/resume/${resume.id}`}>Ouvrir</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Supprimer ${resume.title}`}
                    onClick={() => setPendingDelete(resume)}
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
            <DialogTitle>Supprimer ce CV ?</DialogTitle>
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
