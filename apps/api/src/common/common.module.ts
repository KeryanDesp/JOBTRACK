import { Global, Module } from '@nestjs/common';
import { anthropicClientProvider, ANTHROPIC_CLIENT } from './anthropic.provider';
import { PrismaService } from './prisma.service';
import { RateLimiterService } from './rate-limiter.service';
import { RedisService } from './redis.service';
import { DiskFileStorage } from './storage/disk-file-storage';
import { FILE_STORAGE } from './storage/file-storage';

@Global()
@Module({
  providers: [
    PrismaService,
    RedisService,
    RateLimiterService,
    anthropicClientProvider,
    // `useFactory` plutôt que `useClass` : le constructeur accepte un `rootDir` en
    // paramètre (type primitif `string`) pour les tests, que Nest ne saurait pas
    // résoudre par injection de dépendances.
    { provide: FILE_STORAGE, useFactory: (): DiskFileStorage => new DiskFileStorage() },
  ],
  exports: [PrismaService, RedisService, RateLimiterService, ANTHROPIC_CLIENT, FILE_STORAGE],
})
export class CommonModule {}
