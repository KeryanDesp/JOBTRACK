import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormInput } from '@jobtrack/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { login } from '@/services/api/auth';
import { AuthLayout } from '../components/auth-layout';
import { FormFieldError } from '../components/form-field-error';
import { GoogleButton } from '../components/google-button';
import { ServerErrorAlert } from '../components/server-error-alert';
import { useSetSession } from '../hooks/use-session';
import { applyFieldErrors, topLevelMessage } from '../lib/form-errors';

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google: 'La connexion Google a échoué. Veuillez réessayer.',
  google_link:
    'Un compte existe déjà avec cette adresse. Connectez-vous par mot de passe pour le relier à Google.',
  google_cancelled: 'Connexion Google annulée.',
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const setSession = useSetSession();
  const [fieldErrorsApplied, setFieldErrorsApplied] = useState(false);

  const rawFrom = (location.state as { from?: string } | null)?.from;
  // Jamais une URL absolue ou protocol-relative : pas de redirection ouverte.
  const from = rawFrom?.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : undefined;

  // Clé absente de la liste blanche (y compris les clés héritées de
  // `Object.prototype`, comme `constructor` ou `toString`) → pas de message.
  const errorKey = searchParams.get('error');
  const googleErrorMessage =
    errorKey && Object.hasOwn(GOOGLE_ERROR_MESSAGES, errorKey) ? GOOGLE_ERROR_MESSAGES[errorKey] : undefined;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormInput>({ resolver: zodResolver(loginSchema) });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      setSession(user);
      navigate(from ?? '/profile', { replace: true });
    },
    onError: (error: unknown) => {
      setFieldErrorsApplied(applyFieldErrors<LoginFormInput>(error, setError, ['email', 'password']));
    },
  });

  const alertMessage = mutation.isError && !fieldErrorsApplied ? topLevelMessage(mutation.error) : undefined;

  function onSubmit(values: LoginFormInput) {
    mutation.mutate(values);
  }

  return (
    <AuthLayout
      title="Connexion"
      description="Retrouvez vos candidatures en cours."
      footer={
        <p className="text-muted-foreground">
          Pas encore de compte ?{' '}
          <Link to="/register" className="text-foreground font-medium hover:underline">
            Créer un compte
          </Link>
        </p>
      }
    >
      {/* role="status" : ce n'est jamais une erreur bloquante de la page elle-même,
          juste le compte-rendu d'une tentative de connexion Google précédente. */}
      {googleErrorMessage && (
        <Alert role="status">
          <AlertDescription>{googleErrorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
          <ServerErrorAlert message={alertMessage} />

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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Mot de passe</Label>
              <Link to="/forgot-password" className="text-muted-foreground text-sm hover:text-foreground">
                Mot de passe oublié ?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            <FormFieldError id="password-error" message={errors.password?.message} />
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || mutation.isPending}>
            {mutation.isPending ? 'Connexion…' : 'Se connecter'}
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
