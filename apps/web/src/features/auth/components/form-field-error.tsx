interface FormFieldErrorProps {
  message?: string;
}

/**
 * Message d'erreur associé à un champ de formulaire, sans l'appareillage de
 * `<FormField>`/`<FormMessage>` (voulu pour ces écrans à base de `register`
 * plutôt que de `Controller`). `role="alert"` fait annoncer le message par le
 * lecteur d'écran dès son apparition, sans exiger de focus.
 */
export function FormFieldError({ message }: FormFieldErrorProps) {
  if (!message) return null;

  return (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}
