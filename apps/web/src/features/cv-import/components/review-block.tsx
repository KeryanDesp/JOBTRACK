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
import { zodResolverWith } from '@/lib/forms';

/** Élément d'un bloc de revue : coché par défaut par l'appelant (`ExtractionReview`). */
export interface ReviewRow<TValues> {
  selected: boolean;
  values: TValues;
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
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, selected: !row.selected } : row)));
  }

  function openEdit(index: number): void {
    const row = rows[index];
    if (!row) return;
    form.reset(row.values);
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
          <span className="text-muted-foreground text-xs">
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
        {rows.map((row, index) => (
          <li key={index} className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              className="mt-1"
              checked={row.selected}
              onCheckedChange={() => toggleRow(index)}
              aria-label={`Inclure cet élément dans « ${title} »`}
            />
            <div className="min-w-0 flex-1">{renderSummary(row.values)}</div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Modifier cet élément dans « ${title} »`}
              onClick={() => openEdit(index)}
            >
              <Pencil />
            </Button>
          </li>
        ))}
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
