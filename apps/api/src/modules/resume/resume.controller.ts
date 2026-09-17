import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  createCoverLetterSchema,
  createTailoredResumeSchema,
  updateCoverLetterSchema,
  updateResumeSchema,
  updateResumeTemplateSchema,
  type BaseResumeDto,
  type CoverLetterDto,
  type CoverLetterSummaryDto,
  type CreateCoverLetterInput,
  type CreateTailoredResumeInput,
  type ResumeDto,
  type ResumeSummaryDto,
  type SessionUser,
  type UpdateCoverLetterInput,
  type UpdateResumeInput,
  type UpdateResumeTemplateInput,
} from '@jobtrack/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CoverLetterStoreService } from './cover-letter-store.service';
import { AiNotConfiguredError, AiOutputInvalidError, AiUnavailableError, ProfileIncompleteError, RateLimitedError } from './resume.errors';
import { ResumeService } from './resume.service';

const AI_NOT_CONFIGURED_MESSAGE = "Le service IA n'est pas configuré.";
const AI_UNAVAILABLE_MESSAGE = 'Le service IA ne répond pas. Réessayez.';

/**
 * Routes du CV adapté et des lettres de motivation (spec §6, tâche 5) : le contrôleur traduit les
 * erreurs métier de `ResumeTailoringService`/`CoverLetterService` (jamais des exceptions Nest,
 * elles ne connaissent pas les codes HTTP) vers les codes de la spec — ni `ResumeService` ni
 * `CoverLetterStoreService` n'en ont besoin, ils ne font que propager. Ordre de déclaration
 * volontairement explicite (revue) : les segments statiques (`base`, `template`, `letters`,
 * `letters/:id`, `tailor`) sont tous posés avant `:id`, même si Fastify (find-my-way) les
 * départagerait de toute façon correctement quel que soit l'ordre.
 */
@Controller('resume')
export class ResumeController {
  constructor(
    private readonly resumes: ResumeService,
    private readonly letters: CoverLetterStoreService,
  ) {}

  @Get('base')
  getBase(@CurrentUser() user: SessionUser): Promise<BaseResumeDto> {
    return this.resumes.getBase(user.id);
  }

  @Patch('template')
  setTemplate(
    @Body(new ZodValidationPipe(updateResumeTemplateSchema)) body: UpdateResumeTemplateInput,
    @CurrentUser() user: SessionUser,
  ): Promise<BaseResumeDto> {
    return this.resumes.setTemplate(user.id, body.template);
  }

  @Get('letters')
  listLetters(@CurrentUser() user: SessionUser): Promise<CoverLetterSummaryDto[]> {
    return this.letters.list(user.id);
  }

  @Post('letters')
  @HttpCode(HttpStatus.CREATED)
  createLetter(
    @Body(new ZodValidationPipe(createCoverLetterSchema)) body: CreateCoverLetterInput,
    @CurrentUser() user: SessionUser,
  ): Promise<CoverLetterDto> {
    return this.letters.create(user.id, body).catch((error: unknown) => this.handleGenerationError(error));
  }

  @Get('letters/:id')
  getLetter(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<CoverLetterDto> {
    return this.letters.get(user.id, id);
  }

  @Patch('letters/:id')
  updateLetter(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCoverLetterSchema)) body: UpdateCoverLetterInput,
    @CurrentUser() user: SessionUser,
  ): Promise<CoverLetterDto> {
    return this.letters.update(user.id, id, body);
  }

  @Delete('letters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeLetter(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.letters.remove(user.id, id);
  }

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<ResumeSummaryDto[]> {
    return this.resumes.list(user.id);
  }

  @Post('tailor')
  @HttpCode(HttpStatus.CREATED)
  tailor(
    @Body(new ZodValidationPipe(createTailoredResumeSchema)) body: CreateTailoredResumeInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ResumeDto> {
    return this.resumes.createTailored(user.id, body).catch((error: unknown) => this.handleGenerationError(error));
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<ResumeDto> {
    return this.resumes.get(user.id, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateResumeSchema)) body: UpdateResumeInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ResumeDto> {
    return this.resumes.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.resumes.remove(user.id, id);
  }

  /** Traduit les erreurs métier communes à l'adaptation de CV et à la génération de lettre (mêmes
   * classes, spec §5) vers leur code HTTP (spec §6) — `TAILORING_IN_PROGRESS`/`LETTER_IN_PROGRESS`
   * (`ConflictException`) et `JOB_NOT_FOUND`/`RESUME_NOT_FOUND` (`NotFoundException`) sont déjà des
   * exceptions Nest correctement formées par les services eux-mêmes et n'ont donc pas besoin d'être
   * traduites ici — elles retombent dans la branche `throw error` ci-dessous, inchangées. */
  private handleGenerationError(error: unknown): never {
    if (error instanceof ProfileIncompleteError) {
      throw new HttpException({ code: error.code, message: error.message }, HttpStatus.CONFLICT);
    }
    if (error instanceof AiNotConfiguredError) {
      throw new HttpException({ code: 'AI_NOT_CONFIGURED', message: AI_NOT_CONFIGURED_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof AiUnavailableError) {
      throw new HttpException({ code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof AiOutputInvalidError) {
      throw new HttpException({ code: error.code, message: error.message }, HttpStatus.BAD_GATEWAY);
    }
    if (error instanceof RateLimitedError) {
      throw new HttpException({ code: error.code, message: error.message }, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw error;
  }
}
