import {
  Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Logger, NotFoundException, Param,
  Post, Req, Res,
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
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { clearAuthCookies, setAuthCookies } from './auth.cookies';
import type { AuthenticatedRequest } from './auth.guard';
import { LOGIN_ROUTE } from './auth.routes';
import { AuthService } from './auth.service';
import { PasswordResetFlow } from './password-reset.flow';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
    private readonly resetFlow: PasswordResetFlow,
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

  private async openSession(userId: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sessionId = await this.sessions.create(userId, {
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip,
    });
    setAuthCookies(reply, sessionId);
  }
}
