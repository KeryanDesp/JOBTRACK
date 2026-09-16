// Partagée par SessionsCard (la lit) et SecurityCard (l'invalide après un changement de
// mot de passe) : une seule déclaration évite que les deux clés divergent silencieusement.
export const SESSIONS_QUERY_KEY = ['auth', 'sessions'] as const;
