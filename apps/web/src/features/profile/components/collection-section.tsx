import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, type LucideIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DefaultValues, FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { ZodType, ZodTypeDef } from 'zod';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { applyFieldErrors, topLevelMessage } from '@/features/auth/lib/form-errors';
import { zodResolverWith } from '@/lib/forms';
import {
  createItem,
  deleteItem,
  fetchCollection,
  reorderCollection,
  updateItem,
  type CollectionInputs,
  type CollectionItem,
  type CollectionName,
  type CollectionOutputs,
} from '@/services/api/profile';

interface CollectionSectionProps<N extends CollectionName, TValues extends FieldValues> {
  name: N;
  title: string;
  description: string;
  icon: LucideIcon;
  emptyLabel: string;
  addLabel: string;
  /** Utilisé comme libellé accessible du bouton de suppression de chaque ligne (ex. « cette expérience »). */
  deleteLabel: string;
  /** Le schéma zod partagé de `@jobtrack/shared` — jamais un doublon ad hoc. */
  schema: ZodType<CollectionOutputs[N], ZodTypeDef, unknown>;
  defaultValues: TValues;
  /** Adapte les valeurs brutes du formulaire (`TValues`, ce qu'un champ HTML produit) à ce que `schema` accepte en entrée. */
  normalize: (raw: TValues) => unknown;
  /** Pré-remplit le formulaire d'édition depuis l'item de l'API (`null` → `''`, tableaux → chaîne jointe). */
  toFormValues: (item: CollectionItem<N>) => TValues;
  renderSummary: (item: CollectionItem<N>) => ReactNode;
  renderFields: (form: UseFormReturn<TValues>) => ReactNode;
}

type DialogState<N extends CollectionName> = { mode: 'create' } | { mode: 'edit'; item: CollectionItem<N> } | null;

/**
 * Section générique de collection de profil (expériences, formations,
 * compétences, langues, certifications, projets) : liste avec chargement /
 * vide / erreur, ajout et édition via une boîte de dialogue partagée,
 * suppression avec confirmation, réordonnancement par boutons (pas de
 * glisser-déposer). Typée par `N` (la collection) et `TValues` (les valeurs
 * de formulaire réellement produites par les champs HTML de cette
 * collection, inférées depuis `defaultValues`) : aucune coercion
 * `Record<string, unknown>` ni érasure de schéma à la frontière publique.
 */
