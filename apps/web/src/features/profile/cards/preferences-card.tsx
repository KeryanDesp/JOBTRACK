import { jobPreferencesSchema, type JobPreferencesFormInput, type JobPreferencesInput } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { profileKeys } from '@/features/profile/lib/query-keys';
import { joinTags, splitTags, zodResolverWith } from '@/lib/forms';
import {
  fetchPreferences,
  updatePreferences,
  type ContractType,
  type ExperienceLevel,
  type PreferencesDto,
  type RemoteMode,
} from '@/services/api/profile';

/** Sentinelle d'affichage pour « aucun niveau choisi » : jamais stockée dans le formulaire. */
const UNSET = 'UNSET' as const;

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

const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
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

/**
 * Les trois champs « tags » restent des chaînes séparées par des virgules côté
 * formulaire (voir `sections/experiences-section.tsx` pour le même principe
 * appliqué à une date). `remoteModes`/`contractTypes` sont déjà des tableaux
 * (cases à cocher) ; `experienceLevel` reste optionnel comme dans le schéma —
 * la sentinelle `UNSET` n'existe qu'au niveau de l'affichage du `Select`.
 */
type PreferencesFormValues = Omit<JobPreferencesFormInput, 'desiredRoles' | 'desiredCategories' | 'locations'> & {
  desiredRoles: string;
  desiredCategories: string;
  locations: string;
};

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function normalize(raw: PreferencesFormValues): unknown {
  let value = raw as unknown as Record<string, unknown>;
  value = splitTags(value, 'desiredRoles');
  value = splitTags(value, 'desiredCategories');
  value = splitTags(value, 'locations');
  return value;
}

function toFormValues(preferences: PreferencesDto): PreferencesFormValues {
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
    experienceLevel: preferences.experienceLevel ?? undefined,
  };
}

const DEFAULT_VALUES: PreferencesFormValues = {
  desiredRoles: '',
  desiredCategories: '',
  salaryMin: '',
  salaryMax: '',
  locations: '',
  searchRadiusKm: '',
  remoteModes: [],
  contractTypes: [],
  availability: '',
};

