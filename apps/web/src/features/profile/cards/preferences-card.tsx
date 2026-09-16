import { jobPreferencesSchema, type JobPreferencesFormInput } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { applyFieldErrors, topLevelMessage } from '@/features/auth/lib/form-errors';
import { joinTags, splitTags, zodResolverWith } from '@/lib/forms';
import { fetchPreferences, updatePreferences, type ContractType, type PreferencesDto, type RemoteMode } from '@/services/api/profile';

const PREFERENCES_QUERY_KEY = ['profile', 'preferences'] as const;

const REMOTE_MODE_OPTIONS: { value: RemoteMode; label: string }[] = [
  { value: 'ONSITE', label: 'Sur site' },
  { value: 'HYBRID', label: 'Hybride' },
  { value: 'REMOTE', label: 'Télétravail' },
];

const CONTRACT_TYPE_OPTIONS: { value: ContractType; label: string }[] = [
  { value: 'CDI', label: 'CDI' },
  { value: 'CDD', label: 'CDD' },
  { value: 'INTERNSHIP', label: 'Stage' },
  { value: 'APPRENTICESHIP', label: 'Alternance' },
  { value: 'FREELANCE', label: 'Freelance' },
  { value: 'PART_TIME', label: 'Temps partiel' },
];

const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
  STUDENT: 'Étudiant',
  JUNIOR: 'Junior',
  MID: 'Confirmé',
  SENIOR: 'Senior',
  LEAD: 'Lead',
};

const FIELDS = [
  'desiredRoles',
  'desiredCategories',
  'salaryMin',
  'salaryMax',
  'locations',
  'searchRadiusKm',
  'remoteModes',
  'contractTypes',
  'availability',
  'experienceLevel',
] as const;

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

// Les trois champs « tags » sont saisis en texte séparé par des virgules côté
// formulaire ; le schéma partagé attend des tableaux. `remoteModes`/`contractTypes`
// sont déjà des tableaux (cases à cocher) et n'ont pas besoin de conversion.
function normalize(raw: unknown): unknown {
  let value = raw as Record<string, unknown>;
  value = splitTags(value, 'desiredRoles');
  value = splitTags(value, 'desiredCategories');
  value = splitTags(value, 'locations');
  return value;
}

function toFormValues(preferences: PreferencesDto): JobPreferencesFormInput {
  return {
    desiredRoles: joinTags(preferences.desiredRoles),
    desiredCategories: joinTags(preferences.desiredCategories),
    salaryMin: preferences.salaryMin ?? '',
    salaryMax: preferences.salaryMax ?? '',
    locations: joinTags(preferences.locations),
    searchRadiusKm: preferences.searchRadiusKm,
    remoteModes: preferences.remoteModes,
    contractTypes: preferences.contractTypes,
    availability: preferences.availability ?? '',
    experienceLevel: preferences.experienceLevel ?? 'JUNIOR',
  } as unknown as JobPreferencesFormInput;
}

const DEFAULT_VALUES = {
  desiredRoles: '',
  desiredCategories: '',
  salaryMin: '',
  salaryMax: '',
  locations: '',
  searchRadiusKm: '',
  remoteModes: [],
  contractTypes: [],
  availability: '',
  experienceLevel: 'JUNIOR',
} as unknown as JobPreferencesFormInput;

