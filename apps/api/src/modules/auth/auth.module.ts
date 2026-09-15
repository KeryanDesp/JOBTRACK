import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GOOGLE_CONFIG, GoogleService, type GoogleConfig } from './google.service';
import { PasswordResetFlow } from './password-reset.flow';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    PasswordResetService,
    PasswordResetFlow,
    {
      provide: GOOGLE_CONFIG,
      // `null` en local et en CI : GOOGLE_* n'y est jamais renseigné, et le contrôleur
      // doit alors répondre 503 plutôt que d'échouer au démarrage.
      useFactory: (): GoogleConfig | null =>
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL
          ? {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              callbackUrl: env.GOOGLE_CALLBACK_URL,
            }
          : null,
    },
    {
      provide: GoogleService,
      inject: [GOOGLE_CONFIG],
      useFactory: (config: GoogleConfig | null): GoogleService | null => (config ? new GoogleService(config) : null),
    },
  ],
  exports: [AuthService, SessionService, PasswordService],
})
export class AuthModule {}
