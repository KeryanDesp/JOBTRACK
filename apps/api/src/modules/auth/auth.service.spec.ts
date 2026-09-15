import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
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

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
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
    await racePrisma.user.create({ data: { email: INPUT.email, passwordHash: 'x' } });
    vi.spyOn(racePrisma.user, 'findUnique').mockResolvedValueOnce(null);
    try {
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
    await expect(service.validateCredentials(INPUT.email, 'mauvais')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('renvoie la meme erreur pour un compte inexistant', async () => {
    // Le message ne doit jamais révéler si l'email est enregistré.
    await expect(
      service.validateCredentials(`inconnu-${process.pid}@jobtrack.local`, 'peu-importe'),
    ).rejects.toThrowError('Identifiants invalides.');
  });
});
