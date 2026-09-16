import { profileSchema, type ProfileFormInput, type ProfileInput } from '@jobtrack/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { applyFieldErrors, topLevelMessage } from '@/features/auth/lib/form-errors';
import { zodResolverWith } from '@/lib/forms';
import { fetchProfile, updateProfile, type ProfileDto } from '@/services/api/profile';

/** Sous-ensemble de `ProfileFormInput` réellement possédé par cette carte. */
type ProfessionalFormInput = Pick<ProfileFormInput, 'title' | 'summary' | 'yearsExperience'>;

const FIELDS = ['title', 'summary', 'yearsExperience'] as const;
const PROFILE_QUERY_KEY = ['profile'] as const;
const SUMMARY_MAX = 2000;

function toFormValues(profile: ProfileDto): ProfessionalFormInput {
  return {
    title: profile.title ?? '',
    summary: profile.summary ?? '',
    yearsExperience: profile.yearsExperience ?? '',
  };
}

export function ProfessionalCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: fetchProfile });
  const [formAlert, setFormAlert] = useState<string>();

  const form = useForm<ProfessionalFormInput, unknown, ProfileInput>({
    // `firstName`/`lastName` sont obligatoires dans `profileSchema` mais cette carte ne les
    // affiche pas : on les complète depuis le profil déjà chargé pour que la validation du
    // schéma partagé passe. Le corps réellement envoyé (voir `onSubmit`) les réinclut aussi
    // — PATCH avec la même valeur qu'en base est idempotent — plutôt que de les omettre : le
    // serveur exige ces deux clés (`profileSchema` les valide toujours), les omettre ferait
    // échouer chaque enregistrement avec une 400 `VALIDATION_ERROR`.
    resolver: zodResolverWith<ProfessionalFormInput, ProfileInput>(profileSchema, (raw) => ({
      ...(raw as Record<string, unknown>),
      firstName: query.data?.firstName ?? '',
      lastName: query.data?.lastName ?? '',
    })),
    defaultValues: { title: '', summary: '', yearsExperience: '' },
  });

  useEffect(() => {
    if (query.data) form.reset(toFormValues(query.data));
  }, [query.data, form]);

  const mutation = useMutation({
    mutationFn: (body: ProfileFormInput) => updateProfile(body),
    onSuccess: (updated) => {
      toast.success('Enregistré.');
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
      form.reset(toFormValues(updated));
    },
    onError: (error: unknown) => {
      if (applyFieldErrors<ProfessionalFormInput>(error, form.setError, FIELDS)) {
        setFormAlert(undefined);
        return;
      }
      setFormAlert(topLevelMessage(error));
    },
  });

  function onSubmit(): void {
    if (!query.data) return;
    // `firstName`/`lastName` réinjectés depuis le profil chargé : le serveur les exige
    // (voir le commentaire sur le résolveur ci-dessus), et cette carte ne les édite jamais.
    mutation.mutate({ ...form.getValues(), firstName: query.data.firstName, lastName: query.data.lastName });
  }

  const summaryLength = (form.watch('summary') ?? '').length;

  if (query.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profil professionnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profil professionnel</CardTitle>
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
          <CardTitle>Profil professionnel</CardTitle>
          <CardDescription>Votre titre et votre résumé de carrière.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServerErrorAlert message={formAlert} />
          <div className="space-y-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              placeholder="Ex. Développeuse full-stack"
              aria-invalid={form.formState.errors.title ? true : undefined}
              aria-describedby={form.formState.errors.title ? 'title-error' : undefined}
              {...form.register('title')}
            />
            <FormFieldError id="title-error" message={form.formState.errors.title?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary">Résumé</Label>
            <Textarea
              id="summary"
              rows={5}
              maxLength={SUMMARY_MAX}
              aria-invalid={form.formState.errors.summary ? true : undefined}
              aria-describedby={form.formState.errors.summary ? 'summary-counter summary-error' : 'summary-counter'}
              {...form.register('summary')}
            />
            <p id="summary-counter" className="text-muted-foreground text-right text-xs">
              {summaryLength}/{SUMMARY_MAX}
            </p>
            <FormFieldError id="summary-error" message={form.formState.errors.summary?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="yearsExperience">Années d'expérience</Label>
            <Input
              id="yearsExperience"
              type="number"
              min={0}
              aria-invalid={form.formState.errors.yearsExperience ? true : undefined}
              aria-describedby={form.formState.errors.yearsExperience ? 'yearsExperience-error' : undefined}
              {...form.register('yearsExperience')}
            />
            <FormFieldError id="yearsExperience-error" message={form.formState.errors.yearsExperience?.message} />
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