export function PreferencesCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PREFERENCES_QUERY_KEY, queryFn: fetchPreferences });
  const [formAlert, setFormAlert] = useState<string>();

  const form = useForm<JobPreferencesFormInput>({
    // Cast justifié comme dans `personal-info-card.tsx` : les cinq tableaux sont des clés
    // obligatoires de `JobPreferencesFormInput`, qu'un `Record<string, any>` ne garantit pas.
    resolver: zodResolverWith(jobPreferencesSchema, normalize) as unknown as Resolver<JobPreferencesFormInput>,
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (query.data) form.reset(toFormValues(query.data));
  }, [query.data, form]);

  const mutation = useMutation({
    mutationFn: (body: JobPreferencesFormInput) => updatePreferences(body),
    onSuccess: (updated) => {
      toast.success('Enregistré.');
      queryClient.setQueryData(PREFERENCES_QUERY_KEY, updated);
      form.reset(toFormValues(updated));
    },
    onError: (error: unknown) => {
      if (applyFieldErrors<JobPreferencesFormInput>(error, form.setError, FIELDS)) {
        setFormAlert(undefined);
        return;
      }
      setFormAlert(topLevelMessage(error));
    },
  });

  function onSubmit(): void {
    mutation.mutate(normalize(form.getValues()) as JobPreferencesFormInput);
  }

  if (query.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Préférences de recherche</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Préférences de recherche</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState message={topLevelMessage(query.error)} onRetry={() => void query.refetch()} role="status" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate>
        <CardHeader>
          <CardTitle>Préférences de recherche</CardTitle>
          <CardDescription>Ce que vous recherchez pour votre prochain poste.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServerErrorAlert message={formAlert} />

          <div className="space-y-2">
            <Label htmlFor="desiredRoles">Postes recherchés</Label>
            <Input id="desiredRoles" {...form.register('desiredRoles')} />
            <p className="text-muted-foreground text-sm">Séparez par des virgules.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="desiredCategories">Catégories recherchées</Label>
            <Input id="desiredCategories" {...form.register('desiredCategories')} />
            <p className="text-muted-foreground text-sm">Séparez par des virgules.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="salaryMin">Salaire minimum</Label>
              <div className="flex items-center gap-2">
                <Input id="salaryMin" type="number" min={0} {...form.register('salaryMin')} />
                <span className="text-muted-foreground text-sm">€</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryMax">Salaire maximum</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="salaryMax"
                  type="number"
                  min={0}
                  aria-invalid={form.formState.errors.salaryMax ? true : undefined}
                  {...form.register('salaryMax')}
                />
                <span className="text-muted-foreground text-sm">€</span>
              </div>
              <FormFieldError message={form.formState.errors.salaryMax?.message} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Devise</Label>
            <Input id="currency" value={query.data.currency} disabled readOnly />
          </div>

          <div className="space-y-2">
            <Label htmlFor="locations">Lieux recherchés</Label>
            <Input id="locations" {...form.register('locations')} />
            <p className="text-muted-foreground text-sm">Séparez par des virgules.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="searchRadiusKm">Rayon de recherche (km)</Label>
            <Input id="searchRadiusKm" type="number" min={0} {...form.register('searchRadiusKm')} />
          </div>

          <div className="space-y-2">
            <Label>Modes de travail</Label>
            <Controller
              control={form.control}
              name="remoteModes"
              render={({ field }) => (
                <div className="flex flex-wrap gap-4">
                  {REMOTE_MODE_OPTIONS.map((option) => {
                    const selected = (field.value as string[] | undefined) ?? [];
                    return (
                      <label key={option.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selected.includes(option.value)}
                          onCheckedChange={() => field.onChange(toggle(selected, option.value))}
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label>Types de contrat</Label>
            <Controller
              control={form.control}
              name="contractTypes"
              render={({ field }) => (
                <div className="flex flex-wrap gap-4">
                  {CONTRACT_TYPE_OPTIONS.map((option) => {
                    const selected = (field.value as string[] | undefined) ?? [];
                    return (
                      <label key={option.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selected.includes(option.value)}
                          onCheckedChange={() => field.onChange(toggle(selected, option.value))}
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="experienceLevel">Niveau d'expérience</Label>
            <Controller
              control={form.control}
              name="experienceLevel"
              render={({ field }) => (
                <Select value={field.value ?? 'JUNIOR'} onValueChange={field.onChange}>
                  <SelectTrigger id="experienceLevel" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPERIENCE_LEVEL_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="availability">Disponibilité</Label>
            <Input id="availability" placeholder="Ex. Disponible immédiatement" {...form.register('availability')} />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
