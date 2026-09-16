import type { LucideIcon } from 'lucide-react';
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import type { ZodType, ZodTypeDef } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { zodResolverWith } from '@/lib/forms';
import { cn } from '@/lib/utils';

/**
 * Élément d'un bloc de revue : coché par défaut par l'appelant
 * (`ExtractionReview`). `id` est stable (attribué une seule fois à
 * l'initialisation, jamais recalculé à partir de la position) : il sert de
 * cible de focus/défilement et de clé de correspondance avec les erreurs
 * serveur, y compris après un réordonnancement par sélection. `error` est un
 * message de validation (client, avant envoi, ou serveur, après un rejet) —
 * absent tant que la ligne n'a pas été soumise ou jugée invalide.
 */
export interface ReviewRow<TValues> {
  id: string;
  selected: boolean;
  values: TValues;
  error?: string;
}

interface ReviewBlockProps<TValues extends FieldValues, TOutput> {
  icon: LucideIcon;
  title: string;
  rows: ReviewRow<TValues>[];
  onChange: (rows: ReviewRow<TValues>[]) => void;
  /** Le schéma zod strict et partagé de la collection (celui du profil) — jamais un doublon. */
  schema: ZodType<TOutput, ZodTypeDef, unknown>;
  /** La fonction `normalize` exportée par la section de profil correspondante. */
  normalize: (raw: TValues) => unknown;
  /** Le composant de champs exporté par la section de profil correspondante. */
  renderFields: (form: UseFormReturn<TValues>) => ReactNode;
  renderSummary: (values: TValues) => ReactNode;
  /** Libellé accessible d'une ligne (ex. « Développeuse junior – Beta SARL »), pour les noms des contrôles. */
  rowLabel: (values: TValues) => string;
}

/**
 * Bloc de revue d'une collection extraite d'un CV (expériences, formations,
 * compétences, langues, certifications, projets) : chaque élément est
 * cochable et éditable en place via le même dialogue, les mêmes champs
 * (`renderFields`) et le même schéma strict (`schema` + `normalize`) que la
 * section correspondante du profil — jamais un doublon de validation. Les
 * lignes elles-mêmes (ajout/suppression) ne sont pas modifiables ici : seules
 * la sélection et l'édition en place le sont, l'ajout manuel restant réservé
 * au profil une fois l'import appliqué.
 */
export function ReviewBlock<TValues extends FieldValues, TOutput>({
  icon: Icon,
  title,
  rows,
  onChange,
  schema,
  normalize,
  renderFields,
  renderSummary,
  rowLabel,
}: ReviewBlockProps<TValues, TOutput>) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const form = useForm<TValues, unknown, TOutput>({
    resolver: zodResolverWith<TValues, TOutput>(schema, (raw) => normalize(raw as TValues)),
  });

  const selectedCount = rows.filter((row) => row.selected).length;

  function setAll(selected: boolean): void {
    onChange(rows.map((row) => ({ ...row, selected })));
  }

  function toggleRow(index: number): void {
    onChange(
      rows.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const selected = !row.selected;
        // Décocher exclut la ligne de l'envoi : une erreur laissée par une tentative
        // précédente n'a alors plus de sens à afficher.
        return { ...row, selected, error: selected ? row.error : undefined };
      }),
    );
  }

  function openEdit(index: number): void {
    const row = rows[index];
    if (!row) return;
    form.reset(row.values);
    // Une ligne déjà signalée invalide (revue avant envoi, ou rejet serveur) rouvre son
    // dialogue avec les mêmes erreurs déjà visibles, plutôt qu'un formulaire muet qu'il
    // faudrait resoumettre une première fois pour les voir apparaître.
    if (row.error) void form.trigger();
    setEditingIndex(index);
  }

  function onSubmit(): void {
    if (editingIndex === null) return;
    const values = form.getValues();
    onChange(rows.map((row, rowIndex) => (rowIndex === editingIndex ? { ...row, values } : row)));
    setEditingIndex(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4" aria-hidden />
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {selectedCount} sur {rows.length} sélectionné{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
            Tout
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>
            Aucun
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {rows.map((row, index) => {
          const label = rowLabel(row.values);
          const errorId = `${row.id}-error`;
          return (
            <li
              key={row.id}
              id={row.id}
              tabIndex={-1}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3',
                row.error && 'border-destructive focus:outline-none',
              )}
            >
              <Checkbox
                className="mt-1"
                checked={row.selected}
                onCheckedChange={() => toggleRow(index)}
                aria-label={`Inclure « ${label} »`}
              />
              <div className="min-w-0 flex-1">
                {renderSummary(row.values)}
                <FormFieldError id={errorId} message={row.error} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Modifier « ${label} »`}
                aria-describedby={row.error ? errorId : undefined}
                onClick={() => openEdit(index)}
              >
                <Pencil />
              </Button>
            </li>
          );
        })}
      </ul>

      <Dialog open={editingIndex !== null} onOpenChange={(open) => !open && setEditingIndex(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifier</DialogTitle>
            <DialogDescription className="sr-only">Renseignez les champs puis enregistrez.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate>
            {/* Même cast documenté que `collection-section.tsx` : `renderFields` n'utilise jamais
                `handleSubmit` (seul membre dont le type dépend du 3ᵉ paramètre générique `TOutput`
                de `form`), donc caster vers `UseFormReturn<TValues>` (défaut `TTransformedValues =
                TValues`) n'efface rien d'observable pour `register`/`watch`/`setValue`/`control`/`formState`. */}
            {renderFields(form as unknown as UseFormReturn<TValues>)}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingIndex(null)}>
                Annuler
              </Button>
              <Button type="submit">Enregistrer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
