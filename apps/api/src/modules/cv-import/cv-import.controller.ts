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
  type CvImportSummaryDto,
} from '@jobtrack/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UserRateLimit, UserRateLimitGuard } from '../../common/user-rate-limit.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { CvApplyService } from './cv-apply.service';
import { CvImportService } from './cv-import.service';

// Un upload et un retry consomment tous deux un appel Anthropic : même budget (3/h),
// partagé via ce bucket plutôt que compté séparément par route (voir `UserRateLimitGuard`).
const EXTRACTION_RATE_LIMIT = { limit: 3, windowSeconds: 3600, bucket: 'cv-extraction' } as const;

/** Code Fastify renvoyé par `request.file()` quand le corps n'est pas `multipart/form-data`. */
const INVALID_MULTIPART_CONTENT_TYPE_CODE = 'FST_INVALID_MULTIPART_CONTENT_TYPE';

/** Seul cast du fichier : `Error` ne déclare pas `code`, mais les erreurs Fastify (`createError`) le portent. */
function fastifyErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const withCode = error as Error & { code?: unknown };
  return typeof withCode.code === 'string' ? withCode.code : undefined;
}

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

  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<CvImportSummaryDto[]> {
    return this.imports.list(request.user.id);
  }

  @Post()
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit(EXTRACTION_RATE_LIMIT)
  async upload(@Req() request: AuthenticatedRequest): Promise<CvImportDto> {
    const file = await this.receiveFile(request);
    if (!file) {
      throw new BadRequestException({ code: 'INVALID_FILE', message: 'Aucun fichier reçu.' });
    }
    if (file.fieldname !== 'file') {
      throw new BadRequestException({ code: 'INVALID_FILE', message: 'Champ de fichier attendu : file.' });
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
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit(EXTRACTION_RATE_LIMIT)
  retry(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<CvImportDto> {
    return this.imports.retry(request.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    return this.imports.remove(request.user.id, id);
  }

  /** Un corps qui n'est pas `multipart/form-data` lève `FST_INVALID_MULTIPART_CONTENT_TYPE`
   * (406) avant même qu'on puisse chercher un fichier : mappé ici en 400 `INVALID_FILE`
   * (comme toute autre incohérence du fichier reçu), jamais un 406 générique. */
  private async receiveFile(request: AuthenticatedRequest) {
    try {
      return await request.file();
    } catch (error) {
      if (fastifyErrorCode(error) === INVALID_MULTIPART_CONTENT_TYPE_CODE) {
        throw new BadRequestException({ code: 'INVALID_FILE', message: 'Contenu multipart attendu.' });
      }
      throw error;
    }
  }
}
