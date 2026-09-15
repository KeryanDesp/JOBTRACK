import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';

const TTL_SECONDS = 60 * 60; // une heure
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Jetons de réinitialisation à usage unique. Seule l'empreinte SHA-256 du jeton est
 * stockée : une fuite de Redis ne permet pas de réinitialiser un mot de passe.
 * Un index `pwreset_user:{userId}` garde le jeton courant : en émettre un nouveau
 * invalide le précédent, pour qu'un lien oublié dans une boîte mail ne reste pas valable.
 */
@Injectable()
export class PasswordResetService {
  constructor(private readonly redis: RedisService) {}

  static keyFor(token: string): string {
    return `pwreset:${createHash('sha256').update(token).digest('hex')}`;
  }

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const key = PasswordResetService.keyFor(token);
    const indexKey = `pwreset_user:${userId}`;

    const previous = await this.redis.client.getdel(indexKey);
    await this.redis.client
      .multi()
      .set(key, userId, 'EX', TTL_SECONDS)
      .set(indexKey, key, 'EX', TTL_SECONDS)
      .exec();
    if (previous) await this.redis.client.del(previous);

    return token;
  }

  /** Renvoie l'identifiant utilisateur et invalide le jeton (usage unique, GETDEL atomique). */
  async consume(token: string): Promise<string | null> {
    if (!TOKEN_PATTERN.test(token)) return null;

    const key = PasswordResetService.keyFor(token);
    const userId = await this.redis.client.getdel(key);
    if (!userId) return null;

    await this.redis.client.del(`pwreset_user:${userId}`);
    return userId;
  }
}
