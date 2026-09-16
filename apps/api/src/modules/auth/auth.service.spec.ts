import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../common/prisma.service';
import { ARGON2_OPTIONS } from './argon2.options';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const prisma = new PrismaService();
const redis = new RedisService();
const sessions = new SessionService(redis);
const service = new AuthService(prisma, new PasswordService(), sessions);

// Id de session arbitraire pour les tests qui n'ouvrent pas de vraie session :
// changePassword() ne fait que l'exclure d'un SREM sur un index vide, sans jamais y lire.
const NO_SESSION = 'aucune-session-de-test';

// Suffixe par processus : deux workers vitest ne doivent pas partager le meme email.
const INPUT = {
  email: `essai-${process.pid}@jobtrack.local`,
  password: 'motdepasse-solide-2026',
  firstName: 'Essai',
  lastName: 'Utilisateur',
};

const GOOGLE_EMAIL = `google-${process.pid}@jobtrack.local`;

// Distinct de GOOGLE_EMAIL ci-dessus (compte sans mot de passe) : ici, un vrai flux
// findOrCreateFromGoogle, avec un deuxième email pour le cas « le sub gagne ».
const GOOGLE_OAUTH_EMAIL = `google-oauth-${process.pid}@jobtrack.local`;
const GOOGLE_OAUTH_EMAIL_ALT = `google-oauth-alt-${process.pid}@jobtrack.local`;
const GOOGLE_OAUTH_SUB = `sub-${process.pid}`;

const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };

