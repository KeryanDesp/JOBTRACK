import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetFlow } from './password-reset.flow';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, PasswordResetService, PasswordResetFlow],
  exports: [AuthService, SessionService, PasswordService],
})
export class AuthModule {}
