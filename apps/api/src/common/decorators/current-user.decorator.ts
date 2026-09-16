import { createParamDecorator, type ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { SessionUser } from '@jobtrack/shared';
import type { AuthenticatedRequest } from '../../modules/auth/auth.guard';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionUser => {
  const { user } = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>();
  // Erreur de programmation, jamais une entrée utilisateur : @CurrentUser() sur une route @Public().
  if (!user) throw new InternalServerErrorException('@CurrentUser() utilisé sur une route sans garde.');
  return user;
});
