import { randomBytes } from 'node:crypto';
import {
  Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Inject, Logger, NotFoundException, Param,
  Post, Query, Req, Res,
} from '@nestjs/common';
import {
  forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, type ActiveSession,
  type ForgotPasswordInput, type LoginInput, type RegisterInput, type ResetPasswordInput, type SessionUser,
} from '@jobtrack/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NoCsrf } from '../../common/decorators/no-csrf.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ipEmailIdentity, RateLimit, rateLimitKey } from '../../common/rate-limit.guard';
import { RedisService } from '../../common/redis.service';
import { env } from '../../config/env';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { clearAuthCookies, OAUTH_STATE_COOKIE, OAUTH_STATE_OPTIONS, setAuthCookies } from './auth.cookies';
import type { AuthenticatedRequest } from './auth.guard';
import { LOGIN_ROUTE } from './auth.routes';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';
import { PasswordResetFlow } from './password-reset.flow';
import { SessionService } from './session.service';

const GOOGLE_NOT_CONFIGURED = {
  code: 'GOOGLE_NOT_CONFIGURED',
  message: "La connexion Google n'est pas disponible pour le moment.",
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
    private readonly resetFlow: PasswordResetFlow,
    @Inject(GoogleService) private readonly google: GoogleService | null,
  ) {}

  @Public()
  @NoCsrf()
  @Post('register')
  @RateLimit({ limit: 20, windowSeconds: 3600, by: 'ip' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const user = await this.auth.register(body);
    try {
      await this.openSession(user.id, request, reply);
    } catch (error) {
      // Le compte est déjà créé côté Postgres : une panne Redis à cet instant précis ne doit
      // pas faire échouer l'inscription, mais l'utilisateur doit savoir qu'il doit se reconnecter.
      this.logger.error(`Ouverture de session après inscription impossible : ${(error as Error).message}`);
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Votre compte a été créé mais la connexion a échoué. Essayez de vous connecter.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return user;
  }

  @Public()
  @NoCsrf()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit([
    { limit: 30, windowSeconds: 900, by: 'ip' },
    { limit: 5, windowSeconds: 900, by: 'ip+email' },
  ])
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const user = await this.auth.validateCredentials(body.email, body.password);

    // Remise à zéro du compteur ip+email : un utilisateur qui vient de prouver son identité
    // ne doit pas rester a une tentative du blocage. La regle par IP seule reste le rempart
    // contre le bourrage. `body.email` est deja normalise (trim + minuscules) par Zod.
    // LOGIN_ROUTE (pas `request.routeOptions.url`) : la même clé doit être reconstruite par
    // PasswordResetFlow, sans dépendre d'une requête en cours.
    await this.redis.client.del(rateLimitKey(LOGIN_ROUTE, ipEmailIdentity(request.ip, body.email)));

    await this.openSession(user.id, request, reply);
    return user;
  }

  @Public()
  @NoCsrf()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit([
    { limit: 10, windowSeconds: 3600, by: 'ip' },
    { limit: 3, windowSeconds: 3600, by: 'ip+email' },
  ])
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
  ): Promise<{ message: string }> {
    await this.resetFlow.requestReset(body.email);

    // Réponse identique que le compte existe ou non : pas d'énumération d'emails.
    return {
      message: 'Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.',
    };
  }

  @Public()
  @NoCsrf()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowSeconds: 3600, by: 'ip' })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.resetFlow.completeReset(body.token, body.password, request.ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.destroy(request.session.id, request.user.id);
    // Exécuté après le renouvellement éventuel posé par AuthGuard : ce Set-Cookie est le
    // dernier écrit sur la réponse, donc c'est lui qui gagne et expire bien les deux cookies.
    clearAuthCookies(reply);
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  @Get('sessions')
  async listSessions(@Req() request: AuthenticatedRequest): Promise<ActiveSession[]> {
    const sessions = await this.sessions.list(request.user.id);
    return sessions
      .map((session) => ({
        id: session.id,
        current: session.id === request.session.id,
        userAgent: session.userAgent,
        ip: session.ip,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    const owned = await this.sessions.list(request.user.id);
    if (!owned.some((session) => session.id === id)) {
      // 404 plutôt que 403 : ne pas révéler l'existence d'une session d'autrui.
      throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Cette session est introuvable.' });
    }
    await this.sessions.destroy(id, request.user.id);
  }

  @Public()
  @Get('google')
  startGoogle(@Res({ passthrough: true }) reply: FastifyReply): { url: string } {
    const google = this.requireGoogle();
    // Le state, dans un cookie signé, garantit que le callback répond à une demande
    // partie de ce navigateur (protection CSRF du flux OAuth).
    const state = randomBytes(24).toString('base64url');
    reply.setCookie(OAUTH_STATE_COOKIE, state, { ...OAUTH_STATE_OPTIONS, signed: true, httpOnly: true, maxAge: 600 });
    return { url: google.buildAuthUrl(state) };
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: FastifyRequest,
    // Pas de `passthrough` : cette route ne renvoie jamais de corps, seulement une redirection ;
    // c'est nous qui envoyons la réponse, Nest ne doit pas tenter de la compléter derrière nous.
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const google = this.requireGoogle();
    const stored = request.cookies?.[OAUTH_STATE_COOKIE];
    const unsigned = stored ? request.unsignCookie(stored) : null;
    reply.clearCookie(OAUTH_STATE_COOKIE, OAUTH_STATE_OPTIONS);

    if (!code || !state || !unsigned?.valid || unsigned.value !== state) {
      this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google`);
      return;
    }

    try {
      const profile = await google.exchangeCode(code);
      const user = await this.auth.findOrCreateFromGoogle(profile);
      await this.openSession(user.id, request, reply);
    } catch (error) {
      // Navigation de navigateur : une page d'erreur JSON n'aurait aucun sens.
      this.logger.warn(`Connexion Google refusée : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google`);
      return;
    }
    this.redirectTo(reply, `${env.WEB_ORIGIN}/profile`);
  }

  private requireGoogle(): GoogleService {
    if (!this.google) {
      throw new HttpException(GOOGLE_NOT_CONFIGURED, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.google;
  }

  /**
   * `reply.redirect(url)` sans code explicite réutiliserait le statut déjà posé par Nest
   * avant l'exécution du handler (200 par défaut sur un GET) au lieu de retomber sur 302 :
   * Fastify ne redéfinit le code par défaut que si aucun `.code()` n'a encore été appelé.
   */
  private redirectTo(reply: FastifyReply, url: string): void {
    reply.redirect(url, HttpStatus.FOUND);
  }

  private async openSession(userId: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sessionId = await this.sessions.create(userId, {
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip,
    });
    setAuthCookies(reply, sessionId);
  }
}
