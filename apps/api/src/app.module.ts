import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { CsrfGuard } from './common/csrf.guard';
import { RateLimitGuard } from './common/rate-limit.guard';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProfileModule } from './modules/profile/profile.module';

@Module({
  imports: [CommonModule, AuthModule, ProfileModule, HealthModule],
  providers: [
    // L'ordre compte : débit d'abord (avant tout travail coûteux), puis session, puis CSRF.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
