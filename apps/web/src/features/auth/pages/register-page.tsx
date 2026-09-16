import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterFormInput } from '@jobtrack/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { register as registerUser } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { AuthLayout } from '../components/auth-layout';
import { FormFieldError } from '../components/form-field-error';
import { GoogleButton } from '../components/google-button';
import { ServerErrorAlert } from '../components/server-error-alert';
import { useSetSession } from '../hooks/use-session';
import { applyFieldErrors, topLevelMessage } from '../lib/form-errors';

const REGISTER_FIELDS = ['firstName', 'lastName', 'email', 'password'] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useSetSession();
  const [fieldErrorsApplied, setFieldErrorsApplied] = useState(false);

  const rawFrom = (location.state as { from?: string } | null)?.from;
  // Jamais une URL absolue ou protocol-relative : pas de redirection ouverte.
  const from = rawFrom?.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : undefined;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormInput>({ resolver: zodResolver(registerSchema) });

  const mutation = useMutation({
    mutationFn: registerUser,
    onSuccess: (user) => {
      setSession(user);
      navigate(from ?? '/profile', { replace: true });
    },
    onError: (error: unknown) => {
      if (applyFieldErrors<RegisterFormInput>(error, setError, REGISTER_FIELDS)) {
        setFieldErrorsApplied(true);
        return;
      }
      // 409 : l'e-mail est déjà pris par un autre compte — ciblé sur ce champ,
      // pas une alerte générale, pour guider directement vers la correction.
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setError('email', { message: error.message });
        setFieldErrorsApplied(true);
        return;
      }
      setFieldErrorsApplied(false);
    },
  });

  const alertMessage = mutation.isError && !fieldErrorsApplied ? topLevelMessage(mutation.error) : undefined;

  function onSubmit(values: RegisterFormInput) {
    mutation.mutate(values);
  }

  return (
    <AuthLayout
      title="Créer votre compte"
      description="Quelques secondes suffisent pour commencer."
      footer={
        <p className="text-muted-foreground">
          Déjà un compte ?{' '}
          <Link to="/login" className="text-foreground font-medium hover:underline">
            Se connecter
          </Link>
        </p>
      }
    >
      <div className="space-y-4">
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
          <ServerErrorAlert message={alertMessage} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">Prénom</Label>
              <Input
                id="firstName"
                autoComplete="given-name"
                aria-invalid={errors.firstName ? true : undefined}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                {...register('firstName')}
              />
              <FormFieldError id="firstName-error" message={errors.firstName?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Nom</Label>
              <Input
                id="lastName"
                autoComplete="family-name"
                aria-invalid={errors.lastName ? true : undefined}
                aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                {...register('lastName')}
              />
              <FormFieldError id="lastName-error" message={errors.lastName?.message} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            <FormFieldError id="email-error" message={errors.email?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-hint password-error' : 'password-hint'}
              {...register('password')}
            />
            <p id="password-hint" className="text-muted-foreground text-sm">
              12 caractères minimum.
            </p>
            <FormFieldError id="password-error" message={errors.password?.message} />
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || mutation.isPending}>
            {mutation.isPending ? 'Création…' : 'Créer mon compte'}
          </Button>
        </form>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-muted-foreground text-xs">ou</span>
          <Separator className="flex-1" />
        </div>

        <GoogleButton label="Continuer avec Google" />
      </div>
    </AuthLayout>
  );
}
