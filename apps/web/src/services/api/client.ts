// Sans le `/` final : Fastify ne tolère pas les doubles barres, `//health` renverrait 404.
// L'API doit partager le site (domaine enregistrable) du SPA : le cookie `jt_csrf`
// lisible ici est posé par l'API — sur un autre domaine, l'en-tête CSRF ne serait
// jamais envoyé.
const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/+$/, '');

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

async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    // Réponse non-JSON (proxy, passerelle) : on ne montre jamais le HTML brut.
    return {};
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
    throw new ApiError(NETWORK_MESSAGE, 0);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    const message = typeof body.message === 'string' ? body.message : GENERIC_MESSAGE;
    const code = typeof body.code === 'string' ? body.code : undefined;
    const details = isStringRecord(body.details) ? body.details : undefined;
    throw new ApiError(message, response.status, code, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
