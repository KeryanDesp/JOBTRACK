import type { RedisKey } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from '../../common/redis.service';
import { SessionService } from './session.service';

const redis = new RedisService();
const sessions = new SessionService(redis);
// Suffixe par processus : deux workers vitest ne doivent pas partager le meme index.
const USER_ID = `user-de-test-${process.pid}`;

beforeEach(async () => {
  await sessions.destroyAllForUser(USER_ID);
});

afterAll(async () => {
  await sessions.destroyAllForUser(USER_ID);
  await redis.onModuleDestroy();
});

describe('SessionService', () => {
  it('cree une session lisible et opaque', async () => {
    const id = await sessions.create(USER_ID, { userAgent: 'vitest', ip: '127.0.0.1' });

    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 octets en base64url
    const data = await sessions.touch(id);
    expect(data?.userId).toBe(USER_ID);
    expect(data?.userAgent).toBe('vitest');
  });

  it('renvoie null pour une session inconnue', async () => {
    expect(await sessions.touch('session-inexistante')).toBeNull();
  });

  it('revoque une session precise', async () => {
    const id = await sessions.create(USER_ID, { userAgent: null, ip: null });
    await sessions.destroy(id, USER_ID);
    expect(await sessions.touch(id)).toBeNull();
  });

  it('liste les sessions actives de l_utilisateur', async () => {
    await sessions.create(USER_ID, { userAgent: 'appareil-a', ip: null });
    await sessions.create(USER_ID, { userAgent: 'appareil-b', ip: null });

    const list = await sessions.list(USER_ID);
    expect(list).toHaveLength(2);
    expect(list.map((item) => item.userAgent).sort()).toEqual(['appareil-a', 'appareil-b']);
  });

  it('revoque toutes les sessions sauf celle indiquee', async () => {
    const kept = await sessions.create(USER_ID, { userAgent: 'gardee', ip: null });
    await sessions.create(USER_ID, { userAgent: 'revoquee', ip: null });

    await sessions.destroyAllForUser(USER_ID, kept);

    const list = await sessions.list(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(kept);
  });

  it('prolonge aussi la duree de vie de l_index, sinon une session active deviendrait irrevocable', async () => {
    const id = await sessions.create(USER_ID, { userAgent: null, ip: null });
    // Simule l'index arrive a echeance alors que la session, elle, vit encore.
    await redis.client.expire(`user_sessions:${USER_ID}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await redis.client.exists(`user_sessions:${USER_ID}`)).toBe(0);

    expect(await sessions.touch(id)).not.toBeNull();

    expect(await redis.client.ttl(`user_sessions:${USER_ID}`)).toBeGreaterThan(1000);
    expect((await sessions.list(USER_ID)).map((s) => s.id)).toEqual([id]);
    await sessions.destroyAllForUser(USER_ID);
    expect(await redis.client.exists(`session:${id}`)).toBe(0);
  });

  it('ne ressuscite pas une session revoquee entre la lecture et l_ecriture', async () => {
    const id = await sessions.create(USER_ID, { userAgent: null, ip: null });
    // Force le chemin de reecriture (lastSeenAt perime) puis intercale un destroy apres le GET.
    const key = `session:${id}`;
    const stored = JSON.parse((await redis.client.get(key)) as string) as { lastSeenAt: string };
    stored.lastSeenAt = new Date(Date.now() - 120_000).toISOString();
    await redis.client.set(key, JSON.stringify(stored), 'KEEPTTL');
    const originalGet = redis.client.get.bind(redis.client);
    vi.spyOn(redis.client, 'get').mockImplementationOnce(async (k: RedisKey) => {
      const raw = await originalGet(k);
      await sessions.destroy(id, USER_ID);
      return raw;
    });

    expect(await sessions.touch(id)).toBeNull();
    expect(await redis.client.exists(key)).toBe(0);
    vi.restoreAllMocks();
  });

  it('rejette un identifiant malforme sans interroger redis', async () => {
    const getSpy = vi.spyOn(redis.client, 'get');
    expect(await sessions.touch('trop-court')).toBeNull();
    expect(await sessions.touch('x'.repeat(43) + '!')).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('traite une valeur corrompue comme une session absente', async () => {
    const id = await sessions.create(USER_ID, { userAgent: null, ip: null });
    await redis.client.set(`session:${id}`, '{pas du json', 'KEEPTTL');
    expect(await sessions.touch(id)).toBeNull();
    expect(await redis.client.exists(`session:${id}`)).toBe(0); // pas d'orpheline
    expect(await sessions.list(USER_ID)).toEqual([]);
  });

  it('tronque un user-agent demesure', async () => {
    const id = await sessions.create(USER_ID, { userAgent: 'a'.repeat(1000), ip: null });
    expect((await sessions.touch(id))?.userAgent).toHaveLength(256);
  });

  it('signale le rafraichissement de lastSeenAt une fois par minute au plus', async () => {
    const id = await sessions.create(USER_ID, { userAgent: null, ip: null });

    // Immediatement apres create() : lastSeenAt est deja a jour, pas de reecriture.
    expect((await sessions.touch(id))?.refreshed).toBe(false);

    // Simule l'ecoulement du delai de staleness pour forcer la reecriture.
    const key = `session:${id}`;
    const stored = JSON.parse((await redis.client.get(key)) as string) as { lastSeenAt: string };
    stored.lastSeenAt = new Date(Date.now() - 120_000).toISOString();
    await redis.client.set(key, JSON.stringify(stored), 'KEEPTTL');

    expect((await sessions.touch(id))?.refreshed).toBe(true);
    // La reecriture vient de se produire : un appel immediat qui suit ne doit pas la refaire.
    expect((await sessions.touch(id))?.refreshed).toBe(false);
  });
});
