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
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { useSession, useSetSession } from '@/features/auth/hooks/use-session';
import { applyFieldErrors, topLevelMessage } from '@/features/auth/lib/form-errors';
import { zodResolverWith } from '@/lib/forms';
import { fetchProfile, updateProfile } from '@/services/api/profile';

const FIELDS = ['firstName', 'lastName', 'phone', 'city', 'country'] as const;
const PROFILE_QUERY_KEY = ['profile'] as const;

function toFormValues(profile: {
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  country: string | null;
}): ProfileFormInput {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone ?? '',
    city: profile.city ?? '',
    country: profile.country ?? '',
  };
}

export function PersonalInfoCard() {
  const queryClient = useQueryClient();
  const session = useSession();
  const setSession = useSetSession();
  const query = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: fetchProfile });
  const [formAlert, setFormAlert] = useState<string>();

  const form = useForm<ProfileFormInput, unknown, ProfileInput>({
    resolver: zodResolverWith<ProfileFormInput, ProfileInput>(profileSchema, (raw) => raw),
    defaultValues: { firstName: '', lastName: '', phone: '', city: '', country: '' },
  });

  useEffect(() => {
    if (query.data) form.reset(toFormValues(query.data));
    // `form` (React Hook Form) garde la même identité entre les rendus : l'inclure
    // ici ne redéclenche jamais cet effet en dehors d'un vrai changement de `query.data`.
  }, [query.data, form]);

  const mutation = useMutation({
    mutationFn: (body: ProfileFormInput) => updateProfile(body),
    onSuccess: (updated) => {
      toast.success('Enregistré.');
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
      if (session.data) {
        setSession({ ...session.data, firstName: updated.firstName, lastName: updated.lastName });
      }
      form.reset(toFormValues(updated));
    },
    onError: (error: unknown) => {
      if (applyFieldErrors<ProfileFormInput>(error, form.setError, FIELDS)) {
        setFormAlert(undefined);
        return;
      }
      setFormAlert(topLevelMessage(error));
    },
  });

  function onSubmit(): void {
    mutation.mutate(form.getValues());
  }

  if (query.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Informations personnelles</CardTitle>
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
          <CardTitle>Informations personnelles</CardTitle>
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
          <CardTitle>Informations personnelles</CardTitle>
          <CardDescription>Vos coordonnées de base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServerErrorAlert message={formAlert} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">Prénom</Label>
              <Input
                id="firstName"
                autoComplete="given-name"
                aria-invalid={form.formState.errors.firstName ? true : undefined}
                aria-describedby={form.formState.errors.firstName ? 'firstName-error' : undefined}
                {...form.register('firstName')}
              />
              <FormFieldError id="firstName-error" message={form.formState.errors.firstName?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Nom</Label>
              <Input
                id="lastName"
                autoComplete="family-name"
                aria-invalid={form.formState.errors.lastName ? true : undefined}
                aria-describedby={form.formState.errors.lastName ? 'lastName-error' : undefined}
                {...form.register('lastName')}
              />
              <FormFieldError id="lastName-error" message={form.formState.errors.lastName?.message} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Téléphone</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              aria-invalid={form.formState.errors.phone ? true : undefined}
              aria-describedby={form.formState.errors.phone ? 'phone-error' : undefined}
              {...form.register('phone')}
            />
            <FormFieldError id="phone-error" message={form.formState.errors.phone?.message} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="city">Ville</Label>
              <Input
                id="city"
                autoComplete="address-level2"
                aria-invalid={form.formState.errors.city ? true : undefined}
                aria-describedby={form.formState.errors.city ? 'city-error' : undefined}
                {...form.register('city')}
              />
              <FormFieldError id="city-error" message={form.formState.errors.city?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Pays</Label>
              <Input
                id="country"
                autoComplete="country-name"
                aria-invalid={form.formState.errors.country ? true : undefined}
                aria-describedby={form.formState.errors.country ? 'country-error' : undefined}
                {...form.register('country')}
              />
              <FormFieldError id="country-error" message={form.formState.errors.country?.message} />
            </div>
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
