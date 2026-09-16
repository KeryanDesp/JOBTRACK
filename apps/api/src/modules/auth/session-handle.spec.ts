import { describe, expect, it } from 'vitest';
import { sessionHandle, SESSION_HANDLE_PATTERN } from './session-handle';

const SESSION_ID = 'a'.repeat(43);

describe('sessionHandle', () => {
  it('est deterministe pour un meme identifiant de session', () => {
    expect(sessionHandle(SESSION_ID)).toBe(sessionHandle(SESSION_ID));
  });

  it('differe d_un identifiant de session a l_autre', () => {
    expect(sessionHandle(SESSION_ID)).not.toBe(sessionHandle('b'.repeat(43)));
  });

  it('produit un handle de 43 caracteres conforme au motif attendu, distinct de l_identifiant brut', () => {
    const handle = sessionHandle(SESSION_ID);
    expect(handle).toHaveLength(43);
    expect(SESSION_HANDLE_PATTERN.test(handle)).toBe(true);
    expect(handle).not.toBe(SESSION_ID);
  });
});
