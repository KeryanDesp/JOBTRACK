import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { applyFieldErrors, topLevelMessage } from './form-errors';

interface Fields {
  email: string;
  password: string;
}

describe('form-errors', () => {
  it('mappe les erreurs de validation sur les champs connus, ignore les cles inconnues, et expose le message general via la cle form', () => {
    const setError = vi.fn();
    const error = new ApiError('Certains champs sont invalides.', 400, 'VALIDATION_ERROR', {
      email: 'Adresse email invalide.',
      champInconnu: 'Ne doit jamais être reporté : ce champ n_existe pas dans le formulaire.',
      form: 'Le formulaire contient des erreurs.',
    });

    const applied = applyFieldErrors<Fields>(error, setError, ['email', 'password']);

    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith('email', { message: 'Adresse email invalide.' });
    expect(topLevelMessage(error)).toBe('Le formulaire contient des erreurs.');
  });
});
