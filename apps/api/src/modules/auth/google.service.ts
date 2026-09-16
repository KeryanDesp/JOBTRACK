import { UnauthorizedException } from '@nestjs/common';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Les deux formes historiques de l'émetteur Google (avec ou sans schéma) : les deux circulent
// selon les versions de la plateforme, la RFC OIDC autorise les deux.
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface GoogleProfile {
  providerAccountId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/** Jeton d'injection de la configuration : `null` quand GOOGLE_* est absent de l'environnement. */
export const GOOGLE_CONFIG = Symbol('GOOGLE_CONFIG');

/**
 * Construite directement par la factory de `AuthModule` (jamais par le conteneur Nest,
 * qui ne connaît que `GOOGLE_CONFIG`) : pas de décorateurs DI sur cette classe.
 */
export class GoogleService {
  constructor(private readonly config: GoogleConfig) {}

  /**
   * PKCE (RFC 9700 §2.1.1) : `codeChallenge` est le SHA-256 (base64url) d'un vérifieur
   * connu seulement du serveur (cookie signé), jamais transmis tel quel à Google.
   */
  buildAuthUrl(state: string, codeChallenge: string): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.callbackUrl,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenResponse.ok) throw this.rejected();

    const token: unknown = await tokenResponse.json();
    const idToken = readString(token, 'id_token');
    if (!idToken) throw this.rejected();

    return this.profileFromIdToken(idToken);
  }

  /**
   * Décodage du jeton d'identité sans vérification de signature : il vient d'un aller-retour
   * TLS direct avec Google (l'endpoint de jeton), jamais du navigateur — OIDC Core §3.1.3.7
   * autorise à sauter la vérification de signature dans ce cas précis (canal de confiance).
   * `aud`, `iss` et `exp` restent contrôlés : un jeton qui ne nous est pas destiné, qui vient
   * d'ailleurs ou qui a expiré est refusé quand même.
   */
  private profileFromIdToken(idToken: string): GoogleProfile {
    const segments = idToken.split('.');
    const payloadSegment = segments[1];
    if (segments.length !== 3 || !payloadSegment) throw this.rejected();

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    } catch {
      throw this.rejected();
    }

    const aud = readString(payload, 'aud');
    const iss = readString(payload, 'iss');
    const exp = readNumber(payload, 'exp');
    const sub = readString(payload, 'sub');
    const email = readString(payload, 'email');
    const verified = readBoolean(payload, 'email_verified');

    if (aud !== this.config.clientId) throw this.rejected();
    if (!iss || !VALID_ISSUERS.has(iss)) throw this.rejected();
    if (!exp || exp * 1000 <= Date.now()) throw this.rejected();
    // Sans email vérifié, un compte Google portant l'adresse d'autrui permettrait
    // de prendre le contrôle du compte JobTrack correspondant par le rattachement.
    if (!sub || !email || !verified) throw this.rejected();

    return {
      providerAccountId: sub,
      email: email.trim().toLowerCase(),
      firstName: readString(payload, 'given_name') ?? '',
      lastName: readString(payload, 'family_name') ?? '',
    };
  }

  private rejected(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'GOOGLE_AUTH_FAILED',
      message: 'La connexion Google a échoué. Veuillez réessayer.',
    });
  }
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(source: unknown, key: string): boolean {
  if (typeof source !== 'object' || source === null) return false;
  return (source as Record<string, unknown>)[key] === true;
}
