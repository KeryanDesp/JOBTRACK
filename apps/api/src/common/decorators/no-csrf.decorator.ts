import { SetMetadata } from '@nestjs/common';

export const NO_CSRF_KEY = 'noCsrf';

/**
 * Exempte explicitement une route du contrôle CSRF. Distinct de @Public() : « sans session »
 * et « sans jeton CSRF » sont deux axes différents ; l'exemption doit être un acte délibéré
 * (connexion, inscription, mot de passe oublié — elles n'agissent pas au nom d'une session).
 */
export const NoCsrf = () => SetMetadata(NO_CSRF_KEY, true);
