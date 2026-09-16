import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { ipEmailIdentity, rateLimitKey } from '../../common/rate-limit.guard';
import { RedisService } from '../../common/redis.service';
import { env } from '../../config/env';
import { LOGIN_ROUTE } from './auth.routes';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

function invalidToken(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_RESET_TOKEN',
    message: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.',
  });
}

/**
 * Regroupe la logique métier de « mot de passe oublié » : le contrôleur ne parle
 * qu'à ce service, jamais directement à Prisma.
 */
@Injectable()
export class PasswordResetFlow {
  private readonly logger = new Logger(PasswordResetFlow.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PasswordResetService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
  ) {}

  /** Émet un lien si le compte existe ; ne révèle jamais si c'est le cas. */
  async requestReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = await this.tokens.issue(user.id);
    if (env.NODE_ENV === 'production') {
      // Jamais le jeton dans les journaux d'un environnement partagé.
      this.logger.warn(`Lien de réinitialisation émis pour l'utilisateur ${user.id} (envoi email non branché)`);
    } else {
      // L'envoi par email arrive en tranche 7 ; le lien est journalisé en attendant.
      this.logger.log(`Lien de réinitialisation : ${env.WEB_ORIGIN}/reset-password?token=${token}`);
    }
  }

  /** Consomme le jeton, change le mot de passe, ferme toutes les sessions, débloque la connexion. */
  async completeReset(token: string, password: string, ip: string): Promise<void> {
    const userId = await this.tokens.consume(token);
    if (!userId) throw invalidToken();

    const passwordHash = await this.passwords.hash(password);
    let user: User;
    try {
      user = await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    } catch (error) {
      // Compte supprimé entre la consommation et la mise à jour : le lien ne désigne plus rien.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw invalidToken();
      }
      throw error;
    }
    // Trace d'audit (warn : survit à un niveau de journal réduit). Identifiant seulement, jamais l'email ni le jeton.
    this.logger.warn(`Mot de passe réinitialisé pour l'utilisateur ${userId}`);

    try {
      await this.sessions.destroyAllForUser(userId);
    } catch (error) {
      this.logger.error(
        `Fermeture des sessions après réinitialisation impossible (${userId})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message:
            'Votre mot de passe a été changé, mais vos autres sessions n’ont pas pu être fermées. Déconnectez-les depuis vos paramètres.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // L'utilisateur vient de prouver le contrôle de sa boîte mail : il ne doit pas rester bloqué à la connexion.
    await this.redis.client.del(rateLimitKey(LOGIN_ROUTE, ipEmailIdentity(ip, user.email)));
  }
}
