import { describe, expect, it } from 'vitest';
import { ApiError } from '@/services/api/client';
import { shouldRetry } from './query-provider';

describe('shouldRetry', () => {
  it('ne rejoue jamais une erreur d_authentification ou de validation', () => {
    expect(shouldRetry(0, new ApiError('Session expirée.', 401))).toBe(false);
    expect(shouldRetry(0, new ApiError('Champs invalides.', 400))).toBe(false);
    expect(shouldRetry(0, new ApiError('Introuvable.', 404))).toBe(false);
  });

  it('rejoue deux fois une panne serveur ou reseau, puis abandonne', () => {
    const serverError = new ApiError('Une erreur est survenue.', 503);
    const networkError = new ApiError('Connexion impossible.', 0);
    expect(shouldRetry(0, serverError)).toBe(true);
    expect(shouldRetry(1, networkError)).toBe(true);
    expect(shouldRetry(2, serverError)).toBe(false);
  });

  it('traite une erreur inconnue comme retentable', () => {
    expect(shouldRetry(0, new Error('boum'))).toBe(true);
  });
});
