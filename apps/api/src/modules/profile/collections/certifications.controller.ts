import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { certificationSchema, reorderSchema, type CertificationInput, type ReorderInput, type SessionUser } from '@jobtrack/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { ProfileCollectionService, type CollectionConfig, type CollectionRow } from '../collection.service';

@Controller('profile/certifications')
export class CertificationsController {
  constructor(private readonly collections: ProfileCollectionService) {}

  private readonly config: CollectionConfig = { name: 'certification', dateFields: ['issuedAt', 'expiresAt'] } as const;

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<CollectionRow[]> {
    return this.collections.list(this.config, user.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(certificationSchema)) body: CertificationInput,
    @CurrentUser() user: SessionUser,
  ): Promise<CollectionRow> {
    return this.collections.create(this.config, user.id, body);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    return this.collections.reorder(this.config, user.id, body.ids);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(certificationSchema)) body: CertificationInput,
    @CurrentUser() user: SessionUser,
  ): Promise<CollectionRow> {
    return this.collections.update(this.config, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.collections.remove(this.config, user.id, id);
  }
}