export function PreferencesCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: profileKeys.preferences, queryFn: fetchPreferences });
  const [formAlert, setFormAlert] = useState<string>();

  const form = useForm<PreferencesFormValues, unknown, JobPreferencesInput>({
    resolver: zodResolverWith<PreferencesFormValues, JobPreferencesInput>(jobPreferencesSchema, (raw) =>
      normalize(raw as PreferencesFormValues),
    ),
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (query.data) form.reset(toFormValues(query.data));
  }, [query.data, form]);

  const mutation = useMutation({
    mutationFn: (body: JobPreferencesFormInput) => updatePreferences(body),
    onSuccess: (updated) => {
      toast.success('Enregistré.');
      queryClient.setQueryData(profileKeys.preferences, updated);
      form.reset(toFormValues(updated));
    },
    onError: (error: unknown) => {
      if (applyFieldErrors<PreferencesFormValues>(error, form.setError, FIELDS)) {
        setFormAlert(undefined);
        return;
      }
      setFormAlert(topLevelMessage(error));
    },
  });

  function onSubmit(): void {
    mutation.mutate(normalize(form.getValues()) as JobPreferencesFormInput);
  }

  const errors = form.formState.errors;

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
            <Input
              id="desiredRoles"
              aria-invalid={errors.desiredRoles ? true : undefined}
              aria-describedby={errors.desiredRoles ? 'desiredRoles-hint desiredRoles-error' : 'desiredRoles-hint'}
              {...form.register('desiredRoles')}
            />
            <p id="desiredRoles-hint" className="text-muted-foreground text-sm">
              Séparez par des virgules.
            </p>
            <FormFieldError id="desiredRoles-error" message={errors.desiredRoles?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desiredCategories">Catégories recherchées</Label>
            <Input
              id="desiredCategories"
              aria-invalid={errors.desiredCategories ? true : undefined}
              aria-describedby={
                errors.desiredCategories ? 'desiredCategories-hint desiredCategories-error' : 'desiredCategories-hint'
              }
              {...form.register('desiredCategories')}
            />
            <p id="desiredCategories-hint" className="text-muted-foreground text-sm">
              Séparez par des virgules.
            </p>
            <FormFieldError id="desiredCategories-error" message={errors.desiredCategories?.message} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="salaryMin">Salaire minimum</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="salaryMin"
                  type="number"
                  min={0}
                  aria-invalid={errors.salaryMin ? true : undefined}
                  aria-describedby={errors.salaryMin ? 'salaryMin-error' : undefined}
                  {...form.register('salaryMin')}
                />
                <span className="text-muted-foreground text-sm">€</span>
              </div>
              <FormFieldError id="salaryMin-error" message={errors.salaryMin?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryMax">Salaire maximum</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="salaryMax"
                  type="number"
                  min={0}
                  aria-invalid={errors.salaryMax ? true : undefined}
                  aria-describedby={errors.salaryMax ? 'salaryMax-error' : undefined}
                  {...form.register('salaryMax')}
                />
                <span className="text-muted-foreground text-sm">€</span>
              </div>
              <FormFieldError id="salaryMax-error" message={errors.salaryMax?.message} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Devise</Label>
            <Input id="currency" value={query.data.currency} disabled readOnly />
          </div>

          <div className="space-y-2">
            <Label htmlFor="locations">Lieux recherchés</Label>
            <Input
              id="locations"
              aria-invalid={errors.locations ? true : undefined}
              aria-describedby={errors.locations ? 'locations-hint locations-error' : 'locations-hint'}
              {...form.register('locations')}
            />
            <p id="locations-hint" className="text-muted-foreground text-sm">
              Séparez par des virgules.
            </p>
            <FormFieldError id="locations-error" message={errors.locations?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="searchRadiusKm">Rayon de recherche (km)</Label>
            <Input
              id="searchRadiusKm"
              type="number"
              min={0}
              aria-invalid={errors.searchRadiusKm ? true : undefined}
              aria-describedby={errors.searchRadiusKm ? 'searchRadiusKm-error' : undefined}
              {...form.register('searchRadiusKm')}
            />
            <FormFieldError id="searchRadiusKm-error" message={errors.searchRadiusKm?.message} />
          </div>

          <div className="space-y-2">
            <Label id="remoteModes-label">Modes de travail</Label>
            <Controller
              control={form.control}
              name="remoteModes"
              render={({ field }) => (
                <div className="flex flex-wrap gap-4" aria-labelledby="remoteModes-label">
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
            <FormFieldError message={errors.remoteModes?.message} />
          </div>

          <div className="space-y-2">
            <Label id="contractTypes-label">Types de contrat</Label>
            <Controller
              control={form.control}
              name="contractTypes"
              render={({ field }) => (
                <div className="flex flex-wrap gap-4" aria-labelledby="contractTypes-label">
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
            <FormFieldError message={errors.contractTypes?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="experienceLevel">Niveau d'expérience</Label>
            {/*
              Choisir « Non précisé » retire la clé du corps envoyé (`undefined` disparaît au
              `JSON.stringify`), donc n'écrit jamais rien côté serveur. Effacer un niveau déjà
              enregistré nécessiterait que `jobPreferencesSchema.experienceLevel` accepte aussi
              `null` (comme `endDate` ailleurs) : hors périmètre ici, ça changerait le schéma
              partagé — pour l'instant, un niveau déjà posé ne peut qu'être remplacé, pas effacé.
            */}
            <Controller
              control={form.control}
              name="experienceLevel"
              render={({ field }) => (
                <Select
                  value={field.value ?? UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? undefined : value)}
                >
                  <SelectTrigger
                    id="experienceLevel"
                    className="w-full"
                    aria-invalid={errors.experienceLevel ? true : undefined}
                    aria-describedby={errors.experienceLevel ? 'experienceLevel-error' : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Non précisé</SelectItem>
                    {Object.entries(EXPERIENCE_LEVEL_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormFieldError id="experienceLevel-error" message={errors.experienceLevel?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="availability">Disponibilité</Label>
            <Input
              id="availability"
              placeholder="Ex. Disponible immédiatement"
              aria-invalid={errors.availability ? true : undefined}
              aria-describedby={errors.availability ? 'availability-error' : undefined}
              {...form.register('availability')}
            />
            <FormFieldError id="availability-error" message={errors.availability?.message} />
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
