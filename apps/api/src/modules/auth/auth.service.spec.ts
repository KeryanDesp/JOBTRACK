import { ConflictException, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { ARGON2_OPTIONS } from './argon2.options';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

const prisma = new PrismaService();
const service = new AuthService(prisma, new PasswordService());

// Suffixe par processus : deux workers vitest ne doivent pas partager le meme email.
const INPUT = {
  email: `essai-${process.pid}@jobtrack.local`,
  password: 'motdepasse-solide-2026',
  firstName: 'Essai',
  lastName: 'Utilisateur',
};

const GOOGLE_EMAIL = `google-${process.pid}@jobtrack.local`;

const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
  await prisma.user.deleteMany({ where: { email: GOOGLE_EMAIL } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
  await prisma.user.deleteMany({ where: { email: GOOGLE_EMAIL } });
  await prisma.$disconnect();
});

describe('AuthService', () => {
  it('cree l_utilisateur avec un profil et des preferences vides', async () => {
    const user = await service.register(INPUT);

    expect(user.email).toBe(INPUT.email);
    expect(user.firstName).toBe('Essai');

    const stored = await prisma.user.findUnique({
      where: { email: INPUT.email },
      include: { profile: { include: { preferences: true } } },
    });
    expect(stored?.profile).not.toBeNull();
    expect(stored?.profile?.preferences).not.toBeNull();
    expect(stored?.passwordHash).not.toBe(INPUT.password); // jamais en clair
  });

  it('refuse une inscription sur un email deja pris', async () => {
    await service.register(INPUT);
    await expect(service.register(INPUT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('renvoie 409 quand l_email apparait entre le controle et l_insertion', async () => {
    // Simule la course : la ligne existe déjà quand `create` s'exécute, sans que
    // `findUnique` l'ait vue. Le 409 doit venir du mappage de P2002.
    // Instance dediee : on ne mocke jamais le client partage par les autres tests.
    const racePrisma = new PrismaService();
    const raceService = new AuthService(racePrisma, new PasswordService());
    try {
      await racePrisma.user.create({ data: { email: INPUT.email, passwordHash: 'x' } });
      vi.spyOn(racePrisma.user, 'findUnique').mockResolvedValueOnce(null);
      await expect(raceService.register(INPUT)).rejects.toBeInstanceOf(ConflictException);
    } finally {
      vi.restoreAllMocks();
      await racePrisma.$disconnect();
    }
  });

  it('authentifie avec les bons identifiants', async () => {
    await service.register(INPUT);
    const user = await service.validateCredentials(INPUT.email, INPUT.password);
    expect(user.email).toBe(INPUT.email);
  });

  it('refuse un mauvais mot de passe', async () => {
    await service.register(INPUT);
    const error: unknown = await service
      .validateCredentials(INPUT.email, 'mauvais')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual(INVALID_CREDENTIALS);
  });

  it('renvoie la meme erreur pour un compte inexistant', async () => {
    // Le message ne doit jamais révéler si l'email est enregistré.
    await expect(
      service.validateCredentials(`inconnu-${process.pid}@jobtrack.local`, 'peu-importe'),
    ).rejects.toThrowError('Identifiants invalides.');
  });

  it('refuse un compte sans mot de passe avec la meme erreur', async () => {
    // Compte créé par OAuth (Google) : pas de mot de passe local, mais le
    // message et le code renvoyés doivent être identiques à un mauvais mot de passe.
    await prisma.user.create({ data: { email: GOOGLE_EMAIL, passwordHash: null } });

    const error: unknown = await service
      .validateCredentials(GOOGLE_EMAIL, 'peu-importe')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual(INVALID_CREDENTIALS);
  });

  it('re-hache a la connexion un mot de passe aux parametres obsoletes', async () => {
    await service.register(INPUT);

    // Simule un hachage produit avec des paramètres argon2 plus faibles que les actuels.
    const staleHash = await argon2.hash(INPUT.password, { ...ARGON2_OPTIONS, memoryCost: 8192 });
    await prisma.user.update({ where: { email: INPUT.email }, data: { passwordHash: staleHash } });

    await service.validateCredentials(INPUT.email, INPUT.password);

    const stored = await prisma.user.findUnique({ where: { email: INPUT.email } });
    expect(stored?.passwordHash).toContain('$m=19456,t=2,p=1$');
  });

  it('findSessionUser renvoie l_utilisateur pour un id existant', async () => {
    const registered = await service.register(INPUT);

    await expect(service.findSessionUser(registered.id)).resolves.toEqual(registered);
  });

  it('findSessionUser renvoie null pour un id inexistant', async () => {
    await expect(service.findSessionUser('inexistant')).resolves.toBeNull();
  });
});
