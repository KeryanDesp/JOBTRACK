import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { serviceUnavailable } from './service-unavailable';

// INCR et EXPIRE dans un même script : pas de compteur éternel si le processus
// meurt entre les deux, pas de fenêtre prolongée par deux premiers appels concurrents
// (contrairement à un INCR puis un EXPIRE conditionnel séparés, non atomiques).
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export interface RateLimitHit {
  count: number;
  allowed: boolean;
}

/**
 * Compteur de débit partagé par les gardes IP et par utilisateur : la même clé
 * incrémentée de la même façon, seule l'identité qui compose la clé Redis change.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(private readonly redis: RedisService) {}

  /** Incrémente `key`, fixe son expiration au premier appel. Échoue fermé (503) si Redis répond mal. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitHit> {
    let count: unknown;
    try {
      count = await this.redis.client.eval(INCREMENT_SCRIPT, 1, key, windowSeconds);
    } catch (error) {
      this.logger.error(`Compteur de débit indisponible pour ${key} : ${(error as Error).message}`);
      throw serviceUnavailable();
    }
    if (typeof count !== 'number') {
      // Réponse Redis inattendue : on ne sait pas si la limite est respectée.
      this.logger.error(`Réponse Redis inattendue pour ${key} : ${String(count)}`);
      throw serviceUnavailable();
    }

    return { count, allowed: count <= limit };
  }
}
