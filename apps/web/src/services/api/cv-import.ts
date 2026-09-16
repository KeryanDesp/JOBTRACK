import type { CvApplyFormInput, CvApplyResult, CvCapabilities, CvImportDto } from '@jobtrack/shared';
import { apiRequest, BASE_URL, buildApiError, networkApiError, readCsrfCookie } from './client';

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

    xhr.upload.onprogress = (event) => {
      if (options.onProgress && event.total > 0) options.onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as CvImportDto);
        } catch {
          reject(buildApiError(xhr.status, ''));
        }
        return;
      }
      reject(buildApiError(xhr.status, xhr.responseText));
    };

    xhr.onerror = () => reject(networkApiError());
    xhr.ontimeout = () => reject(networkApiError());
    xhr.onabort = () => reject(networkApiError());

    if (options.signal) {
      // Déjà annulé avant l'envoi : pas d'écouteur à poser, `xhr.abort()` avant
      // `send()` ne déclenche de toute façon jamais `onabort` sur certains
      // moteurs — on rejette nous-mêmes plutôt que de dépendre de l'événement.
      if (options.signal.aborted) {
        reject(networkApiError());
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort());
    }

    const formData = new FormData();
    // Pas de `Content-Type` manuel : le navigateur pose lui-même `multipart/form-data`
    // avec sa frontière, comme pour un `FormData` passé à `apiRequest`.
    formData.append('file', file);
    xhr.send(formData);
  });
}
