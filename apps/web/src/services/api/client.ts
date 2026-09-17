// Sans le `/` final : Fastify ne tolère pas les doubles barres, `//health` renverrait 404.
// L'API doit partager le site (domaine enregistrable) du SPA : le cookie `jt_csrf`
// lisible ici est posé par l'API — sur un autre domaine, l'en-tête CSRF ne serait
// jamais envoyé.
// Exportée : `services/api/cv-import.ts` construit sa propre URL pour l'upload
// en `XMLHttpRequest` (progression), qui ne passe pas par `apiRequest`.
export const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/+$/, '');

const GENERIC_MESSAGE = 'Une erreur est survenue. Veuillez réessayer.';
const NETWORK_MESSAGE = 'Connexion au serveur impossible. Vérifiez votre connexion internet.';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  message?: unknown;
  code?: unknown;
  details?: unknown;
}

function parseErrorBody(rawBody: string): ErrorBody {
  try {
    return JSON.parse(rawBody) as ErrorBody;
  } catch {
    // Corps vide ou non-JSON (proxy, passerelle) : on ne montre jamais le HTML brut.
    return {};
  }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/**
 * Construit une `ApiError` à partir d'un statut HTTP et du corps brut de la
 * réponse (texte, pas encore parsé) : message français lisible si le serveur
 * en fournit un, message générique sinon. Partagée par `apiRequest` (réponse
 * `fetch`) et `uploadCv` (`services/api/cv-import.ts`, réponse `XMLHttpRequest`
 * — pas de `Response` disponible là-bas, seulement `status`/`responseText`).
 */
export function buildApiError(status: number, rawBody: string): ApiError {
  const body = parseErrorBody(rawBody);
  const message = typeof body.message === 'string' ? body.message : GENERIC_MESSAGE;
  const code = typeof body.code === 'string' ? body.code : undefined;
  const details = isStringRecord(body.details) ? body.details : undefined;
  return new ApiError(message, status, code, details);
}

/** Panne de connexion (réseau, délai, annulation) : même message que `fetch`, statut 0. */
export function networkApiError(): ApiError {
  return new ApiError(NETWORK_MESSAGE, 0);
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function readCsrfCookie(): string | null {
  // Alphabet base64url : jamais besoin de décoder pour le poser dans l'en-tête.
  return /(?:^|;\s*)jt_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? null;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  // new Headers() accepte les trois formes de HeadersInit ; un spread d'objet
  // sur une instance Headers donnerait {} et perdrait silencieusement les en-têtes.
  const headers = new Headers(init.headers);
  // JSON par défaut uniquement pour un corps texte : un FormData doit laisser le
  // navigateur poser lui-même `multipart/form-data` avec sa frontière.
  if (!headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  if (MUTATING.has((init.method ?? 'GET').toUpperCase())) {
    // Jeton lié à la session : le serveur compare cet en-tête à un HMAC de l'identifiant de session.
    const csrf = readCsrfCookie();
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // Indispensable : le cookie de session est httpOnly et cross-origin en développement.
      credentials: 'include',
      headers,
    });
  } catch {
    throw networkApiError();
  }

  if (!response.ok) {
    throw buildApiError(response.status, await readResponseText(response));
  }

  // 205 (Reset Content) n'a jamais de corps, comme 204 ; certaines routes
  // (ex. `POST /jobs/:id/analyses/retry`, 202) répondent aussi sans corps
  // selon l'implémentation serveur — plutôt que de supposer un statut précis,
  // on lit le texte et on ne tente `JSON.parse` que s'il est non vide : un
  // corps vide sur n'importe quel statut de succès devient `undefined` au
  // lieu de faire échouer `JSON.parse('')`.
  if (response.status === 204 || response.status === 205) return undefined as T;
  const text = await readResponseText(response);
  if (text === '') return undefined as T;
  return JSON.parse(text) as T;
}
