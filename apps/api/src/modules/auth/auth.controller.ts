import { createHash, randomBytes } from 'node:crypto';
import {
  Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Inject, Logger, NotFoundException, Param,
  Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import {
  changePasswordSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema,
  type ActiveSession, type ChangePasswordInput, type ForgotPasswordInput, type LoginInput, type RegisterInput,
  type ResetPasswordInput, type SessionUser,
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

// Durée de vie du cookie de state ET de la marque anti-rejeu côté Redis : le flux complet
// (redirection vers Google, consentement, retour) doit tenir dans cette fenêtre.
const OAUTH_STATE_TTL_SECONDS = 600;

interface PendingGoogleState {
  state: string;
  verifier: string;
}

/** `null` si le cookie est absent, expiré, mal signé, ou ne contient pas le JSON attendu. */
function parsePendingState(raw: string): PendingGoogleState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { state, verifier } = parsed as Record<string, unknown>;
  return typeof state === 'string' && typeof verifier === 'string' ? { state, verifier } : null;
}

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

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowSeconds: 3600, by: 'ip' })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: SessionUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    // La session en cours reste ouverte : seuls les autres appareils doivent être déconnectés.
    await this.sessions.destroyAllForUser(user.id, request.session.id);
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
  @RateLimit({ limit: 20, windowSeconds: 900, by: 'ip' })
  startGoogle(@Res({ passthrough: true }) reply: FastifyReply): { url: string } {
    const google = this.requireGoogle();
    // Le state, dans un cookie signé, garantit que le callback répond à une demande
    // partie de ce navigateur (protection CSRF du flux OAuth).
    const state = randomBytes(24).toString('base64url');
    // PKCE (RFC 9700 §2.1.1) : le vérifieur ne quitte jamais le serveur, seul son empreinte
    // (le « challenge ») part vers Google ; le vérifieur voyage dans le cookie signé.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    reply.setCookie(OAUTH_STATE_COOKIE, JSON.stringify({ state, verifier }), {
      ...OAUTH_STATE_OPTIONS,
      signed: true,
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return { url: google.buildAuthUrl(state, challenge) };
  }

  @Public()
  @Get('google/callback')
  @RateLimit({ limit: 30, windowSeconds: 900, by: 'ip' })
  async googleCallback(
    // `unknown` et non `string | undefined` : Fastify renvoie un tableau si le paramètre
    // est répété dans l'URL, jamais rejeté avant le pipe — on doit s'en méfier nous-mêmes.
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') oauthError: unknown,
    @Req() request: FastifyRequest,
    // Pas de `passthrough` : cette route ne renvoie jamais de corps, seulement une redirection ;
    // c'est nous qui envoyons la réponse, Nest ne doit pas tenter de la compléter derrière nous.
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stored = request.cookies?.[OAUTH_STATE_COOKIE];
    const unsigned = stored ? request.unsignCookie(stored) : null;
    reply.clearCookie(OAUTH_STATE_COOKIE, OAUTH_STATE_OPTIONS);
    const pending = unsigned?.valid && unsigned.value ? parsePendingState(unsigned.value) : null;

    // Le refus de consentement (« Annuler » sur l'écran Google) arrive sans `code` : un cas
    // à part, avant même de contrôler le state, pour offrir un message dédié côté SPA.
    if (oauthError === 'access_denied') {
      this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google_cancelled`);
      return;
    }

    if (typeof code !== 'string' || typeof state !== 'string' || !pending || pending.state !== state) {
      this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google`);
      return;
    }

    try {
      // À l'intérieur du try : une configuration manquante ne doit jamais renvoyer du JSON
      // à une navigation de navigateur, seulement une redirection lisible côté SPA.
      const google = this.requireGoogle();

      // State à usage unique côté serveur : un callback intercepté puis rejoué (le cookie
      // client a beau être effacé côté navigateur) ne doit ni ré-échanger le code Google
      // ni ouvrir une seconde session.
      if (!(await this.claimState(state))) {
        this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google`);
        return;
      }

      const profile = await google.exchangeCode(code, pending.verifier);
      const user = await this.auth.findOrCreateFromGoogle(profile);
      await this.openSession(user.id, request, reply);
    } catch (error) {
      this.redirectForGoogleError(reply, error);
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

  /** `true` la première fois pour un `state` donné ; `false` s'il a déjà été consommé. */
  private async claimState(state: string): Promise<boolean> {
    const key = `oauth_state_used:${createHash('sha256').update(state).digest('hex')}`;
    const claimed = await this.redis.client.set(key, '1', 'EX', OAUTH_STATE_TTL_SECONDS, 'NX');
    return claimed === 'OK';
  }

  /**
   * Traduit un échec du flux Google en redirection, jamais en JSON : `GOOGLE_LINK_REQUIRES_LOGIN`
   * a sa propre page (mot de passe requis) ; toute autre exception connue (échange refusé,
   * configuration absente) atterrit sur la page d'erreur générique et n'est journalisée qu'en
   * `warn` (attendue) ; une erreur non prévue est journalisée en `error`, avec sa pile.
   */
  private redirectForGoogleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const code = typeof response === 'object' && response !== null ? (response as { code?: unknown }).code : undefined;
      if (code === 'GOOGLE_LINK_REQUIRES_LOGIN') {
        this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google_link`);
        return;
      }
      this.logger.warn(`Connexion Google refusée : ${error.message}`);
      this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google`);
      return;
    }
    this.logger.error(
      `Connexion Google : erreur inattendue${error instanceof Error ? ` — ${error.message}` : ''}`,
      error instanceof Error ? error.stack : undefined,
    );
    this.redirectTo(reply, `${env.WEB_ORIGIN}/login?error=google`);
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
