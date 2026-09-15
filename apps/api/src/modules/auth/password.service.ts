import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from './argon2.options';

@Injectable()
export class PasswordService {
  /**
   * Hachage factice réel, calculé une seule fois à la première demande.
   * Une chaîne inventée serait rejetée par argon2 avant tout calcul, et
   * burnTime() ne brûlerait alors aucun temps.
   */
  private dummyHash: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Hachage illisible : on refuse plutôt que de propager une erreur 500.
      return false;
    }
  }

  /**
   * Consomme le même temps qu'une vérification réelle.
   * Sans cela, un attaquant distingue « compte inexistant » de « mot de passe faux »
   * en mesurant le temps de réponse.
   */
  async burnTime(): Promise<void> {
    this.dummyHash ??= argon2.hash('mot-de-passe-factice', ARGON2_OPTIONS);
    await argon2.verify(await this.dummyHash, 'autre-mot-de-passe');
  }
}
