import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPLICATION_STATUSES,
  type ApplicationBoardDto,
  type ApplicationDetailDto,
  type ApplicationDto,
  type ApplicationStatus,
  type MoveApplicationInput,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { ProfileInputsService } from '../matching/profile-inputs.service';
import { applicationNotFound } from './applications.errors';
import { todayUtc } from './lib/dates';
import { APPLICATION_INCLUDE, toApplicationDto } from './lib/dto';
import { reindexColumn, shiftPositionsAfterRemoval, shiftPositionsForInsertion } from './lib/positions';
import { loadApplicationDetail, loadMatchSummaries, matchOf } from './lib/read';

/** Cartes chargées par colonne du Kanban (spec §6 : « 200 cartes max par colonne »). */
const BOARD_COLUMN_TAKE = 200;

/**
 * Kanban des candidatures (spec §5/§6) : lecture des cinq colonnes et déplacement d'une carte.
 * Séparé de `ApplicationsService` — c'est la seule partie du module qui manipule l'ordre des
 * cartes, avec ses écritures ensemblistes et ses invariants propres ; la fiche, la table et le
 * CRUD n'en dépendent pas.
 */
@Injectable()
export class ApplicationsBoardService {
  private readonly logger = new Logger(ApplicationsBoardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileInputs: ProfileInputsService,
  ) {}

  /** Kanban (spec §6) : les cinq colonnes, toujours présentes même vides, triées par
   * `position` puis par ancienneté pour départager deux positions égales (jamais un ordre
   * indéterminé après une écriture concurrente). */
  async board(userId: string): Promise<ApplicationBoardDto> {
    const perStatus = await Promise.all(
      APPLICATION_STATUSES.map((status) =>
        this.prisma.application.findMany({
          where: { userId, status },
          include: APPLICATION_INCLUDE,
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          take: BOARD_COLUMN_TAKE,
        }),
      ),
    );

    const rows = perStatus.flat();
    const matches = await loadMatchSummaries(
      this.prisma,
      this.profileInputs,
      userId,
      rows.flatMap((row) => (row.jobId === null ? [] : [row.jobId])),
    );

    const columns: Record<ApplicationStatus, ApplicationDto[]> = {
      TO_APPLY: [],
      APPLIED: [],
      INTERVIEW: [],
      OFFER: [],
      REJECTED: [],
    };
    APPLICATION_STATUSES.forEach((status, index) => {
      columns[status] = (perStatus[index] ?? []).map((row) => toApplicationDto(userId, row, matchOf(matches, row)));
    });

    return { columns };
  }

  /**
   * Déplacement Kanban (spec §5/§6). Trois écritures ensemblistes dans une seule transaction,
   * quelle que soit la taille des colonnes (cf. `lib/positions.ts`) : la colonne source se
   * referme derrière la carte, la colonne cible s'ouvre à la position demandée, puis la carte
   * y est posée. Un déplacement à l'intérieur d'une même colonne suit exactement le même
   * chemin — la carte, exclue des deux décalages, est simplement retirée puis réinsérée.
   *
   * Position demandée : bornée à la taille de la colonne cible (carte déplacée exclue), une
   * valeur trop grande posant donc la carte en fin de colonne plutôt qu'un 400. La borne
   * `max(500)` du contrat partagé est une borne **d'entrée** (une requête absurde est refusée
   * tôt) ; la position stockée, elle, n'est pas bornée : ce n'est qu'une clé d'ordre au sein
   * d'une colonne, jamais une donnée affichée.
   *
   * Isolation : READ COMMITTED (défaut Postgres) suffit ici, sans `SELECT ... FOR UPDATE` ni
   * niveau sérialisable. Les lignes touchées appartiennent toujours à un seul utilisateur, qui
   * déplace ses cartes depuis un seul écran — la concurrence réelle se limite à deux onglets
   * du même compte. Dans ce cas extrême, deux positions peuvent se retrouver égales : le
   * Kanban les départage alors par ancienneté (`createdAt`), l'ordre affiché reste donc
   * déterministe, et la prochaine écriture (ou `reindexColumn`) referme la suite. Le prix d'un
   * verrouillage explicite de toute une colonne à chaque glisser-déposer serait sans rapport
   * avec ce risque.
   */
  async move(userId: string, id: string, input: MoveApplicationInput): Promise<ApplicationDetailDto> {
    const fromStatus = await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findFirst({
        where: { id, userId },
        select: { status: true, position: true, appliedAt: true },
      });
      if (!current) throw applicationNotFound();

      const sameColumn = current.status === input.status;
      const targetSize = await tx.application.count({
        where: { userId, status: input.status, id: { not: id } },
      });
      const target = Math.min(Math.max(input.position, 0), targetSize);

      await shiftPositionsAfterRemoval(tx, userId, current.status, current.position);
      await shiftPositionsForInsertion(tx, userId, input.status, target, id);

      const data: Prisma.ApplicationUncheckedUpdateManyInput = { position: target, status: input.status };
      if (!sameColumn && input.status !== 'TO_APPLY' && current.appliedAt === null) {
        data.appliedAt = todayUtc();
      }
      // `updateMany` filtré par `userId`, jamais un `update` par seul identifiant : une carte
      // supprimée entre-temps donnerait un `P2025` (donc un 500) au lieu du 404 attendu.
      const moved = await tx.application.updateMany({ where: { id, userId }, data });
      if (moved.count === 0) throw applicationNotFound();

      if (!sameColumn) {
        await tx.applicationEvent.create({
          data: { applicationId: id, type: 'STATUS_CHANGED', fromStatus: current.status, toStatus: input.status },
        });
      }
      return current.status;
    });

    this.logger.log(`Candidature ${id} déplacée ${fromStatus} → ${input.status} (${input.position}) user:${userId}`);
    return loadApplicationDetail(this.prisma, this.profileInputs, userId, id);
  }

  /**
   * Réparation d'une colonne : ses positions sont réécrites en `0..n-1` dans l'ordre affiché
   * (borne `REINDEX_TAKE`, cf. `lib/positions.ts`). Les écritures de `move`/`update`/`remove`
   * maintiennent déjà cet invariant — ce point d'entrée existe pour les tests et pour rattraper
   * des positions héritées d'avant cette version, jamais sur le chemin d'un déplacement.
   */
  reindexColumn(userId: string, status: ApplicationStatus): Promise<number> {
    return this.prisma.$transaction((tx) => reindexColumn(tx, userId, status));
  }
}
