import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from './argon2.options';

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Hachage factice réel, partagé par tous les appels à burnTime().
   * Une chaîne inventée serait rejetée par argon2 avant tout calcul, et
   * burnTime() ne brûlerait alors aucun temps.
   */
  private dummyHash: Promise<string> | null = null;

  /** Calculé au démarrage : une panne d'argon2 fait échouer le boot, pas la première connexion. */
  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch (error) {
      if (error instanceof TypeError) {
        // Digest illisible en base : le compte est inutilisable, mais ce n'est pas une panne.
        // On refuse en laissant une trace pour l'exploitation.
        this.logger.error('Hachage stocké illisible : vérification refusée', error.stack);
        return false;
      }
      // Binding natif indisponible, allocation impossible : panne d'infrastructure.
      // Propagée, elle donne une 500 tracée plutôt qu'un 401 silencieux pour tout le monde.
      throw error;
    }
  }

  /** Vrai si le hachage a été produit avec des paramètres plus faibles que les actuels. */
  needsRehash(hash: string): boolean {
    // argon2 compare timeCost/memoryCost/parallelism, pas le type.
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }

  /**
   * Consomme le même temps qu'une vérification réelle.
   * Sans cela, un attaquant distingue « compte inexistant » de « mot de passe faux »
   * en mesurant le temps de réponse. Hypothèse : les hachages en base ont les
   * paramètres courants (après une hausse des paramètres, needsRehash + re-hachage à la connexion).
   */
  async burnTime(): Promise<void> {
    await argon2.verify(await this.getDummyHash(), 'autre-mot-de-passe');
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('mot-de-passe-factice', ARGON2_OPTIONS).catch((error: unknown) => {
      // Un échec transitoire ne doit pas rester en cache : sinon burnTime() rejette
      // instantanément pour toujours et redevient un oracle d'énumération.
      this.dummyHash = null;
      throw error;
    });
    return this.dummyHash;
  }
}
