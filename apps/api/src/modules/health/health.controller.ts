import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/rate-limit.guard';
import { HealthService, type HealthReport } from './health.service';

// Seule route publique sans autre garde-fou (pas d'authentification, pas de CSRF) :
// sans limite de débit, elle restait la seule route non throttlée de l'API.
@Public()
@RateLimit({ limit: 60, windowSeconds: 60, by: 'ip' })
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
