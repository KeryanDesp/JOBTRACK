import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordFormInput } from '@jobtrack/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { ServerErrorAlert } from '@/features/auth/components/server-error-alert';
import { applyFieldErrors, topLevelMessage } from '@/features/auth/lib/form-errors';
import { changePassword } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { SESSIONS_QUERY_KEY } from './sessions-card';

const FIELDS = ['currentPassword', 'newPassword'] as const;
const DEFAULT_VALUES: ChangePasswordFormInput = { currentPassword: '', newPassword: '' };

export function SecurityCard() {
  const queryClient = useQueryClient();
  const [formAlert, setFormAlert] = useState<string>();

  const form = useForm<ChangePasswordFormInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const mutation = useMutation({
    mutationFn: (body: ChangePasswordFormInput) => changePassword(body),
    onSuccess: () => {
      toast.success('Mot de passe modifié. Vos autres appareils ont été déconnectés.');
      setFormAlert(undefined);
      form.reset(DEFAULT_VALUES);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      // Code dédié (pas VALIDATION_ERROR) : la session en cours reste valide,
      // seul le mot de passe actuel fourni est faux.
      if (error instanceof ApiError && error.code === 'INVALID_CURRENT_PASSWORD') {
        form.setError('currentPassword', { message: error.message });
        setFormAlert(undefined);
        return;
      }
      if (applyFieldErrors<ChangePasswordFormInput>(error, form.setError, FIELDS)) {
        setFormAlert(undefined);
        return;
      }
      setFormAlert(topLevelMessage(error));
    },
  });

  function onSubmit(values: ChangePasswordFormInput): void {
    mutation.mutate(values);
  }

  return (
    <Card>
      <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate>
        <CardHeader>
          <CardTitle>Sécurité</CardTitle>
          <CardDescription>Changez votre mot de passe. Vos autres appareils seront déconnectés.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServerErrorAlert message={formAlert} />

          <div className="space-y-2">
            <Label htmlFor="currentPassword">Mot de passe actuel</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              aria-invalid={form.formState.errors.currentPassword ? true : undefined}
              aria-describedby={form.formState.errors.currentPassword ? 'currentPassword-error' : undefined}
              {...form.register('currentPassword')}
            />
            <FormFieldError id="currentPassword-error" message={form.formState.errors.currentPassword?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">Nouveau mot de passe</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={form.formState.errors.newPassword ? true : undefined}
              aria-describedby={form.formState.errors.newPassword ? 'newPassword-error' : undefined}
              {...form.register('newPassword')}
            />
            <FormFieldError id="newPassword-error" message={form.formState.errors.newPassword?.message} />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Modification…' : 'Modifier le mot de passe'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
