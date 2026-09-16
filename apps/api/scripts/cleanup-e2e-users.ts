import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import Redis from 'ioredis';

// Même résolution que `src/config/env.ts` : le `.env` racine, présent qu'on lance
// ce script depuis la racine du monorepo (`pnpm e2e:cleanup` via turbo) ou depuis
// `apps/api` (`pnpm --filter @jobtrack/api e2e:cleanup`). Absent en CI, où les
// variables viennent de l'environnement — ignoré sans erreur dans ce cas.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

/** Suffixe réservé aux comptes créés par la suite Playwright — jamais un vrai utilisateur. */
const EMAIL_SUFFIX = '@playwright.local';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} est requis pour ce script.`);
  return value;
}

// Valide la présence de DATABASE_URL avant que Prisma n'échoue avec un message
// moins clair ; le client la relit lui-même depuis `process.env`.
requireEnv('DATABASE_URL');

const prisma = new PrismaClient();
const redis = new Redis(requireEnv('REDIS_URL'));

// Mêmes clés que `SessionService` (apps/api/src/modules/auth/session.service.ts) :
// ce script vit hors du conteneur Nest et ne peut pas réutiliser cette classe,
// mais doit rester en accord avec son schéma de clés.
function sessionKey(id: string): string {
  return `session:${id}`;
}

function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

/** Supprime toutes les sessions Redis d'un utilisateur, avant de supprimer le compte lui-même. */
async function destroySessions(userId: string): Promise<void> {
  const ids = await redis.smembers(userSessionsKey(userId));
  if (ids.length === 0) return;

  const pipeline = redis.multi();
  for (const id of ids) pipeline.del(sessionKey(id));
  pipeline.del(userSessionsKey(userId));
  await pipeline.exec();
}

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });

  // Redis d'abord, Postgres ensuite : une session orpheline sans compte ne pose
  // aucun problème, l'inverse (compte supprimé, session encore valide) en poserait un.
  for (const user of users) {
    await destroySessions(user.id);
  }

  if (users.length > 0) {
    // Le profil et tout son contenu (expériences, compétences, etc.) sont supprimés
    // en cascade au niveau base (`onDelete: Cascade` dans schema.prisma) : jamais
    // besoin de les effacer explicitement ici, et jamais un autre utilisateur touché.
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  }

  console.log(`Nettoyage e2e : ${users.length} compte(s) ${EMAIL_SUFFIX} supprimé(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
    redis.disconnect();
  });
