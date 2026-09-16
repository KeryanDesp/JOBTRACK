import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import type { RegisterInput, SessionUser } from '@jobtrack/shared';
import { OAuthProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { GoogleProfile } from './google.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const EMAIL_TAKEN = { code: 'EMAIL_TAKEN', message: 'Un compte existe déjà avec cette adresse email.' };
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };
const NO_PASSWORD_SET = {
  code: 'NO_PASSWORD_SET',
  message: 'Ce compte n’a pas de mot de passe. Utilisez « Mot de passe oublié » pour en définir un.',
};
const INVALID_CURRENT_PASSWORD = {
  code: 'INVALID_CURRENT_PASSWORD',
  message: 'Le mot de passe actuel est incorrect.',
};

type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

/** Course entre deux callbacks Google simultanés pour le même compte : jamais un 409 sur une redirection navigateur. */
function isConcurrentGoogleLink(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async register(input: RegisterInput): Promise<SessionUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException(EMAIL_TAKEN);

    const passwordHash = await this.passwords.hash(input.password);

    try {
      // Profil et préférences sont créés vides : l'application ne manipule
      // jamais un utilisateur sans profil.
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          profile: {
            create: {
              firstName: input.firstName,
              lastName: input.lastName,
              preferences: { create: {} },
            },
          },
        },
        include: { profile: true },
      });
      return this.toSessionUser(user);
    } catch (error) {
      // Course entre deux inscriptions : la contrainte unique tranche, pas le findUnique.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(EMAIL_TAKEN);
      }
      throw error;
    }
  }

  async validateCredentials(email: string, password: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { profile: true } });

    if (!user?.passwordHash) {
      // Compte inexistant, ou compte Google sans mot de passe :
      // même message et même temps de réponse dans les deux cas.
      await this.passwords.burnTime();
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException(INVALID_CREDENTIALS);

    // Paramètres argon2 relevés depuis la création du compte : on re-hache à la volée,
    // sinon burnTime() (coût actuel) et verify (ancien coût) redeviendraient distinguables.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const passwordHash = await this.passwords.hash(password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    }

    return this.toSessionUser(user);
  }

  async findSessionUser(userId: string): Promise<SessionUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    return user ? this.toSessionUser(user) : null;
  }

  /**
   * Change le mot de passe après vérification de l'actuel, puis ferme toutes les sessions
   * sauf `keepSessionId` (l'appelant). `AuthGuard` garantit déjà l'existence de
   * l'utilisateur pour cette requête ; `findUniqueOrThrow` reste défensif face à une
   * suppression de compte survenue entre-temps.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.passwordHash) {
      // Compte Google sans mot de passe local : rien à comparer.
      throw new BadRequestException(NO_PASSWORD_SET);
    }

    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) {
      // Signal utile : la session est valide mais le mot de passe fourni est faux
      // (piste d'une session volée dont l'attaquant ne connaît pas le mot de passe).
      this.logger.warn(`Mot de passe actuel invalide pour l'utilisateur ${userId}`);
      // 400, pas 401 : la session en cours reste valide, seul le mot de passe fourni est faux.
      throw new BadRequestException(INVALID_CURRENT_PASSWORD);
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Trace d'audit (warn : survit à un niveau de journal réduit). Identifiant seulement.
    this.logger.warn(`Mot de passe modifié pour l'utilisateur ${userId}`);

    try {
      await this.sessions.destroyAllForUser(userId, keepSessionId);
    } catch (error) {
      // Même traitement que PasswordResetFlow.completeReset : le mot de passe est déjà
      // changé (jamais annulé après coup), donc un Redis en panne ici doit remonter un
      // 503 explicite plutôt qu'un succès muet qui laisserait d'autres appareils connectés.
      this.logger.error(
        `Fermeture des autres sessions après changement de mot de passe impossible (${userId})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message:
            'Votre mot de passe a été changé, mais vos autres appareils n’ont pas pu être déconnectés. Déconnectez-les depuis vos paramètres.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Rattachement Google : compte OAuth déjà lié → cet utilisateur ; sinon utilisateur existant
   * avec le même email (normalisé) → on le lie ; sinon création complète (profil, préférences,
   * email déjà vérifié par Google). Le `sub` Google est la clé stable ; l'email peut changer côté
   * Google sans jamais déplacer le rattachement une fois posé.
   */
  async findOrCreateFromGoogle(profile: GoogleProfile): Promise<SessionUser> {
    const linked = await this.findByGoogleAccount(profile.providerAccountId);
    if (linked) return this.toSessionUser(linked);

    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { profile: true },
    });

    if (existing) {
      // Rattachement automatique seulement si personne d'inconnu ne possède déjà ce compte :
      // compte sans mot de passe, ou boîte mail déjà prouvée de notre côté. Sinon un attaquant
      // qui aurait inscrit l'adresse de la victime récupérerait sa session Google.
      if (existing.passwordHash !== null && existing.emailVerifiedAt === null) {
        throw new UnauthorizedException({
          code: 'GOOGLE_LINK_REQUIRES_LOGIN',
          message: 'Un compte existe déjà avec cette adresse. Connectez-vous par mot de passe pour le relier à Google.',
        });
      }

      try {
        await this.prisma.oAuthAccount.create({
          data: {
            provider: OAuthProvider.GOOGLE,
            providerAccountId: profile.providerAccountId,
            userId: existing.id,
          },
        });
        // Après la passerelle ci-dessus seulement : jamais un moyen de la contourner.
        // La boîte mail vient d'être prouvée par Google si elle ne l'était pas déjà.
        if (existing.emailVerifiedAt === null) {
          await this.prisma.user.update({
            where: { id: existing.id },
            data: { emailVerifiedAt: new Date() },
          });
        }
      } catch (error) {
        if (!isConcurrentGoogleLink(error)) throw error;
        const retried = await this.findByGoogleAccount(profile.providerAccountId);
        if (retried) return this.toSessionUser(retried);
        throw error;
      }
      // `emailVerifiedAt` n'apparaît pas dans SessionUser : `existing` (non ré-interrogé)
      // reste correct à renvoyer, seul le champ en base a changé ci-dessus.
      return this.toSessionUser(existing);
    }

    try {
      // profil et préférences créés d'emblée : comme register(), jamais d'utilisateur sans profil.
      const created = await this.prisma.user.create({
        data: {
          email: profile.email,
          emailVerifiedAt: new Date(),
          oauthAccounts: {
            create: { provider: OAuthProvider.GOOGLE, providerAccountId: profile.providerAccountId },
          },
          profile: {
            create: {
              firstName: profile.firstName,
              lastName: profile.lastName,
              preferences: { create: {} },
            },
          },
        },
        include: { profile: true },
      });
      return this.toSessionUser(created);
    } catch (error) {
      if (!isConcurrentGoogleLink(error)) throw error;
      const retried = await this.findByGoogleAccount(profile.providerAccountId);
      if (retried) return this.toSessionUser(retried);
      throw error;
    }
  }

  private async findByGoogleAccount(providerAccountId: string): Promise<UserWithProfile | null> {
    const link = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: OAuthProvider.GOOGLE, providerAccountId } },
      include: { user: { include: { profile: true } } },
    });
    return link?.user ?? null;
  }

  private toSessionUser(user: UserWithProfile): SessionUser {
    return {
      id: user.id,
      email: user.email,
      // register() crée toujours un profil ; le repli vide ne couvre qu'une base incohérente.
      firstName: user.profile?.firstName ?? '',
      lastName: user.profile?.lastName ?? '',
      onboardingCompleted: user.onboardingCompletedAt !== null,
    };
  }
}
