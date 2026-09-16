import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormInput } from '@jobtrack/shared';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { login } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { AuthLayout } from '../components/auth-layout';
import { FormFieldError } from '../components/form-field-error';
import { GoogleButton } from '../components/google-button';
import { useSetSession } from '../hooks/use-session';

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google: 'La connexion Google a échoué. Veuillez réessayer.',
  google_link:
    'Un compte existe déjà avec cette adresse. Connectez-vous par mot de passe pour le relier à Google.',
  google_cancelled: 'Connexion Google annulée.',
};

/**
 * Message à afficher dans l'alerte du formulaire : le message serveur tel
 * quel pour tout code autre que `VALIDATION_ERROR` (identifiants invalides,
 * limitation de débit, service indisponible…), ou `details.form` pour une
 * validation dont l'erreur ne cible aucun champ précis.
 */
function getTopLevelMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'VALIDATION_ERROR') return error.details?.form ?? null;
  return error.message;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const setSession = useSetSession();
  const from = (location.state as { from?: string } | null)?.from;
  const googleErrorMessage = GOOGLE_ERROR_MESSAGES[searchParams.get('error') ?? ''];

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
      if (!(error instanceof ApiError)) return;
      if (error.code === 'VALIDATION_ERROR' && error.details) {
        for (const [field, message] of Object.entries(error.details)) {
          if (field === 'form') continue;
          setError(field as keyof LoginFormInput, { message });
        }
      }
    },
  });

  const topLevelMessage = mutation.isError ? getTopLevelMessage(mutation.error) : null;

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
          {topLevelMessage && (
            <Alert variant="destructive">
              <AlertDescription>{topLevelMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            <FormFieldError message={errors.email?.message} />
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
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            <FormFieldError message={errors.password?.message} />
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
