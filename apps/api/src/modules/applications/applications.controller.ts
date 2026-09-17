import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  applicationListQuerySchema,
  createApplicationSchema,
  moveApplicationSchema,
  updateApplicationSchema,
  type ApplicationBoardDto,
  type ApplicationDetailDto,
  type ApplicationListQuery,
  type ApplicationListResponseDto,
  type ApplicationStatsDto,
  type CreateApplicationInput,
  type MoveApplicationInput,
  type SessionUser,
  type UpdateApplicationInput,
} from '@jobtrack/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRateLimit, UserRateLimitGuard } from '../../common/user-rate-limit.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

/**
 * Routes `/applications` (spec §6, tranche 6). Toutes authentifiées (aucun `@Public`, aucun
 * `@NoCsrf`) et filtrées par l'utilisateur de la session : le service ne reçoit jamais qu'un
 * `userId` venant du cookie, jamais du corps ni de l'URL.
 *
 * Les segments statiques (`stats`, `board`) sont déclarés avant `:id` — comme
 * `ResumeController`, un ordre explicite plutôt que la confiance dans l'arbitrage de
 * find-my-way.
 *
 * Aucune traduction d'erreur ici : le service lève directement les exceptions Nest portant le
 * code et le message français de la spec (`applications.errors.ts`), que `HttpExceptionFilter`
 * sérialise tel quel.
 */
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(applicationListQuerySchema)) query: ApplicationListQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ApplicationListResponseDto> {
    return this.applications.list(user.id, query);
  }

  @Get('stats')
  stats(@CurrentUser() user: SessionUser): Promise<ApplicationStatsDto> {
    return this.applications.stats(user.id);
  }

  @Get('board')
  board(@CurrentUser() user: SessionUser): Promise<ApplicationBoardDto> {
    return this.applications.board(user.id);
  }

  /**
   * Création (spec §5) : 60 par heure et par utilisateur. Une garde de route suffit ici —
   * contrairement à l'adaptation de CV, aucune ressource coûteuse n'est engagée avant les
   * contrôles, et le budget ne protège que d'un remplissage massif de la table.
   *
   * Budget distinct des deux budgets d'écriture ci-dessous (`application-write`,
   * `application-move`) : créer 60 candidatures par heure est déjà beaucoup, alors que
   * corriger une fiche ou réordonner un tableau se fait par dizaines en quelques minutes.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 60, windowSeconds: 3600, bucket: 'application-create' })
  create(
    @Body(new ZodValidationPipe(createApplicationSchema)) body: CreateApplicationInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.create(user.id, body);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<ApplicationDetailDto> {
    return this.applications.get(user.id, id);
  }

  /**
   * Modification (spec §6) : 600 par heure et par utilisateur. Chaque appel écrit une ligne et
   * peut ajouter un évènement d'historique — large de très loin pour un usage réel (une fiche
   * enregistrée à chaque champ quitté), mais borné, là où la route n'avait aucune limite.
   */
  @Patch(':id')
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ bucket: 'application-write', limit: 600, windowSeconds: 3600 })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateApplicationSchema)) body: UpdateApplicationInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.update(user.id, id, body);
  }

  /**
   * Déplacement Kanban (spec §6) : budget propre (`application-move`, 600 par heure et par
   * utilisateur) plutôt que celui des modifications de fiche — un glisser-déposer part par
   * rafales, et ne doit pas consommer le budget qui protège l'enregistrement d'une fiche. Le
   * déplacement reste borné : chacun écrit dans une transaction qui touche toute une colonne.
   */
  @Patch(':id/move')
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ bucket: 'application-move', limit: 600, windowSeconds: 3600 })
  move(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveApplicationSchema)) body: MoveApplicationInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.move(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.applications.remove(user.id, id);
  }
}
