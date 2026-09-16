/**
 * Route de connexion, préfixe global inclus. Doit rester égale à `request.routeOptions.url`
 * du handler `login` (Fastify) : c'est la clé que `RateLimitGuard` incrémente, et que
 * `PasswordResetFlow` doit reconstruire à l'identique pour débloquer la connexion après
 * une réinitialisation réussie. Centralisée ici pour que les deux ne puissent pas diverger.
 */
export const LOGIN_ROUTE = '/api/v1/auth/login';
