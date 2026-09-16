import argon2 from 'argon2';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARGON2_OPTIONS } from './argon2.options';
import { PasswordService } from './password.service';

const service = new PasswordService();

describe('PasswordService', () => {
  beforeAll(() => service.onModuleInit());

  it('produit un hachage argon2id verifiable', async () => {
    const hash = await service.hash('motdepasse-solide-2026');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await service.verify(hash, 'motdepasse-solide-2026')).toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hash = await service.hash('motdepasse-solide-2026');
    expect(await service.verify(hash, 'mauvais-mot-de-passe')).toBe(false);
  });

  it('produit des hachages differents pour un meme mot de passe', async () => {
    const [a, b] = await Promise.all([service.hash('identique-2026'), service.hash('identique-2026')]);
    expect(a).not.toBe(b); // le sel est aléatoire
  });

  it('renvoie false plutot que de lever sur un hachage corrompu', async () => {
    expect(await service.verify('pas-un-hachage', 'peu-importe')).toBe(false);
  });

  it('brule autant de temps qu_une verification reelle quand le compte n_existe pas', async () => {
    // Le premier appel a burnTime() peut calculer le hachage factice ; on l'amorce
    // ici pour mesurer le regime stable, comme le ferait onModuleInit() en production.
    await service.burnTime();

    const hash = await service.hash('reference-2026');
    const startReal = performance.now();
    await service.verify(hash, 'mauvais');
    const real = performance.now() - startReal;

    const startBurn = performance.now();
    await service.burnTime();
    const burn = performance.now() - startBurn;

    // Un hachage factice invalide serait rejeté instantanément (< 1 ms) : l'ordre de
    // grandeur d'une vérification argon2id réelle est de quelques dizaines de ms.
    expect(burn).toBeGreaterThan(5);
    expect(burn).toBeGreaterThan(real * 0.5);
  });

  it('applique les parametres OWASP au hachage produit', async () => {
    const hash = await service.hash('parametres-2026');
    expect(hash).toContain('$m=19456,t=2,p=1$');
  });

  it('detecte un hachage produit avec des parametres plus faibles', async () => {
    // timeCost: 1 est rejeté par argon2 (minimum imposé par la lib : 2) ; on affaiblit
    // memoryCost à la place pour obtenir un hachage valide mais sous les paramètres actuels.
    const weak = await argon2.hash('ancien-2026', { ...ARGON2_OPTIONS, memoryCost: 8192 });
    expect(service.needsRehash(weak)).toBe(true);
    expect(service.needsRehash(await service.hash('courant-2026'))).toBe(false);
  });
});
