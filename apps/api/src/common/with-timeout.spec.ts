import { describe, expect, it } from 'vitest';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  it('laisse passer une promesse qui se resout a temps', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'test')).resolves.toBe('ok');
  });

  it('rejette avec un message explicite quand le delai est depasse', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('trop tard'), 200));
    await expect(withTimeout(slow, 20, 'Postgres')).rejects.toThrowError(
      'Postgres : délai de 20 ms dépassé',
    );
  });

  it('propage le rejet de la promesse d_origine', async () => {
    await expect(withTimeout(Promise.reject(new Error('boum')), 100, 'test')).rejects.toThrowError(
      'boum',
    );
  });
});
