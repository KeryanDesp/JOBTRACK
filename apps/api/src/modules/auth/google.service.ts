import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

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

/** Jeton d'injection : `null` quand GOOGLE_* est absent de l'environnement. */
export const GOOGLE_CONFIG = Symbol('GOOGLE_CONFIG');

@Injectable()
export class GoogleService {
  constructor(@Inject(GOOGLE_CONFIG) private readonly config: GoogleConfig) {}

  buildAuthUrl(state: string): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.callbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) throw this.rejected();

    const token: unknown = await tokenResponse.json();
    const accessToken = readString(token, 'access_token');
    if (!accessToken) throw this.rejected();

    const userResponse = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!userResponse.ok) throw this.rejected();

    const info: unknown = await userResponse.json();
    const sub = readString(info, 'sub');
    const email = readString(info, 'email');
    const verified = readBoolean(info, 'email_verified');
    // Sans email vérifié, un compte Google portant l'adresse d'autrui permettrait
    // de prendre le contrôle du compte JobTrack correspondant par le rattachement.
    if (!sub || !email || !verified) throw this.rejected();

    return {
      providerAccountId: sub,
      email: email.trim().toLowerCase(),
      firstName: readString(info, 'given_name') ?? '',
      lastName: readString(info, 'family_name') ?? '',
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

function readBoolean(source: unknown, key: string): boolean {
  if (typeof source !== 'object' || source === null) return false;
  return (source as Record<string, unknown>)[key] === true;
}
