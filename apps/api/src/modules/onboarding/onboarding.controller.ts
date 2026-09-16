import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { SessionUser } from '@jobtrack/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingService } from './onboarding.service';

// Authentifiée et protégée par CSRF par défaut (aucun @Public()/@NoCsrf()) :
// on ne pose ce drapeau que pour la session en cours.
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(@CurrentUser() user: SessionUser): Promise<void> {
    await this.onboarding.complete(user.id);
  }
}
