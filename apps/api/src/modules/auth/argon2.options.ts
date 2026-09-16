import argon2 from 'argon2';
import type { Options } from 'argon2';

/**
 * Paramètres recommandés par l'OWASP pour Argon2id. Source unique : le seed les importe aussi.
 * Ce fichier doit rester sans import Nest ni lecture de `config/env` : le seed le charge
 * hors du conteneur Nest (`tsx prisma/seed.ts`).
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const satisfies Options;
