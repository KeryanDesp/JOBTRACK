import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';

export interface SessionData {
  userId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export type StoredSession = SessionData & { id: string };

/**
 * 30 jours glissants, conformément à la spec. Exporté pour que le cookie de
 * session (maxAge) et la clé Redis (TTL) ne puissent jamais diverger.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/** 32 octets en base64url, sans remplissage : exactement 43 caractères. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `lastSeenAt` n'est réécrit qu'au-delà de ce délai : le TTL, lui, est toujours prolongé. */
const LAST_SEEN_STALENESS_MS = 60_000;

/** Un User-Agent pathologique ne doit pas gonfler indéfiniment la session. */
const USER_AGENT_MAX_LENGTH = 256;

@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  private key(id: string): string {
    return `session:${id}`;
  }

  private indexKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  private parse(raw: string): SessionData | null {
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      // Valeur corrompue : traitée comme absente plutôt que de faire échouer chaque requête.
      return null;
    }
  }

  async create(
    userId: string,
    meta: { userAgent: string | null; ip: string | null },
  ): Promise<string> {
    // 32 octets aléatoires : identifiant opaque, aucune donnée utilisateur n'y transite.
    const id = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const data: SessionData = {
      userId,
      userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      ip: meta.ip,
      createdAt: now,
      lastSeenAt: now,
    };

    await this.redis.client
      .multi()
      .set(this.key(id), JSON.stringify(data), 'EX', SESSION_TTL_SECONDS)
      .sadd(this.indexKey(userId), id)
      .expire(this.indexKey(userId), SESSION_TTL_SECONDS)
      .exec();

    return id;
  }

  /**
   * Lit la session et prolonge sa durée de vie ainsi que celle de l'index
   * (session glissante). Renvoie null pour un identifiant malformé, inconnu,
   * corrompu, ou révoqué entre la lecture et l'écriture.
   */
  async touch(id: string): Promise<StoredSession | null> {
    if (!SESSION_ID_PATTERN.test(id)) return null;

    const raw = await this.redis.client.get(this.key(id));
    if (!raw) return null;

    const data = this.parse(raw);
    if (!data) {
      // Clé corrompue : supprimée, sinon elle resterait orpheline jusqu'à son TTL.
      await this.redis.client.del(this.key(id));
      return null;
    }

    const now = Date.now();
    const stale = now - Date.parse(data.lastSeenAt) > LAST_SEEN_STALENESS_MS;
    const refreshed: SessionData = stale ? { ...data, lastSeenAt: new Date(now).toISOString() } : data;

    const pipeline = this.redis.client.multi();
    if (stale) {
      // XX : n'écrit que si la clé existe encore. Sans cela, un destroy() survenu
      // entre la lecture et l'écriture serait annulé et la session ressuscitée.
      pipeline.set(this.key(id), JSON.stringify(refreshed), 'EX', SESSION_TTL_SECONDS, 'XX');
    } else {
      pipeline.expire(this.key(id), SESSION_TTL_SECONDS);
    }
    // L'index doit vivre aussi longtemps que la plus récente des sessions,
    // sinon list() et destroyAllForUser() perdraient de vue une session active.
    // SADD (idempotent) recrée l'index s'il a expiré ; EXPIRE seul serait alors un no-op.
    pipeline.sadd(this.indexKey(data.userId), id);
    pipeline.expire(this.indexKey(data.userId), SESSION_TTL_SECONDS);
    const results = await pipeline.exec();

    // Premier résultat : `null` (SET XX) ou `0` (EXPIRE) signifie que la clé n'existe plus.
    const first = results?.[0]?.[1];
    if (first === null || first === 0) return null;

    return { id, ...refreshed };
  }

  async destroy(id: string, userId: string): Promise<void> {
    if (!SESSION_ID_PATTERN.test(id)) return;
    await this.redis.client.multi().del(this.key(id)).srem(this.indexKey(userId), id).exec();
  }

  async list(userId: string): Promise<StoredSession[]> {
    const ids = await this.redis.client.smembers(this.indexKey(userId));
    if (ids.length === 0) return [];

    const values = await this.redis.client.mget(ids.map((id) => this.key(id)));
    const sessions: StoredSession[] = [];
    const expired: string[] = [];

    const corrupted: string[] = [];

    ids.forEach((id, index) => {
      const raw = values[index];
      const data = raw ? this.parse(raw) : null;
      if (data) {
        sessions.push({ id, ...data });
      } else {
        expired.push(id);
        if (raw) corrupted.push(id);
      }
    });

    // L'index survit au TTL des sessions : on le nettoie au passage, et une
    // valeur corrompue est supprimée plutôt que laissée orpheline jusqu'à son TTL.
    if (expired.length > 0) {
      const pipeline = this.redis.client.multi().srem(this.indexKey(userId), ...expired);
      for (const id of corrupted) pipeline.del(this.key(id));
      await pipeline.exec();
    }

    return sessions;
  }

  async destroyAllForUser(userId: string, exceptId?: string): Promise<void> {
    const ids = await this.redis.client.smembers(this.indexKey(userId));
    const toDelete = ids.filter((id) => id !== exceptId);

    const pipeline = this.redis.client.multi();
    for (const id of toDelete) {
      pipeline.del(this.key(id));
      pipeline.srem(this.indexKey(userId), id);
    }
    await pipeline.exec();
  }
}
