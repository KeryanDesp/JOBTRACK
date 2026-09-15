import argon2 from 'argon2';

/** Paramètres recommandés par l'OWASP pour Argon2id. Source unique : le seed les importe aussi. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;
