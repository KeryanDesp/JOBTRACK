import { Body, Controller, Get, Patch } from '@nestjs/common';
import { jobPreferencesSchema, profileSchema, type JobPreferencesInput, type ProfileInput, type SessionUser } from '@jobtrack/shared';
import type { JobPreferences, Profile } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentUser() user: SessionUser): Promise<Profile> {
    return this.profiles.get(user.id);
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(profileSchema)) body: ProfileInput,
    @CurrentUser() user: SessionUser,
  ): Promise<Profile> {
    return this.profiles.update(user.id, body);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: SessionUser): Promise<JobPreferences> {
    return this.profiles.getPreferences(user.id);
  }

  @Patch('preferences')
  updatePreferences(
    @Body(new ZodValidationPipe(jobPreferencesSchema)) body: JobPreferencesInput,
    @CurrentUser() user: SessionUser,
  ): Promise<JobPreferences> {
    return this.profiles.updatePreferences(user.id, body);
  }
}