export function CollectionSection<N extends CollectionName, TValues extends FieldValues>({
  name,
  title,
  description,
  icon,
  emptyLabel,
  addLabel,
  deleteLabel,
  schema,
  defaultValues,
  normalize,
  toFormValues,
  renderSummary,
  renderFields,
}: CollectionSectionProps<N, TValues>) {
  const queryClient = useQueryClient();
  const queryKey = ['profile', name] as const;
  const query = useQuery({ queryKey, queryFn: () => fetchCollection(name) });

  const [dialogState, setDialogState] = useState<DialogState<N>>(null);
  const [pendingDelete, setPendingDelete] = useState<CollectionItem<N> | null>(null);
  const [formAlert, setFormAlert] = useState<string>();

  const form = useForm<TValues, unknown, CollectionOutputs[N]>({
    // `raw` est ici nécessairement les valeurs actuelles du formulaire (`TValues`) : React
    // Hook Form appelle le résolveur avec son propre état interne, que le type public de
    // `zodResolverWith` n'exprime que comme `unknown` (voir `lib/forms.ts`) puisqu'il ne
    // connaît pas la forme concrète attendue par chaque section.
    resolver: zodResolverWith<TValues, CollectionOutputs[N]>(schema, (raw) => normalize(raw as TValues)),
    // Seul cast restant : `defaultValues` (une valeur `TValues` concrète) vers le type
    // `DefaultValues<TValues>` de React Hook Form (une version « deep partial » de
    // `TValues`) — une valeur complète satisfait toujours une version partielle d'elle-même.
    defaultValues: defaultValues as DefaultValues<TValues>,
  });

  function openCreate() {
    form.reset(defaultValues);
    setFormAlert(undefined);
    setDialogState({ mode: 'create' });
  }

  function openEdit(item: CollectionItem<N>) {
    form.reset(toFormValues(item));
    setFormAlert(undefined);
    setDialogState({ mode: 'edit', item });
  }

  const saveMutation = useMutation({
    mutationFn: (body: CollectionInputs[N]) =>
      dialogState?.mode === 'edit' ? updateItem(name, dialogState.item.id, body) : createItem(name, body),
    onSuccess: () => {
      toast.success('Enregistré.');
      setDialogState(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) => {
      const fields = Object.keys(form.getValues()) as Path<TValues>[];
      if (applyFieldErrors(error, form.setError, fields)) {
        setFormAlert(undefined);
        return;
      }
      setFormAlert(topLevelMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItem(name, id),
    onSuccess: () => {
      toast.success('Élément supprimé.');
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) => {
      toast.error(topLevelMessage(error));
      setPendingDelete(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderCollection(name, { ids }),
    onMutate: (ids: string[]) => {
      const previous = queryClient.getQueryData<CollectionItem<N>[]>(queryKey);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        const next = ids
          .map((id) => byId.get(id))
          .filter((item): item is CollectionItem<N> => item !== undefined);
        queryClient.setQueryData(queryKey, next);
      }
      return { previous };
    },
    onError: (error: unknown, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(topLevelMessage(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  function move(items: readonly CollectionItem<N>[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const current = items[index];
    const target = items[targetIndex];
    if (!current || !target) return;
    const reordered = [...items];
    reordered[index] = target;
    reordered[targetIndex] = current;
    reorderMutation.mutate(reordered.map((item) => item.id));
  }

  function onSubmit(): void {
    // Corps envoyé = valeurs normalisées (pas `result.data` du résolveur, qui porte les
    // transformations de *sortie* du schéma, ex. `'' -> null`) : l'API retransforme
    // elle-même les valeurs d'entrée via le même schéma partagé.
    const body = normalize(form.getValues()) as CollectionInputs[N];
    saveMutation.mutate(body);
  }

  // Pendant une suppression, « Modifier »/« Supprimer » sont désactivés sur toutes les
  // lignes (pas seulement celle visée) : éviter d'ouvrir une édition ou une seconde
  // suppression sur une liste dont l'ordre/le contenu est en train de changer côté serveur.
  const rowMutationPending = deleteMutation.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={openCreate}>
              <Plus />
              {addLabel}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {query.isPending && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {query.isError && (
            <ErrorState message={topLevelMessage(query.error)} onRetry={() => void query.refetch()} role="status" />
          )}

          {query.isSuccess &&
            (query.data.length === 0 ? (
              <EmptyState
                icon={icon}
                title={emptyLabel}
                description="Ajoutez votre premier élément pour commencer."
                action={{ label: addLabel, onClick: openCreate }}
              />
            ) : (
              <ul className="space-y-3">
                {query.data.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">{renderSummary(item)}</div>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Monter"
                        disabled={index === 0 || reorderMutation.isPending}
                        onClick={() => move(query.data, index, -1)}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Descendre"
                        disabled={index === query.data.length - 1 || reorderMutation.isPending}
                        onClick={() => move(query.data, index, 1)}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Modifier"
                        disabled={rowMutationPending}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={deleteLabel}
                        disabled={rowMutationPending}
                        onClick={() => setPendingDelete(item)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </CardContent>
      </Card>

      <Dialog open={dialogState !== null} onOpenChange={(open) => !open && setDialogState(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState?.mode === 'edit' ? 'Modifier' : addLabel}</DialogTitle>
            <DialogDescription className="sr-only">Renseignez les champs puis enregistrez.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate>
            <ServerErrorAlert message={formAlert} />
            {/* `renderFields` n'utilise jamais `handleSubmit` (seul membre dont le type dépend
                du 3ᵉ paramètre générique `CollectionOutputs[N]` de `form`) : caster vers
                `UseFormReturn<TValues>` (défaut `TTransformedValues = TValues`) n'efface donc
                rien d'observable pour `register`/`watch`/`setValue`/`control`/`formState`. */}
            {renderFields(form as unknown as UseFormReturn<TValues>)}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogState(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Supprimer cet élément ?</DialogTitle>
            <DialogDescription>Cette action est irréversible.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
