// Augmente `FastifyRequest` (`.file()`) : sans cet import, rien dans le programme ne référence
// les types de `@fastify/multipart`, et `request.file()` ci-dessous ne serait pas typé.
import '@fastify/multipart';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  cvApplySchema,
  type CvApplyInput,
  type CvApplyResult,
  type CvCapabilities,
  type CvImportDto,
} from '@jobtrack/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UserRateLimit, UserRateLimitGuard } from '../../common/user-rate-limit.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { CvApplyService } from './cv-apply.service';
import { CvImportService } from './cv-import.service';

// Authentifiée et protégée par CSRF par défaut (aucun @Public()/@NoCsrf()).
@Controller('cv-imports')
export class CvImportController {
  constructor(
    private readonly imports: CvImportService,
    private readonly apply: CvApplyService,
  ) {}

  @Get('capabilities')
  capabilities(): CvCapabilities {
    return this.imports.capabilities();
  }

  @Post()
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 3, windowSeconds: 3600 })
  async upload(@Req() request: AuthenticatedRequest): Promise<CvImportDto> {
    const file = await request.file();
    if (!file) {
      throw new BadRequestException({ code: 'INVALID_FILE', message: 'Aucun fichier reçu.' });
    }
    // Le corps peut dépasser la limite (`fileSize`, voir `app.setup.ts`) : `toBuffer()` lève
    // alors `RequestFileTooLargeError` (413), propagée telle quelle jusqu'au filtre global.
    const buffer = await file.toBuffer();
    return this.imports.create(request.user.id, { buffer, mimeType: file.mimetype, fileName: file.filename });
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<CvImportDto> {
    return this.imports.get(request.user.id, id);
  }

  @Post(':id/apply')
  applyImport(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cvApplySchema)) body: CvApplyInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<CvApplyResult> {
    return this.apply.apply(request.user.id, id, body);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<CvImportDto> {
    return this.imports.retry(request.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    return this.imports.remove(request.user.id, id);
  }
}
