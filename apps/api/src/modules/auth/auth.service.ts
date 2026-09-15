import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { RegisterInput, SessionUser } from '@jobtrack/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { PasswordService } from './password.service';

const EMAIL_TAKEN = { code: 'EMAIL_TAKEN', message: 'Un compte existe déjà avec cette adresse email.' };
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };

type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

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

    return this.toSessionUser(user);
  }

  async findSessionUser(userId: string): Promise<SessionUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    return user ? this.toSessionUser(user) : null;
  }

  private toSessionUser(user: UserWithProfile): SessionUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.profile?.firstName ?? '',
      lastName: user.profile?.lastName ?? '',
    };
  }
}
