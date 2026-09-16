import type { CvApplyFormInput, CvImportDto } from '@jobtrack/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCvImport, uploadCv } from './cv-import';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'jt_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

/**
 * Substitut minimal de `XMLHttpRequest` : seules les méthodes/propriétés
 * utilisées par `uploadCv` sont modélisées. Les évènements (`onload`,
 * `upload.onprogress`, ...) sont déclenchés manuellement par les tests plutôt
 * que par un vrai transport réseau — jsdom n'en fournit pas.
 */
class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  method = '';
  url = '';
  withCredentials = false;
  timeout = 0;
  status = 0;
  responseText = '';
  readonly headers: Record<string, string> = {};
  body: FormData | null = null;
  readonly upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: FormData): void {
    this.body = body;
  }
}

function stubXhr(): void {
  FakeXMLHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
}

function latestXhr(): FakeXMLHttpRequest {
  const instance = FakeXMLHttpRequest.instances.at(-1);
  if (!instance) throw new Error('Aucune instance XMLHttpRequest creee.');
  return instance;
}

describe('uploadCv', () => {
  it('envoie le fichier en FormData avec le jeton csrf et les cookies de session', () => {
    document.cookie = 'jt_csrf=jeton-csrf-de-test';
    stubXhr();
    const file = new File(['contenu'], 'cv.pdf', { type: 'application/pdf' });

    void uploadCv(file);

    const xhr = latestXhr();
    expect(xhr.method).toBe('POST');
    expect(xhr.url.endsWith('/cv-imports')).toBe(true);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers['x-csrf-token']).toBe('jeton-csrf-de-test');
    expect(xhr.body).toBeInstanceOf(FormData);
    expect(xhr.body?.get('file')).toBe(file);
  });

  it('resout avec le brouillon renvoye sur un succes 201', async () => {
    stubXhr();
    const file = new File(['contenu'], 'cv.pdf', { type: 'application/pdf' });
    const dto: CvImportDto = {
      id: 'import-1',
      fileName: 'cv.pdf',
      status: 'EXTRACTED',
      extracted: null,
      error: null,
      createdAt: '2026-09-16T00:00:00.000Z',
    };

    const promise = uploadCv(file);
    const xhr = latestXhr();
    xhr.status = 201;
    xhr.responseText = JSON.stringify(dto);
    xhr.onload?.();

    await expect(promise).resolves.toEqual(dto);
  });

  it('rejette avec une ApiError portant le statut, le code et le message sur un refus 400', async () => {
    stubXhr();
    const file = new File(['contenu'], 'cv.exe', { type: 'application/octet-stream' });

    const promise = uploadCv(file);
    const xhr = latestXhr();
    xhr.status = 400;
    xhr.responseText = JSON.stringify({ message: 'Type de fichier non pris en charge.', code: 'INVALID_FILE' });
    xhr.onload?.();

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'INVALID_FILE',
      message: 'Type de fichier non pris en charge.',
    });
  });

  it('rapporte la progression de l_envoi via onProgress', () => {
    stubXhr();
    const file = new File(['contenu'], 'cv.pdf', { type: 'application/pdf' });
    const onProgress = vi.fn();

    void uploadCv(file, { onProgress });
    const xhr = latestXhr();
    xhr.upload.onprogress?.({ loaded: 50, total: 100 });

    expect(onProgress).toHaveBeenCalledWith(0.5);

    // Referme la promesse pour ne pas laisser de requete en suspens.
    xhr.status = 201;
    xhr.responseText = JSON.stringify({
      id: 'import-1',
      fileName: 'cv.pdf',
      status: 'EXTRACTED',
      extracted: null,
      error: null,
      createdAt: '2026-09-16T00:00:00.000Z',
    });
    xhr.onload?.();
  });
});

describe('applyCvImport', () => {
  it('poste le corps en json a la route apply', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ created: { experiences: 1, educations: 0, skills: 0, languages: 0, certifications: 0, projects: 0 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const body: CvApplyFormInput = {};

    await applyCvImport('import-1', body);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/cv-imports/import-1/apply')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(body));
  });
});
