import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordFormInput } from '@jobtrack/shared';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPassword } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { AuthLayout } from '../components/auth-layout';
import { FormFieldError } from '../components/form-field-error';

const TITLE = 'Nouveau mot de passe';
const DESCRIPTION = 'Choisissez un nouveau mot de passe pour votre compte.';

// Seul le mot de passe vient du formulaire : le jeton est lu dans l'URL et
// injecté à la soumission, jamais affiché ni modifiable par l'utilisateur.
const passwordOnlySchema = resetPasswordSchema.pick({ password: true });
type ResetPasswordPasswordInput = Pick<ResetPasswordFormInput, 'password'>;

function getTopLevelMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'VALIDATION_ERROR') return error.details?.form ?? null;
  return error.message;
}

function InvalidTokenAlert() {
  return (
    <AuthLayout title={TITLE} description={DESCRIPTION}>
      <Alert variant="destructive">
        <AlertDescription>Ce lien est invalide ou a expiré.</AlertDescription>
      </Alert>
      <Button asChild variant="outline" className="w-full">
        <Link to="/forgot-password">Demander un nouveau lien</Link>
      </Button>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordPasswordInput>({ resolver: zodResolver(passwordOnlySchema) });

  const mutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      toast.success('Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.');
      navigate('/login', { replace: true });
    },
  });

  const invalidToken = mutation.isError && mutation.error instanceof ApiError && mutation.error.code === 'INVALID_RESET_TOKEN';

  if (!token || invalidToken) {
    return <InvalidTokenAlert />;
  }

  const topLevelMessage = mutation.isError ? getTopLevelMessage(mutation.error) : null;
  // Réaffecté à une constante typée `string` : `onSubmit` est une closure
  // définie plus bas, dont TypeScript n'hérite pas du contrôle de flux
  // (le rejet ci-dessus) qui a réduit `token` depuis `string | null`.
  const validToken: string = token;

  function onSubmit(values: ResetPasswordPasswordInput) {
    mutation.mutate({ token: validToken, password: values.password });
  }

  return (
    <AuthLayout title={TITLE} description={DESCRIPTION}>
      <form className="space-y-4" onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
        {topLevelMessage && (
          <Alert variant="destructive">
            <AlertDescription>{topLevelMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register('password')}
          />
          <FormFieldError message={errors.password?.message} />
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting || mutation.isPending}>
          {mutation.isPending ? 'Réinitialisation…' : 'Réinitialiser mon mot de passe'}
        </Button>
      </form>
    </AuthLayout>
  );
}
