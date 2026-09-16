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

  it('retire le ou les slash finaux de WEB_ORIGIN', () => {
    // Sinon `${WEB_ORIGIN}/profile` produirait `http://host//profile`.
    const parsed = serverEnvSchema.parse({ ...valid, WEB_ORIGIN: 'http://localhost:5173///' });
    expect(parsed.WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('applique les defauts IA et stockage quand ils sont absents', () => {
    const parsed = serverEnvSchema.parse(valid);
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
    expect(parsed.ANTHROPIC_MODEL).toBeUndefined();
    expect(parsed.STORAGE_DIR).toBe('./storage');
  });

  it('applique les defauts France Travail quand les identifiants sont absents', () => {
    const parsed = serverEnvSchema.parse(valid);
    expect(parsed.FRANCE_TRAVAIL_CLIENT_ID).toBeUndefined();
    expect(parsed.FRANCE_TRAVAIL_CLIENT_SECRET).toBeUndefined();
    expect(parsed.FRANCE_TRAVAIL_API_URL).toBe('https://api.francetravail.io/partenaire/offresdemploi/v2');
    expect(parsed.FRANCE_TRAVAIL_TOKEN_URL).toBe(
      'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
    );
    expect(parsed.FRANCE_TRAVAIL_SCOPE).toBe('api_offresdemploiv2 o2dsoffre');
  });

  it('traite des variables France Travail vides comme absentes (defauts appliques)', () => {
    const parsed = serverEnvSchema.parse({
      ...valid,
      FRANCE_TRAVAIL_CLIENT_ID: '',
      FRANCE_TRAVAIL_CLIENT_SECRET: '',
      FRANCE_TRAVAIL_API_URL: '',
      FRANCE_TRAVAIL_TOKEN_URL: '',
      FRANCE_TRAVAIL_SCOPE: '',
    });
    expect(parsed.FRANCE_TRAVAIL_CLIENT_ID).toBeUndefined();
    expect(parsed.FRANCE_TRAVAIL_API_URL).toBe('https://api.francetravail.io/partenaire/offresdemploi/v2');
    expect(parsed.FRANCE_TRAVAIL_SCOPE).toBe('api_offresdemploiv2 o2dsoffre');
  });

  it('accepte des identifiants et une URL France Travail personnalises', () => {
    const parsed = serverEnvSchema.parse({
      ...valid,
      FRANCE_TRAVAIL_CLIENT_ID: 'id-partenaire',
      FRANCE_TRAVAIL_CLIENT_SECRET: 'secret-partenaire',
      FRANCE_TRAVAIL_API_URL: 'https://api.example.test/offres',
    });
    expect(parsed.FRANCE_TRAVAIL_CLIENT_ID).toBe('id-partenaire');
    expect(parsed.FRANCE_TRAVAIL_CLIENT_SECRET).toBe('secret-partenaire');
    expect(parsed.FRANCE_TRAVAIL_API_URL).toBe('https://api.example.test/offres');
  });

  it('rejette une FRANCE_TRAVAIL_API_URL renseignee mais invalide', () => {
    const result = serverEnvSchema.safeParse({ ...valid, FRANCE_TRAVAIL_API_URL: 'pas-une-url' });
    expect(result.success).toBe(false);
  });
});
