import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../../common/redis.service';
import { SessionService } from './session.service';

const redis = new RedisService();
const sessions = new SessionService(redis);
const USER_ID = 'user-de-test';

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

    expect(id).toHaveLength(43); // 32 octets en base64url
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
});
