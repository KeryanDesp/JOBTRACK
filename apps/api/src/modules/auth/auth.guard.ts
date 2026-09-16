import '@fastify/cookie'; // augmente FastifyRequest de `cookies` et `unsignCookie`
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionUser } from '@jobtrack/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CSRF_COOKIE, csrfTokenFor } from '../../common/csrf.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { serviceUnavailable } from '../../common/service-unavailable';
import { SESSION_COOKIE, setAuthCookies } from './auth.cookies';
import { AuthService } from './auth.service';
import { SESSION_ID_PATTERN, SessionService, type StoredSession, type TouchedSession } from './session.service';

export type AuthenticatedRequest = FastifyRequest & { user: SessionUser; session: StoredSession };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

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
    const raw = request.cookies?.[SESSION_COOKIE];
    if (!raw) throw this.unauthorized();

    const unsigned = request.unsignCookie(raw);
    // Défense en profondeur : une valeur signée par nous mais malformée n'atteint pas Redis.
    // (Un cookie forgé est déjà rejeté par la signature.)
    if (!unsigned.valid || !unsigned.value || !SESSION_ID_PATTERN.test(unsigned.value)) {
      throw this.unauthorized();
    }

    let session: TouchedSession | null;
    try {
      session = await this.sessions.touch(unsigned.value);
    } catch (error) {
      // Redis indisponible : les sessions n'y vivent qu'à cet endroit, aucune requête
      // authentifiée ne peut aboutir. Un 503 explicite plutôt qu'un 500 générique ou un faux 401.
      this.logger.error(`Session Redis indisponible : ${(error as Error).message}`);
      throw serviceUnavailable();
    }
    if (!session) throw this.unauthorized();

    // Une requête Postgres par appel authentifié : c'est ce qui détecte un compte supprimé.
    // Choix assumé ; alternative future : porter email/nom dans la session Redis.
    const user = await this.auth.findSessionUser(session.userId);
    if (!user) {
      // L'utilisateur a été supprimé : la session ne doit pas survivre.
      await this.sessions.destroy(session.id, session.userId);
      throw this.unauthorized();
    }

    // Renouvelle les cookies au rythme du rafraîchissement Redis (une fois par minute au plus) :
    // le maxAge du navigateur glisse comme le TTL de la session, et un cookie CSRF perdu se répare.
    if (session.refreshed || request.cookies?.[CSRF_COOKIE] !== csrfTokenFor(session.id)) {
      setAuthCookies(context.switchToHttp().getResponse<FastifyReply>(), session.id);
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
