import { describe, expect, it } from 'vitest';
import { serverEnvSchema } from './env';

const valid = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://jobtrack:jobtrack@localhost:5432/jobtrack',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a'.repeat(32),
};

describe('serverEnvSchema', () => {
  it('accepte un environnement complet et convertit le port en nombre', () => {
    const parsed = serverEnvSchema.parse(valid);
    expect(parsed.API_PORT).toBe(3001);
    expect(parsed.NODE_ENV).toBe('development');
  });

  it('rejette un SESSION_SECRET trop court', () => {
    const result = serverEnvSchema.safeParse({ ...valid, SESSION_SECRET: 'trop-court' });
    expect(result.success).toBe(false);
  });

  it('rejette une DATABASE_URL absente', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid;
    const result = serverEnvSchema.safeParse(withoutDb);
    expect(result.success).toBe(false);
  });

  it('rejette une WEB_ORIGIN qui n_est pas une URL', () => {
    const result = serverEnvSchema.safeParse({ ...valid, WEB_ORIGIN: 'pas-une-url' });
    expect(result.success).toBe(false);
  });

  it('traite une variable Google vide comme absente', () => {
    // Un .env contenant `GOOGLE_CALLBACK_URL=` (vide) ne doit pas empêcher le démarrage.
    const parsed = serverEnvSchema.parse({
      ...valid,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_CALLBACK_URL: '',
    });
    expect(parsed.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(parsed.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(parsed.GOOGLE_CALLBACK_URL).toBeUndefined();
  });

  it('rejette une GOOGLE_CALLBACK_URL renseignee mais invalide', () => {
    const result = serverEnvSchema.safeParse({ ...valid, GOOGLE_CALLBACK_URL: 'pas-une-url' });
    expect(result.success).toBe(false);
  });

  it('rejette un SESSION_SECRET compose uniquement d_espaces', () => {
    const result = serverEnvSchema.safeParse({ ...valid, SESSION_SECRET: ' '.repeat(40) });
    expect(result.success).toBe(false);
  });

  it('nettoie les espaces autour de WEB_ORIGIN', () => {
    const parsed = serverEnvSchema.parse({ ...valid, WEB_ORIGIN: '  http://localhost:5173  ' });
    expect(parsed.WEB_ORIGIN).toBe('http://localhost:5173');
  });
});
