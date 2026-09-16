import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, type LucideIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DefaultValues, Path, Resolver, UseFormReturn } from 'react-hook-form';
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

interface CollectionSectionProps<N extends CollectionName> {
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
  defaultValues: CollectionInputs[N];
  /** Adapte les valeurs brutes du formulaire à ce que `schema` accepte en entrée (voir `lib/forms.ts`). */
  normalize: (raw: unknown) => unknown;
  /** Pré-remplit le formulaire d'édition depuis l'item de l'API (`null` → `''`, tableaux → chaîne jointe). */
  toFormValues: (item: CollectionItem<N>) => CollectionInputs[N];
  renderSummary: (item: CollectionItem<N>) => ReactNode;
  renderFields: (form: UseFormReturn<CollectionInputs[N]>) => ReactNode;
}

type DialogState<N extends CollectionName> = { mode: 'create' } | { mode: 'edit'; item: CollectionItem<N> } | null;

/**
 * Section générique de collection de profil (expériences, formations,
 * compétences, langues, certifications, projets) : liste avec chargement /
 * vide / erreur, ajout et édition via une boîte de dialogue partagée,
 * suppression avec confirmation, réordonnancement par boutons (pas de
 * glisser-déposer). Typée par `N` : aucune coercion `Record<string, unknown>`
 * ni érasure de schéma, chaque instanciation (`name="experiences"`, etc.)
 * garde les types précis de `@/services/api/profile`.
 */
export function CollectionSection<N extends CollectionName>({
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
}: CollectionSectionProps<N>) {
  const queryClient = useQueryClient();
  const queryKey = ['profile', name] as const;
  const query = useQuery({ queryKey, queryFn: () => fetchCollection(name) });

  const [dialogState, setDialogState] = useState<DialogState<N>>(null);
  const [pendingDelete, setPendingDelete] = useState<CollectionItem<N> | null>(null);
  const [formAlert, setFormAlert] = useState<string>();

  // `CollectionInputs[N]` avec `N` encore générique ici (pas une collection
  // littérale) : TypeScript ne distribue pas l'accès indexé sur l'union des six
  // formes et réduit l'intersection à `never` dès qu'un champ (ex. `level`,
  // skill vs langue) diffère entre elles. Ces deux casts sont le seul endroit
  // qui contourne cette limitation ; la frontière publique du composant
  // (props, `renderFields`) reste typée précisément par `N`.
  const form = useForm<CollectionInputs[N], unknown, CollectionInputs[N]>({
    resolver: zodResolverWith(schema, normalize) as unknown as Resolver<CollectionInputs[N], unknown, CollectionInputs[N]>,
    defaultValues: defaultValues as DefaultValues<CollectionInputs[N]>,
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
      const fields = Object.keys(form.getValues()) as Path<CollectionInputs[N]>[];
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
                        disabled={index === 0}
                        onClick={() => move(query.data, index, -1)}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Descendre"
                        disabled={index === query.data.length - 1}
                        onClick={() => move(query.data, index, 1)}
                      >
                        <ChevronDown />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Modifier" onClick={() => openEdit(item)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={deleteLabel}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogState?.mode === 'edit' ? 'Modifier' : addLabel}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate>
            <ServerErrorAlert message={formAlert} />
            {renderFields(form)}
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
        <DialogContent>
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
