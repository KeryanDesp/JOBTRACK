import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { topLevelMessage } from '@/features/auth/lib/form-errors';
import { logout } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { SESSION_QUERY_KEY } from './use-session';

/**
 * Déconnexion partagée par le menu utilisateur de l'en-tête et la carte
 * « Compte » des paramètres. Ne rethrow jamais : un 401 (session déjà expirée
 * côté serveur, par exemple après un changement de mot de passe sur un autre
 * appareil) n'a rien à signaler, mais même une panne réseau ou un 5xx ne doit
 * pas empêcher la déconnexion locale de se terminer — rester « connecté »
 * côté client serait pire que perdre le message d'erreur. Ordre volontaire :
 * la session en cache est effacée puis on navigue avant `queryClient.clear()`,
 * pour qu'aucun composant encore monté (celui-ci compris, le temps de la
 * redirection) ne revoie une session « connectée » pendant la transition.
 */
export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        toast.error(topLevelMessage(error));
      }
    }
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
    navigate('/login', { replace: true });
    queryClient.clear();
  }, [queryClient, navigate]);
}