async function clearGoogleOAuthUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { in: [GOOGLE_OAUTH_EMAIL, GOOGLE_OAUTH_EMAIL_ALT] } } });
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
  await prisma.user.deleteMany({ where: { email: GOOGLE_EMAIL } });
  await clearGoogleOAuthUsers();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: INPUT.email } });
  await prisma.user.deleteMany({ where: { email: GOOGLE_EMAIL } });
  await clearGoogleOAuthUsers();
  await prisma.$disconnect();
  await redis.onModuleDestroy();
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
    const raceService = new AuthService(racePrisma, new PasswordService(), sessions);
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

  it('cree un compte google avec profil, preferences et email verifie', async () => {
    const user = await service.findOrCreateFromGoogle({
      providerAccountId: GOOGLE_OAUTH_SUB,
      email: GOOGLE_OAUTH_EMAIL,
      firstName: 'Personne',
      lastName: 'Exemple',
    });

    expect(user.email).toBe(GOOGLE_OAUTH_EMAIL);
    expect(user.firstName).toBe('Personne');
    expect(user.lastName).toBe('Exemple');

    const stored = await prisma.user.findUnique({
      where: { email: GOOGLE_OAUTH_EMAIL },
      include: { oauthAccounts: true },
    });
    expect(stored?.emailVerifiedAt).not.toBeNull();
    expect(stored?.passwordHash).toBeNull();
    expect(stored?.oauthAccounts).toHaveLength(1);
    expect(stored?.oauthAccounts[0]).toMatchObject({
      provider: 'GOOGLE',
      providerAccountId: GOOGLE_OAUTH_SUB,
    });
  });

  it('relie un compte google a un utilisateur existant portant le meme email', async () => {
    const registered = await service.register({
      email: GOOGLE_OAUTH_EMAIL,
      password: 'motdepasse-solide-2026',
      firstName: 'Existant',
      lastName: 'Utilisateur',
    });
    // Rattachement automatique réservé aux boîtes mail déjà prouvées de notre côté
    // (sinon C1 le refuse) : on simule ici un compte dont l'email a été vérifié.
    await prisma.user.update({ where: { id: registered.id }, data: { emailVerifiedAt: new Date() } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: registered.id } });

    const linked = await service.findOrCreateFromGoogle({
      providerAccountId: GOOGLE_OAUTH_SUB,
      email: GOOGLE_OAUTH_EMAIL,
      firstName: 'Personne',
      lastName: 'Exemple',
    });

    expect(linked.id).toBe(registered.id);

    const stored = await prisma.user.findUnique({
      where: { email: GOOGLE_OAUTH_EMAIL },
      include: { oauthAccounts: true },
    });
    expect(stored?.oauthAccounts).toHaveLength(1);
    // Le mot de passe existant n'est jamais touché par le rattachement (valeur, pas juste non-null).
    expect(stored?.passwordHash).toBe(before.passwordHash);
  });

  it('refuse de relier un compte a mot de passe dont l_email n_est pas verifie', async () => {
    await service.register({
      email: GOOGLE_OAUTH_EMAIL,
      password: 'motdepasse-solide-2026',
      firstName: 'Existant',
      lastName: 'Utilisateur',
    });
    // Email jamais vérifié : un attaquant ayant inscrit l'adresse de la victime ne doit
    // pas pouvoir prendre le contrôle du compte via un compte Google portant cette adresse.

    const error: unknown = await service
      .findOrCreateFromGoogle({
        providerAccountId: GOOGLE_OAUTH_SUB,
        email: GOOGLE_OAUTH_EMAIL,
        firstName: 'Personne',
        lastName: 'Exemple',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: 'GOOGLE_LINK_REQUIRES_LOGIN',
    });

    const stored = await prisma.user.findUnique({
      where: { email: GOOGLE_OAUTH_EMAIL },
      include: { oauthAccounts: true },
    });
    expect(stored?.oauthAccounts).toHaveLength(0);
  });

  it('retrouve l_utilisateur par son compte google deja lie', async () => {
    const first = await service.findOrCreateFromGoogle({
      providerAccountId: GOOGLE_OAUTH_SUB,
      email: GOOGLE_OAUTH_EMAIL,
      firstName: 'Personne',
      lastName: 'Exemple',
    });

    // Meme sub, email different cote Google : le rattachement deja pose l'emporte.
    const second = await service.findOrCreateFromGoogle({
      providerAccountId: GOOGLE_OAUTH_SUB,
      email: GOOGLE_OAUTH_EMAIL_ALT,
      firstName: 'Autre',
      lastName: 'Nom',
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe(GOOGLE_OAUTH_EMAIL);

    const stored = await prisma.user.findUnique({
      where: { id: first.id },
      include: { oauthAccounts: true },
    });
    expect(stored?.oauthAccounts).toHaveLength(1);
  });

  it('refuse un changement de mot de passe avec un mot de passe actuel incorrect', async () => {
    const registered = await service.register(INPUT);

    const error: unknown = await service
      .changePassword(registered.id, 'mauvais-mot-de-passe-actuel', 'nouveau-mot-de-passe-2026', NO_SESSION)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
    });
  });

  it('refuse un compte sans mot de passe', async () => {
    // Compte créé via le flux Google (findOrCreateFromGoogle), pas une insertion directe :
    // c'est le vrai chemin par lequel un utilisateur se retrouve sans mot de passe local.
    const user = await service.findOrCreateFromGoogle({
      providerAccountId: GOOGLE_OAUTH_SUB,
      email: GOOGLE_OAUTH_EMAIL,
      firstName: 'Personne',
      lastName: 'Exemple',
    });

    const error: unknown = await service
      .changePassword(user.id, 'peu-importe', 'nouveau-mot-de-passe-2026', NO_SESSION)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'NO_PASSWORD_SET',
    });
  });

  it('change le mot de passe : le nouveau valide, l_ancien est refuse', async () => {
    const registered = await service.register(INPUT);

    await service.changePassword(registered.id, INPUT.password, 'nouveau-mot-de-passe-2026', NO_SESSION);

    await expect(
      service.validateCredentials(INPUT.email, 'nouveau-mot-de-passe-2026'),
    ).resolves.toMatchObject({ email: INPUT.email });
    await expect(
      service.validateCredentials(INPUT.email, INPUT.password),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
