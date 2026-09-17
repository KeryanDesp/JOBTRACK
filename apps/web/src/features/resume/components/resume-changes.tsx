import type { ResumeChanges as ResumeChangesData, ResumeContent } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type ResumeChangesSection = 'educations' | 'certifications' | 'projects';

interface ResumeChangesProps {
  changes: ResumeChangesData;
  /** Contenu courant (édité) : sert à déterminer si une expérience est encore conservée et à nommer les compétences. */
  content: ResumeContent;
  /**
   * Libellés lisibles des formations/certifications/projets écartés, par id
   * (uniquement disponibles avec le CV de base, spec §7 étape 2) : sans eux
   * (détail d'un CV existant, lecture seule), la section affiche un simple
   * décompte plutôt que des identifiants bruts.
   */
  labels?: Partial<Record<ResumeChangesSection, Record<string, string>>>;
  /** Absent : vue en lecture seule (`/resume/:id`, onglet « Modifications »). Présent : bouton « Rétablir » (étape 2 de la création). */
  onRestoreExperience?: (id: string) => void;
  onRestore?: (section: ResumeChangesSection, id: string) => void;
}

function BeforeAfterBlock({ before, after }: { before: string; after: string }) {
  if (before === after) return <p className="text-sm text-muted-foreground">{after || '—'}</p>;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Avant</p>
        <p className="text-sm text-muted-foreground">{before || '—'}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Après</p>
        <p className="text-sm">{after || '—'}</p>
      </div>
    </div>
  );
}

/**
 * Vue avant/après par section (spec §2/§4/§42, tâche 7) : chaque puce
 * reformulée, sa source quand elle diffère, les puces écartées par l'ancrage
 * serveur avec leur motif, l'ordre des compétences, et les formations /
 * certifications / projets écartés — rétablissables via `onRestore` quand
 * fourni (étape 2 de la création), en lecture seule sinon (détail d'un CV).
 */
export function ResumeChanges({ changes, content, labels, onRestoreExperience, onRestore }: ResumeChangesProps) {
  const skillNames = new Map(content.skills.map((skill) => [skill.id, skill.name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{RESUME_SECTION_LABELS.identity} et {RESUME_SECTION_LABELS.summary}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">Titre</p>
            <BeforeAfterBlock before={changes.title.before} after={changes.title.after} />
          </div>
          <div>
            <p className="text-sm font-medium">Résumé</p>
            <BeforeAfterBlock before={changes.summary.before} after={changes.summary.after} />
          </div>
        </CardContent>
      </Card>

      {changes.experiences.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.experiences}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {changes.experiences.map((experience) => {
              const isKept = content.experiences.some((item) => item.id === experience.id);
              return (
                <div key={experience.id} className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{isKept ? 'Conservée' : 'Écartée'}</p>
                    {!isKept && onRestoreExperience && (
                      <Button type="button" variant="outline" size="sm" onClick={() => onRestoreExperience(experience.id)}>
                        <Undo2 />
                        Rétablir
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Avant</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                        {experience.before.map((highlight, index) => <li key={index}>{highlight}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Après</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                        {experience.after.map((highlight, index) => <li key={index}>{highlight}</li>)}
                      </ul>
                    </div>
                  </div>
                  {experience.rejected.length > 0 && (
                    <ul className="space-y-0.5">
                      {experience.rejected.map((rejection) => (
                        <li key={rejection.index} className="text-xs text-muted-foreground italic">
                          Reformulation écartée : {rejection.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {(changes.skills.before.length > 0 || changes.skills.after.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.skills}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Avant</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {changes.skills.before.map((id) => (
                  <Badge key={id} variant="outline">
                    {skillNames.get(id) ?? id}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Après</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {changes.skills.after.map((id) => (
                  <Badge key={id} variant="outline">
                    {skillNames.get(id) ?? id}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(['educations', 'certifications', 'projects'] as const).map((section) => {
        const removed = changes[section].removed;
        if (removed.length === 0) return null;
        const sectionLabels = labels?.[section];

        return (
          <Card key={section}>
            <CardHeader>
              <CardTitle>{RESUME_SECTION_LABELS[section]} écartées</CardTitle>
            </CardHeader>
            <CardContent>
              {sectionLabels ? (
                <ul className="space-y-2">
                  {removed.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{sectionLabels[id] ?? id}</span>
                      {onRestore && (
                        <Button type="button" variant="outline" size="sm" onClick={() => onRestore(section, id)}>
                          <Undo2 />
                          Rétablir
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {removed.length} élément{removed.length > 1 ? 's' : ''} écarté{removed.length > 1 ? 's' : ''}.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {changes.notes && <p className="text-sm text-muted-foreground italic">{changes.notes}</p>}
    </div>
  );
}
