import '@fastify/cookie'; // augmente FastifyRequest de `cookies` et `unsignCookie`
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionUser } from '@jobtrack/shared';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { SESSION_ID_PATTERN, SessionService, type StoredSession } from './session.service';

export const SESSION_COOKIE = 'jt_session';

export type AuthenticatedRequest = FastifyRequest & { user: SessionUser; session: StoredSession };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) throw this.unauthorized();

    const unsigned = request.unsignCookie(raw);
    // Forme vérifiée avant tout accès Redis : un cookie forgé ne coûte rien.
    if (!unsigned.valid || !unsigned.value || !SESSION_ID_PATTERN.test(unsigned.value)) {
      throw this.unauthorized();
    }

    const session = await this.sessions.touch(unsigned.value);
    if (!session) throw this.unauthorized();

    const user = await this.auth.findSessionUser(session.userId);
    if (!user) {
      // L'utilisateur a été supprimé : la session ne doit pas survivre.
      await this.sessions.destroy(session.id, session.userId);
      throw this.unauthorized();
    }

    request.user = user;
    request.session = session;
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'NOT_AUTHENTICATED',
      message: 'Votre session a expiré. Veuillez vous reconnecter.',
    });
  }
}
