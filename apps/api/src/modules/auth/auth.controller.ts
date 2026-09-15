import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, Res,
} from '@nestjs/common';
import {
  loginSchema, registerSchema, type ActiveSession, type LoginInput, type RegisterInput, type SessionUser,
} from '@jobtrack/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NoCsrf } from '../../common/decorators/no-csrf.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/rate-limit.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { clearAuthCookies, setAuthCookies } from './auth.cookies';
import type { AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @NoCsrf()
  @Post('register')
  @RateLimit({ limit: 10, windowSeconds: 3600, by: 'ip' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const user = await this.auth.register(body);
    await this.openSession(user.id, request, reply);
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
    await this.openSession(user.id, request, reply);
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.destroy(request.session.id, request.user.id);
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
