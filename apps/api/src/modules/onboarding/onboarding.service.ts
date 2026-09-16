import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pose `onboardingCompletedAt` si elle est encore nulle. Idempotent : un second
   * appel (double clic, requête rejouée) ne modifie pas la date déjà posée.
   */
  async complete(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date() },
    });
  }
}
