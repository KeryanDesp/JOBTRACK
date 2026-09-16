import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';

/**
 * Déconnexion partagée par le menu utilisateur de l'en-tête et la carte
 * « Compte » des paramètres. Un 401 (session déjà expirée côté serveur, par
 * exemple après un changement de mot de passe sur un autre appareil) ne doit
 * pas empêcher la déconnexion de se terminer côté client : le cache de
 * requêtes est vidé (aucune donnée de l'utilisateur précédent ne doit
 * survivre pour le suivant sur ce poste) puis on redirige vers la connexion.
 */
export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [queryClient, navigate]);
}
