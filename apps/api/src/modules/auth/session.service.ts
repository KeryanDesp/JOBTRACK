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

/** 30 jours glissants, conformément à la spec. */
const TTL_SECONDS = 60 * 60 * 24 * 30;

@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  private key(id: string): string {
    return `session:${id}`;
  }

  private indexKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  async create(
    userId: string,
    meta: { userAgent: string | null; ip: string | null },
  ): Promise<string> {
    // 32 octets aléatoires : identifiant opaque, aucune donnée utilisateur n'y transite.
    const id = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const data: SessionData = { userId, ...meta, createdAt: now, lastSeenAt: now };

    await this.redis.client
      .multi()
      .set(this.key(id), JSON.stringify(data), 'EX', TTL_SECONDS)
      .sadd(this.indexKey(userId), id)
      .expire(this.indexKey(userId), TTL_SECONDS)
      .exec();

    return id;
  }

  /** Lit la session et prolonge sa durée de vie (session glissante). */
  async touch(id: string): Promise<SessionData | null> {
    const raw = await this.redis.client.get(this.key(id));
    if (!raw) return null;

    const data = JSON.parse(raw) as SessionData;
    const refreshed: SessionData = { ...data, lastSeenAt: new Date().toISOString() };

    await this.redis.client.set(this.key(id), JSON.stringify(refreshed), 'EX', TTL_SECONDS);
    return refreshed;
  }

  async destroy(id: string, userId: string): Promise<void> {
    await this.redis.client.multi().del(this.key(id)).srem(this.indexKey(userId), id).exec();
  }

  async list(userId: string): Promise<StoredSession[]> {
    const ids = await this.redis.client.smembers(this.indexKey(userId));
    if (ids.length === 0) return [];

    const values = await this.redis.client.mget(ids.map((id) => this.key(id)));
    const sessions: StoredSession[] = [];
    const expired: string[] = [];

    ids.forEach((id, index) => {
      const raw = values[index];
      if (raw) {
        sessions.push({ id, ...(JSON.parse(raw) as SessionData) });
      } else {
        expired.push(id);
      }
    });

    // L'index survit au TTL des sessions : on le nettoie au passage.
    if (expired.length > 0) await this.redis.client.srem(this.indexKey(userId), ...expired);

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
