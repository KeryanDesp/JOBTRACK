import { useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ServerErrorAlertProps {
  message?: string;
}

/**
 * Alerte d'erreur serveur en haut de formulaire, qui reçoit le focus dès son
 * apparition. Sur mobile en particulier, sans ce focus programmatique, rien
 * ne garantit que le message reste dans la zone visible (le clavier virtuel
 * masque souvent le bas de l'écran) ni qu'un lecteur d'écran l'annonce avant
 * que l'utilisateur ne navigue jusqu'à lui. `tabIndex={-1}` rend le conteneur
 * focusable par programme sans l'ajouter à l'ordre de tabulation normal.
 */
export function ServerErrorAlert({ message }: ServerErrorAlertProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);

  if (!message) return null;

  return (
    <div ref={ref} tabIndex={-1}>
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}
