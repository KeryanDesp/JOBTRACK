import type { CvApplyFormInput, CvApplyResult, CvCapabilities, CvImportDto } from '@jobtrack/shared';
import { ApiError, apiRequest, BASE_URL, buildApiError, networkApiError, readCsrfCookie } from './client';

const ABORT_ERROR = () => new ApiError('Import annulé.', 0, 'ABORTED');
const TIMEOUT_ERROR = () => new ApiError("L'analyse du CV a pris trop de temps. Réessayez.", 0, 'TIMEOUT');

export const fetchCvCapabilities = () => apiRequest<CvCapabilities>('/cv-imports/capabilities');

export const fetchCvImport = (id: string) => apiRequest<CvImportDto>(`/cv-imports/${id}`);

export const applyCvImport = (id: string, body: CvApplyFormInput) =>
  apiRequest<CvApplyResult>(`/cv-imports/${id}/apply`, { method: 'POST', body: JSON.stringify(body) });

export const retryCvImport = (id: string) => apiRequest<CvImportDto>(`/cv-imports/${id}/retry`, { method: 'POST' });

export const deleteCvImport = (id: string) => apiRequest<void>(`/cv-imports/${id}`, { method: 'DELETE' });

export interface UploadCvOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Import d'un CV : `XMLHttpRequest` plutôt que `fetch` (via `apiRequest`), seul
 * moyen d'observer la progression de l'envoi (`upload.onprogress`) — utile ici
 * car le fichier peut atteindre 10 Mo. Erreurs mappées en `ApiError` comme
 * `apiRequest`, pour que le code appelant (mutation, page) n'ait qu'un seul
 * type d'erreur à traiter quelle que soit la voie de transport.
 */
export function uploadCv(file: File, options: UploadCvOptions = {}): Promise<CvImportDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/cv-imports`);
    xhr.withCredentials = true;
    xhr.timeout = 90_000;

    const csrf = readCsrfCookie();
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);

    const { signal } = options;

    // Écouteur externe (`AbortController` de l'appelant) posé une seule fois
    // et retiré dès que la promesse se règle, quelle que soit l'issue — sinon
    // il resterait accroché au signal et appellerait `xhr.abort()` sur une
    // requête déjà terminée si l'appelant annule après coup.
    function onExternalAbort(): void {
      xhr.abort();
    }

    function detachAbortListener(): void {
      signal?.removeEventListener('abort', onExternalAbort);
    }

    xhr.upload.onprogress = (event) => {
      if (options.onProgress && event.total > 0) options.onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      detachAbortListener();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as CvImportDto);
        } catch {
          // Corps de succès illisible : jamais une ApiError qui prétendrait
          // porter le statut 2xx d'origine, toujours 0 (panne côté client).
          reject(buildApiError(0, xhr.responseText));
        }
        return;
      }
      reject(buildApiError(xhr.status, xhr.responseText));
    };

    xhr.onerror = () => {
      detachAbortListener();
      reject(networkApiError());
    };
    xhr.ontimeout = () => {
      detachAbortListener();
      reject(TIMEOUT_ERROR());
    };
    xhr.onabort = () => {
      detachAbortListener();
      reject(ABORT_ERROR());
    };

    if (signal) {
      // Déjà annulé avant l'envoi : pas d'écouteur à poser, `xhr.abort()` avant
      // `send()` ne déclenche de toute façon jamais `onabort` sur certains
      // moteurs — on rejette nous-mêmes plutôt que de dépendre de l'événement.
      if (signal.aborted) {
        reject(ABORT_ERROR());
        return;
      }
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const formData = new FormData();
    // Pas de `Content-Type` manuel : le navigateur pose lui-même `multipart/form-data`
    // avec sa frontière, comme pour un `FormData` passé à `apiRequest`.
    formData.append('file', file);
    xhr.send(formData);
  });
}
