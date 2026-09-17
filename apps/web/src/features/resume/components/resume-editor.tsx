import type { ResumeContent } from '@jobtrack/shared';
import { RESUME_SECTION_LABELS } from '@jobtrack/shared';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ResumeEditorProps {
  content: ResumeContent;
  onChange: (content: ResumeContent) => void;
}

function move<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const targetIndex = index + direction;
  const current = items[index];
  const target = items[targetIndex];
  if (current === undefined || target === undefined) return [...items];
  const next = [...items];
  next[index] = target;
  next[targetIndex] = current;
  return next;
}

/**
 * Édition du contenu d'un CV adapté (spec §2/§7, tâche 7) : titre, résumé,
 * puces de chaque expérience (une par ligne), retrait d'une expérience / d'une
 * formation / d'une certification / d'un projet et réordonnancement des
 * expériences et compétences par boutons ↑↓ (jamais de glisser-déposer, même
 * principe que `CollectionSection`, `features/profile/components/collection-section.tsx`).
 * Contrôlé : `onChange` reçoit systématiquement un document dont la forme
 * reste celle de `resumeContentSchema` (bornes déjà respectées : 6 puces max,
 * 300 caractères chacune) — l'appelant revalide malgré tout avant d'enregistrer.
 */
export function ResumeEditor({ content, onChange }: ResumeEditorProps) {
  function updateTitle(value: string) {
    onChange({ ...content, identity: { ...content.identity, title: value.trim() === '' ? null : value } });
  }

  function updateSummary(value: string) {
    onChange({ ...content, summary: value });
  }

  function updateHighlights(experienceId: string, raw: string) {
    const highlights = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 6)
      .map((line) => line.slice(0, 300));
    onChange({
      ...content,
      experiences: content.experiences.map((experience) =>
        experience.id === experienceId ? { ...experience, highlights } : experience,
      ),
    });
  }

  function removeExperience(id: string) {
    onChange({ ...content, experiences: content.experiences.filter((experience) => experience.id !== id) });
  }

  function moveExperience(index: number, direction: -1 | 1) {
    onChange({ ...content, experiences: move(content.experiences, index, direction) });
  }

  function moveSkill(index: number, direction: -1 | 1) {
    onChange({ ...content, skills: move(content.skills, index, direction) });
  }

  function removeEducation(id: string) {
    onChange({ ...content, educations: content.educations.filter((item) => item.id !== id) });
  }

  function removeCertification(id: string) {
    onChange({ ...content, certifications: content.certifications.filter((item) => item.id !== id) });
  }

  function removeProject(id: string) {
    onChange({ ...content, projects: content.projects.filter((item) => item.id !== id) });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {RESUME_SECTION_LABELS.identity} et {RESUME_SECTION_LABELS.summary}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resume-editor-title">Titre</Label>
            <Input
              id="resume-editor-title"
              value={content.identity.title ?? ''}
              onChange={(event) => updateTitle(event.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resume-editor-summary">Résumé</Label>
            <Textarea
              id="resume-editor-summary"
              value={content.summary}
              onChange={(event) => updateSummary(event.target.value)}
              maxLength={1200}
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      {content.experiences.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.experiences}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.experiences.map((experience, index) => (
              <div key={experience.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    {experience.role} <span className="text-muted-foreground">— {experience.company}</span>
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Monter"
                      disabled={index === 0}
                      onClick={() => moveExperience(index, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Descendre"
                      disabled={index === content.experiences.length - 1}
                      onClick={() => moveExperience(index, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Retirer l'expérience ${experience.role}`}
                      onClick={() => removeExperience(experience.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`resume-editor-highlights-${experience.id}`}>Points clés (une puce par ligne)</Label>
                  <Textarea
                    id={`resume-editor-highlights-${experience.id}`}
                    value={experience.highlights.join('\n')}
                    onChange={(event) => updateHighlights(experience.id, event.target.value)}
                    rows={Math.max(3, experience.highlights.length)}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {content.skills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.skills}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {content.skills.map((skill, index) => (
                <li key={skill.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <span>{skill.name}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Monter"
                      disabled={index === 0}
                      onClick={() => moveSkill(index, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Descendre"
                      disabled={index === content.skills.length - 1}
                      onClick={() => moveSkill(index, 1)}
                    >
                      <ChevronDown />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {content.educations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.educations}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {content.educations.map((education) => (
                <li key={education.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <span>
                    {education.degree}
                    {education.field ? ` — ${education.field}` : ''} · {education.school}
                  </span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Retirer" onClick={() => removeEducation(education.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {content.certifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.certifications}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {content.certifications.map((certification) => (
                <li key={certification.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <span>
                    {certification.name} · {certification.issuer}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Retirer"
                    onClick={() => removeCertification(certification.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {content.projects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{RESUME_SECTION_LABELS.projects}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {content.projects.map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <span>{project.name}</span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Retirer" onClick={() => removeProject(project.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
