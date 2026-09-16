import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordFormInput } from '@jobtrack/shared';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPassword } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { AuthLayout } from '../components/auth-layout';
import { FormFieldError } from '../components/form-field-error';

const TITLE = 'Mot de passe oublié';
const DESCRIPTION = 'Nous vous enverrons un lien de réinitialisation.';

function getTopLevelMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'VALIDATION_ERROR') return error.details?.form ?? null;
  return error.message;
}

export function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const mutation = useMutation({
    mutationFn: forgotPassword,
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'VALIDATION_ERROR' && error.details) {
        for (const [field, message] of Object.entries(error.details)) {
          if (field === 'form') continue;
          setError(field as keyof ForgotPasswordFormInput, { message });
        }
      }
    },
  });

  // Succès : on remplace le formulaire par le message du serveur — jamais une
  // confirmation à nous qui révélerait si le compte existe ou non.
  if (mutation.isSuccess) {
    return (
      <AuthLayout title={TITLE} description={DESCRIPTION}>
        <Alert>
          <AlertDescription>{mutation.data.message}</AlertDescription>
        </Alert>
        <p className="text-center text-sm">
          <Link to="/login" className="text-foreground font-medium hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </AuthLayout>
    );
  }

  const topLevelMessage = mutation.isError ? getTopLevelMessage(mutation.error) : null;

  function onSubmit(values: ForgotPasswordFormInput) {
    mutation.mutate(values);
  }

  return (
    <AuthLayout
      title={TITLE}
      description={DESCRIPTION}
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground">
          Retour à la connexion
        </Link>
      }
    >
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

        <Button type="submit" className="w-full" disabled={isSubmitting || mutation.isPending}>
          {mutation.isPending ? 'Envoi…' : 'Envoyer le lien'}
        </Button>
      </form>
    </AuthLayout>
  );
}
