import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '@jobtrack/shared';
import type { AuthenticatedRequest } from '../../modules/auth/auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
