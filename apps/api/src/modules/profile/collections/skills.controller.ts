import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { reorderSchema, skillSchema, type ReorderInput, type SessionUser, type SkillInput } from '@jobtrack/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { ProfileCollectionService, type CollectionConfig, type CollectionRow } from '../collection.service';

@Controller('profile/skills')
export class SkillsController {
  constructor(private readonly collections: ProfileCollectionService) {}

  private readonly config: CollectionConfig = { name: 'skill', dateFields: [] } as const;

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<CollectionRow[]> {
    return this.collections.list(this.config, user.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(skillSchema)) body: SkillInput,
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
    @Body(new ZodValidationPipe(skillSchema)) body: SkillInput,
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
