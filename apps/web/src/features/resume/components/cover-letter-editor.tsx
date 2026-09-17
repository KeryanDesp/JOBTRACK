import type { CoverLetterContent, CoverLetterTone } from '@jobtrack/shared';
import { COVER_LETTER_MAX_CHARS, COVER_LETTER_TONE_LABELS, coverLetterContentSchema } from '@jobtrack/shared';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { emptyToNull, zodResolverWith } from '@/lib/forms';

const MAX_PARAGRAPHS = 6;

type CoverLetterFormValues = {
  recipient: string;
  subject: string;
  greeting: string;
  paragraphs: string[];
  closing: string;
  signature: string;
};

function toFormValues(content: CoverLetterContent): CoverLetterFormValues {
  return {
    recipient: content.recipient ?? '',
    subject: content.subject,
    greeting: content.greeting,
    paragraphs: content.paragraphs.length > 0 ? content.paragraphs : [''],
    closing: content.closing,
    signature: content.signature,
  };
}

/** `recipient` accepte `''` côté champ, `null` côté schéma (comme `endDate` ailleurs, `@/lib/forms`). */
function normalize(raw: unknown): unknown {
  return emptyToNull(raw as Record<string, unknown>, ['recipient']);
}

export interface CoverLetterEditorProps {
  content: CoverLetterContent;
  tone: CoverLetterTone;
  onChange: (content: CoverLetterContent) => void;
  onSave: (content: CoverLetterContent) => void;
  isSaving: boolean;
}

/**
 * Édition du contenu d'une lettre de motivation (spec §2/§4/§7, tâche 8) :
 * destinataire, objet, formule d'appel, paragraphes (une zone de texte par
 * paragraphe, ajout/retrait jusqu'à 6), formule de politesse, signature.
 * `onChange` est notifié à chaque frappe (`form.watch`) pour que l'aperçu A4
 * du composant appelant reste en temps réel ; « Enregistrer » n'appelle
 * `onSave` qu'avec un contenu déjà validé par le schéma partagé
 * (`coverLetterContentSchema`, la même règle que le serveur), et seulement si
 * le formulaire a été modifié (`isDirty`).
 *
 * Ne se réinitialise jamais lui-même quand `content` change en cours de vie :
 * l'appelant doit remonter ce composant (prop `key`, ex. `${letter.id}-${letter.updatedAt}`)
 * pour charger une autre lettre ou reprendre `isDirty` à `false` après un
 * enregistrement réussi — même principe que `ResumeDetailPage` réinitialisant
 * son état local sur `id`, mais via un remontage plutôt qu'un effet, plus sûr
 * pour un formulaire non contrôlé.
 */
export function CoverLetterEditor({ content, tone, onChange, onSave, isSaving }: CoverLetterEditorProps) {
  const form = useForm<CoverLetterFormValues, unknown, CoverLetterContent>({
    resolver: zodResolverWith<CoverLetterFormValues, CoverLetterContent>(coverLetterContentSchema, normalize),
    defaultValues: toFormValues(content),
  });

  useEffect(() => {
    const subscription = form.watch((values) => {
      const paragraphs = (values.paragraphs ?? []).filter((paragraph): paragraph is string => typeof paragraph === 'string');
      onChange({
        recipient: values.recipient && values.recipient.trim() !== '' ? values.recipient : null,
        subject: values.subject ?? '',
        greeting: values.greeting ?? '',
        paragraphs: paragraphs.length > 0 ? paragraphs : [''],
        closing: values.closing ?? '',
        signature: values.signature ?? '',
      });
    });
    return () => subscription.unsubscribe();
  }, [form, onChange]);

  const errors = form.formState.errors;
  const paragraphs = form.watch('paragraphs');
  const totalChars = paragraphs.reduce((total, paragraph) => total + (paragraph?.length ?? 0), 0);
  const maxChars = COVER_LETTER_MAX_CHARS[tone];
  const overLimit = totalChars > maxChars;

  function addParagraph(): void {
    if (paragraphs.length >= MAX_PARAGRAPHS) return;
    form.setValue('paragraphs', [...paragraphs, ''], { shouldDirty: true });
  }

  function removeParagraph(index: number): void {
    if (paragraphs.length <= 1) return;
    form.setValue(
      'paragraphs',
      paragraphs.filter((_, paragraphIndex) => paragraphIndex !== index),
      { shouldDirty: true },
    );
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit((values) => onSave(values))(event)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cover-letter-recipient">Destinataire</Label>
        <Input id="cover-letter-recipient" maxLength={120} {...form.register('recipient')} />
        <FormFieldError message={errors.recipient?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cover-letter-subject">Objet</Label>
        <Input
          id="cover-letter-subject"
          maxLength={160}
          aria-invalid={errors.subject ? true : undefined}
          aria-describedby={errors.subject ? 'cover-letter-subject-error' : undefined}
          {...form.register('subject')}
        />
        <FormFieldError id="cover-letter-subject-error" message={errors.subject?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cover-letter-greeting">Formule d&apos;appel</Label>
        <Input
          id="cover-letter-greeting"
          maxLength={80}
          aria-invalid={errors.greeting ? true : undefined}
          aria-describedby={errors.greeting ? 'cover-letter-greeting-error' : undefined}
          {...form.register('greeting')}
        />
        <FormFieldError id="cover-letter-greeting-error" message={errors.greeting?.message} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label id="cover-letter-paragraphs-label">Paragraphes</Label>
          <Button type="button" variant="outline" size="sm" onClick={addParagraph} disabled={paragraphs.length >= MAX_PARAGRAPHS}>
            <Plus aria-hidden />
            Ajouter un paragraphe
          </Button>
        </div>
        {paragraphs.map((_, index) => (
          <div key={index} className="space-y-1.5">
            <div className="flex items-start gap-2">
              <Textarea
                id={`cover-letter-paragraph-${index}`}
                aria-label={`Paragraphe ${index + 1}`}
                rows={4}
                maxLength={900}
                className="flex-1"
                {...form.register(`paragraphs.${index}`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Retirer le paragraphe ${index + 1}`}
                onClick={() => removeParagraph(index)}
                disabled={paragraphs.length <= 1}
              >
                <Trash2 />
              </Button>
            </div>
            <FormFieldError message={errors.paragraphs?.[index]?.message} />
          </div>
        ))}
        <FormFieldError message={errors.paragraphs?.message} />

        <p className={overLimit ? 'flex items-center gap-1.5 text-sm text-amber-600' : 'text-muted-foreground text-sm'}>
          {overLimit && <AlertTriangle className="size-4" aria-hidden />}
          {totalChars} / {maxChars} caractères ({COVER_LETTER_TONE_LABELS[tone]})
          {overLimit && ' — au-delà de la longueur recommandée pour ce ton.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cover-letter-closing">Formule de politesse</Label>
        <Input
          id="cover-letter-closing"
          maxLength={160}
          aria-invalid={errors.closing ? true : undefined}
          aria-describedby={errors.closing ? 'cover-letter-closing-error' : undefined}
          {...form.register('closing')}
        />
        <FormFieldError id="cover-letter-closing-error" message={errors.closing?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cover-letter-signature">Signature</Label>
        <Input
          id="cover-letter-signature"
          maxLength={80}
          aria-invalid={errors.signature ? true : undefined}
          aria-describedby={errors.signature ? 'cover-letter-signature-error' : undefined}
          {...form.register('signature')}
        />
        <FormFieldError id="cover-letter-signature-error" message={errors.signature?.message} />
      </div>

      <Button type="submit" disabled={!form.formState.isDirty || isSaving}>
        {isSaving ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </form>
  );
}
