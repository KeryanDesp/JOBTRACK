const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

const GENERIC_MESSAGE = 'Une erreur est survenue. Veuillez réessayer.';
const NETWORK_MESSAGE = 'Connexion au serveur impossible. Vérifiez votre connexion internet.';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  message?: unknown;
  code?: unknown;
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    // Réponse non-JSON (proxy, passerelle) : on ne montre jamais le HTML brut.
    return {};
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // Indispensable : le cookie de session est httpOnly et cross-origin en développement.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    const message = typeof body.message === 'string' ? body.message : GENERIC_MESSAGE;
    const code = typeof body.code === 'string' ? body.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
