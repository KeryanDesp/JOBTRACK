import { BadRequestException } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import { AiOutputInvalidError } from '../resume.errors';

const VALIDATION_ERROR_MESSAGE = 'Données invalides.';

/**
 * `safeParse` d'un contenu déjà nettoyé (`sanitizeResumeContent`/`sanitizeLetterContent`) avant
 * enregistrement (revue sécurité, tâche 5) : un champ requis réduit à des caractères de
 * contrôle/bidi (ex. `subject: ""`) passe la garde d'entrée (`ZodValidationPipe`, qui ne nettoie
 * jamais) puis se retrouve vide une fois nettoyé — un `.parse` nu laisserait alors une `ZodError`
 * remonter telle quelle (500). Même forme de réponse que `ZodValidationPipe` (400
 * `VALIDATION_ERROR`), réutilisée ici après nettoyage plutôt qu'avant. Partagée par
 * `ResumeService.update`/`CoverLetterStoreService.update`.
 */
export function parseSanitizedOrThrow<T extends ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.output<T>;

  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || 'form';
    details[path] ??= issue.message;
  }
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message: VALIDATION_ERROR_MESSAGE, details });
}

/**
 * `safeParse` d'une sortie IA déjà ancrée (`groundLetter`) ou assemblée à partir de celle-ci
 * (`CoverLetterService.write`, signature/destinataire) avant retour à l'appelant (revue sécurité,
 * tâche 5) : l'ancrage/le nettoyage peuvent réduire un champ requis à une chaîne vide (ex. sujet
 * composé uniquement de caractères de contrôle) — un `.parse` nu laisserait alors une `ZodError`
 * remonter telle quelle (500) plutôt que le 502 `AI_OUTPUT_INVALID` attendu pour toute sortie IA
 * inexploitable. Jamais le détail des chemins en erreur (peut porter un fragment du profil ou de
 * l'offre) — contrairement à `parseSanitizedOrThrow`, qui valide une entrée utilisateur.
 */
export function parseAiOutputOrThrow<T extends ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.output<T>;
  throw new AiOutputInvalidError();
}
