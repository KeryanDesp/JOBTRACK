import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { RegisterInput, SessionUser } from '@jobtrack/shared';
import { OAuthProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { GoogleProfile } from './google.service';
import { PasswordService } from './password.service';

const EMAIL_TAKEN = { code: 'EMAIL_TAKEN', message: 'Un compte existe déjà avec cette adresse email.' };
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };

type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

/** Course entre deux callbacks Google simultanés pour le même compte : jamais un 409 sur une redirection navigateur. */
function isConcurrentGoogleLink(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
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
      try {
        await this.prisma.oAuthAccount.create({
          data: {
            provider: OAuthProvider.GOOGLE,
            providerAccountId: profile.providerAccountId,
            userId: existing.id,
          },
        });
      } catch (error) {
        if (!isConcurrentGoogleLink(error)) throw error;
        const retried = await this.findByGoogleAccount(profile.providerAccountId);
        if (retried) return this.toSessionUser(retried);
        throw error;
      }
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
    };
  }
}
