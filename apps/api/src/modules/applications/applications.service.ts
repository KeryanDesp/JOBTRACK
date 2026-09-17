import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPLICATION_STATUSES,
  applicationTabToStatus,
  isCreateFromJob,
  type ApplicationBoardDto,
  type ApplicationDetailDto,
  type ApplicationListQuery,
  type ApplicationListResponseDto,
  type ApplicationStatsDto,
  type ApplicationStatus,
  type CreateApplicationInput,
  type MoveApplicationInput,
  type UpdateApplicationInput,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { ProfileInputsService } from '../matching/profile-inputs.service';
import { ApplicationsBoardService } from './applications-board.service';
import {
  applicationExists,
  applicationNotFound,
  cvExclusivityError,
  jobNotFound,
  letterNotFound,
  resumeNotFound,
} from './applications.errors';
import { parseIsoDate, startOfWeekUtc, todayUtc } from './lib/dates';
import { APPLICATION_INCLUDE, toApplicationDto } from './lib/dto';
import { shiftPositionsAfterRemoval } from './lib/positions';
import { buildOrderBy, escapeLikePattern } from './lib/query';
import { loadApplicationDetail } from './lib/read';
import {
  boundedOptionalText,
  boundedText,
  formatSalarySnapshot,
  isDisplayableHttpUrl,
  pickSourceUrl,
  snapshotFromInput,
  MAX_COMPANY,
  MAX_CONTRACT_LABEL,
  MAX_JOB_TITLE,
  MAX_LOCATION_LABEL,
  MAX_NOTES,
  MAX_SALARY_LABEL,
  NOTES_OPTIONS,
  type ApplicationSnapshot,
} from './lib/snapshot';

const EMPTY_BY_STATUS: Record<ApplicationStatus, number> = {
  TO_APPLY: 0,
  APPLIED: 0,
  INTERVIEW: 0,
  OFFER: 0,
  REJECTED: 0,
};

/**
 * Suivi des candidatures (spec §5/§6, tranche 6) : CRUD strictement filtré par `userId`
 * (jamais un `update`/`delete` par seul identifiant), instantané figé de l'offre à la
 * création, et historique (`ApplicationEvent`) écrit dans la même transaction que la
 * modification qui le justifie. Le Kanban et les déplacements de cartes vivent dans
 * `ApplicationsBoardService`, à qui les deux routes correspondantes sont simplement
 * transmises — le contrôleur ne connaît qu'un service.
 *
 * Journaux : identifiants et statuts seulement — jamais une note, un titre de poste ni un nom
 * d'entreprise (spec §5/§8).
 */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileInputs: ProfileInputsService,
    private readonly boardService: ApplicationsBoardService,
  ) {}

  /** Vue table (spec §6) : onglet → statut, recherche insensible à la casse sur le poste et
   * l'entreprise (l'instantané, jamais l'offre vivante — une candidature peut lui survivre),
   * tri et pagination. */
  async list(userId: string, query: ApplicationListQuery): Promise<ApplicationListResponseDto> {
    const where = this.buildWhere(userId, query);

    const [rows, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: APPLICATION_INCLUDE,
        orderBy: buildOrderBy(query.sort),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.application.count({ where }),
    ]);

    // `job.match` reste `null` sur la liste : la table n'affiche pas le score (spec §2), et le
    // lire coûterait une lecture de profil + une jointure `MatchScore` par page. Le Kanban
    // (`board`) et la fiche (`get`), qui l'affichent, le renseignent.
    return {
      items: rows.map((row) => toApplicationDto(userId, row, null)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /**
   * Compteurs de la barre de filtres et du futur tableau de bord (spec §4/§6).
   * `interviewRate` = (entretiens + offres) / (envoyées + entretiens + offres + refusées),
   * arrondi à deux décimales, `null` quand aucune candidature n'a été envoyée (dénominateur
   * nul) : les candidatures encore « À postuler » ne comptent dans aucun des deux termes.
   */
  async stats(userId: string, now: Date = new Date()): Promise<ApplicationStatsDto> {
    const [grouped, appliedThisWeek] = await Promise.all([
      this.prisma.application.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      this.prisma.application.count({ where: { userId, appliedAt: { gte: startOfWeekUtc(now) } } }),
    ]);

    const byStatus: Record<ApplicationStatus, number> = { ...EMPTY_BY_STATUS };
    for (const row of grouped) byStatus[row.status] = row._count._all;

    const total = APPLICATION_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
    const positive = byStatus.INTERVIEW + byStatus.OFFER;
    const answered = byStatus.APPLIED + byStatus.INTERVIEW + byStatus.OFFER + byStatus.REJECTED;
    const interviewRate = answered === 0 ? null : Math.round((positive / answered) * 100) / 100;

    return { total, byStatus, appliedThisWeek, interviewRate };
  }

  /** Kanban (spec §6) — `ApplicationsBoardService`. */
  board(userId: string): Promise<ApplicationBoardDto> {
    return this.boardService.board(userId);
  }

  /** Déplacement d'une carte du Kanban (spec §6) — `ApplicationsBoardService`. */
  move(userId: string, id: string, input: MoveApplicationInput): Promise<ApplicationDetailDto> {
    return this.boardService.move(userId, id, input);
  }

  /**
   * Création depuis une offre ou manuelle (spec §5/§6). Instantané pris ici une fois pour
   * toutes ; `CREATED` écrit dans la même transaction que la candidature — un historique
   * commence toujours par sa création, jamais une candidature sans premier évènement.
   */
  async create(userId: string, input: CreateApplicationInput): Promise<ApplicationDetailDto> {
    const resumeId = input.resumeId ?? null;
    const coverLetterId = isCreateFromJob(input) ? (input.coverLetterId ?? null) : null;
    this.assertCvExclusivity(input.usedBaseResume, resumeId);
    await this.assertOwnedDocuments(userId, resumeId, coverLetterId);

    const snapshot = isCreateFromJob(input) ? await this.snapshotFromJob(input.jobId) : snapshotFromInput(input);

    const status = input.status;
    // `appliedAt` explicite s'il est fourni, sinon le jour courant dès que le statut initial
    // n'est plus « À postuler » (spec §5) — une candidature déjà envoyée porte toujours une date.
    const appliedAt =
      input.appliedAt != null ? parseIsoDate(input.appliedAt) : status === 'TO_APPLY' ? null : todayUtc();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Comptage **dans** la transaction : la position d'ajout est lue et écrite d'un seul
        // tenant. Le décalage que permettait un comptage antérieur restait cosmétique (le
        // Kanban départage deux positions égales par ancienneté), mais rien ne justifie de
        // laisser une lecture hors transaction décider d'une écriture.
        const position = await tx.application.count({ where: { userId, status } });
        const row = await tx.application.create({
          data: {
            userId,
            ...snapshot,
            status,
            position,
            appliedAt,
            resumeId,
            coverLetterId,
            usedBaseResume: input.usedBaseResume,
          },
          select: { id: true, status: true },
        });
        await tx.applicationEvent.create({
          data: { applicationId: row.id, type: 'CREATED', toStatus: row.status },
        });
        return row;
      });

      this.logger.log(`Candidature créée ${created.id} (${created.status}) user:${userId}`);
      return this.get(userId, created.id);
    } catch (error) {
      throw await this.toCreateError(userId, input, error);
    }
  }

  /** Fiche de détail (spec §6). */
  get(userId: string, id: string): Promise<ApplicationDetailDto> {
    return loadApplicationDetail(this.prisma, this.profileInputs, userId, id);
  }

  /**
   * Modification de la fiche (spec §6) : écriture filtrée par `userId` (`updateMany`, jamais
   * un `update` par seul identifiant) et évènements d'historique écrits dans la même
   * transaction. Un changement de statut depuis la fiche ou la table ajoute la carte **en fin**
   * de la colonne cible — seul `move` (Kanban) choisit une position précise — et referme la
   * colonne d'origine derrière elle, pour que ses positions restent une suite sans trou.
   */
  async update(userId: string, id: string, input: UpdateApplicationInput): Promise<ApplicationDetailDto> {
    const current = await this.prisma.application.findFirst({ where: { id, userId } });
    if (!current) throw applicationNotFound();

    this.assertCvExclusivity(input.usedBaseResume, input.resumeId ?? null);
    await this.assertOwnedDocuments(userId, input.resumeId ?? null, input.coverLetterId ?? null);

    const data: Prisma.ApplicationUncheckedUpdateManyInput = {};
    const events: Prisma.ApplicationEventCreateManyInput[] = [];

    const nextStatus = input.status ?? current.status;
    const statusChanged = nextStatus !== current.status;
    if (statusChanged) {
      data.status = nextStatus;
      events.push({ applicationId: id, type: 'STATUS_CHANGED', fromStatus: current.status, toStatus: nextStatus });
    }

    if (input.appliedAt !== undefined) {
      data.appliedAt = input.appliedAt === null ? null : parseIsoDate(input.appliedAt);
    } else if (statusChanged && nextStatus !== 'TO_APPLY' && current.appliedAt === null) {
      // Premier passage hors « À postuler » sans date saisie (spec §5).
      data.appliedAt = todayUtc();
    }

    this.applyCvChange(current, input, data, events);
    this.applyNotesChange(current, input, data, events);
    this.applySnapshotChanges(input, data);

    await this.prisma.$transaction(async (tx) => {
      // Position de fin de colonne cible comptée dans la transaction, comme à la création.
      if (statusChanged) data.position = await tx.application.count({ where: { userId, status: nextStatus } });
      const updated = await tx.application.updateMany({ where: { id, userId }, data });
      if (updated.count === 0) throw applicationNotFound();
      // La carte a quitté sa colonne : les suivantes remontent d'un cran (écriture ensembliste,
      // une seule requête quelle que soit la taille de la colonne).
      if (statusChanged) await shiftPositionsAfterRemoval(tx, userId, current.status, current.position);
      if (events.length > 0) await tx.applicationEvent.createMany({ data: events });
    });

    if (statusChanged) {
      this.logger.log(`Candidature ${id} : ${current.status} → ${nextStatus} user:${userId}`);
    }
    return this.get(userId, id);
  }

  /** Suppression (évènements en cascade, spec §5) : 404 plutôt que 204 sur une seconde
   * suppression, et jamais un 403 sur la candidature d'un autre utilisateur. La colonne se
   * referme derrière la carte, comme pour un déplacement. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findFirst({
        where: { id, userId },
        select: { status: true, position: true },
      });
      if (!current) throw applicationNotFound();

      const deleted = await tx.application.deleteMany({ where: { id, userId } });
      if (deleted.count === 0) throw applicationNotFound();
      await shiftPositionsAfterRemoval(tx, userId, current.status, current.position);
    });
    this.logger.log(`Candidature supprimée ${id} user:${userId}`);
  }

  // -------------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------------

  private buildWhere(userId: string, query: ApplicationListQuery): Prisma.ApplicationWhereInput {
    const where: Prisma.ApplicationWhereInput = { userId };

    const status = applicationTabToStatus(query.tab);
    if (status !== null) where.status = status;

    const q = query.q?.trim() ?? '';
    if (q !== '') {
      const escaped = escapeLikePattern(q);
      where.OR = [
        { jobTitle: { contains: escaped, mode: 'insensitive' } },
        { company: { contains: escaped, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /** Instantané depuis une offre du catalogue (spec §5). */
  private async snapshotFromJob(jobId: string): Promise<ApplicationSnapshot> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        company: true,
        locationLabel: true,
        salaryLabel: true,
        salaryMinAnnual: true,
        salaryMaxAnnual: true,
        currency: true,
        contractLabel: true,
        sources: { select: { applyUrl: true, url: true }, orderBy: { publishedAt: 'desc' } },
      },
    });
    if (!job) throw jobNotFound();

    return {
      jobId: job.id,
      jobTitle: boundedText(job.title, MAX_JOB_TITLE),
      company: boundedOptionalText(job.company, MAX_COMPANY),
      locationLabel: boundedOptionalText(job.locationLabel, MAX_LOCATION_LABEL),
      salaryLabel:
        boundedOptionalText(job.salaryLabel, MAX_SALARY_LABEL) ??
        boundedOptionalText(
          formatSalarySnapshot(job.salaryMinAnnual, job.salaryMaxAnnual, job.currency),
          MAX_SALARY_LABEL,
        ),
      contractLabel: boundedOptionalText(job.contractLabel, MAX_CONTRACT_LABEL),
      // Seule source branchée aujourd'hui (spec §5) ; une candidature créée manuellement porte
      // la source choisie par l'utilisateur.
      source: 'FRANCE_TRAVAIL',
      sourceUrl: pickSourceUrl(job.sources),
      // Aucune note à la création depuis une offre : le formulaire court n'en propose pas.
      notes: null,
    };
  }

  /**
   * Traduit l'échec d'une création. `P2002` sur `(userId, jobId)` = une candidature existe
   * déjà pour cette offre : elle est relue pour que le web puisse l'ouvrir (spec §5). Toute
   * autre erreur est propagée telle quelle.
   */
  private async toCreateError(userId: string, input: CreateApplicationInput, error: unknown): Promise<unknown> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return error;
    if (!isCreateFromJob(input)) return error;

    const existing = await this.prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId: input.jobId } },
      select: { id: true },
    });
    // Sans ligne retrouvée (course : la candidature concurrente vient d'être supprimée), on
    // renvoie l'erreur d'origine plutôt qu'un 409 qui désignerait une fiche inexistante.
    return existing ? applicationExists(existing.id) : error;
  }

  /** « CV principal » (`usedBaseResume`) et CV adapté (`resumeId`) sont exclusifs (spec §4). */
  private assertCvExclusivity(usedBaseResume: boolean | undefined, resumeId: string | null): void {
    if (usedBaseResume === true && resumeId !== null) throw cvExclusivityError();
  }

  /** CV adapté et lettre référencés : toujours ceux de l'utilisateur (404 sinon, spec §5). */
  private async assertOwnedDocuments(
    userId: string,
    resumeId: string | null,
    coverLetterId: string | null,
  ): Promise<void> {
    if (resumeId !== null) {
      const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId }, select: { id: true } });
      if (!resume) throw resumeNotFound();
    }
    if (coverLetterId !== null) {
      const letter = await this.prisma.coverLetter.findFirst({
        where: { id: coverLetterId, userId },
        select: { id: true },
      });
      if (!letter) throw letterNotFound();
    }
  }

  /**
   * CV utilisé (`PATCH`) : l'invariant « CV principal **ou** CV adapté » est maintenu sur
   * l'état **résultant**, pas seulement sur le corps reçu. Choisir le CV principal libère donc
   * le CV adapté enregistré, et choisir un CV adapté décoche le CV principal — plutôt qu'un 400
   * sur une combinaison que l'utilisateur n'a pas envoyée. Le 400 reste levé si le corps lui-même
   * demande les deux (`assertCvExclusivity`).
   */
  private applyCvChange(
    current: { id: string; resumeId: string | null; usedBaseResume: boolean },
    input: UpdateApplicationInput,
    data: Prisma.ApplicationUncheckedUpdateManyInput,
    events: Prisma.ApplicationEventCreateManyInput[],
  ): void {
    if (input.resumeId === undefined && input.usedBaseResume === undefined) return;

    const nextUsedBaseResume = input.usedBaseResume ?? (input.resumeId != null ? false : current.usedBaseResume);
    const nextResumeId =
      input.resumeId !== undefined ? input.resumeId : nextUsedBaseResume ? null : current.resumeId;
    if (nextUsedBaseResume && nextResumeId !== null) throw cvExclusivityError();

    if (nextResumeId === current.resumeId && nextUsedBaseResume === current.usedBaseResume) return;

    data.resumeId = nextResumeId;
    data.usedBaseResume = nextUsedBaseResume;
    events.push({ applicationId: current.id, type: 'RESUME_CHANGED' });
  }

  private applyNotesChange(
    current: { id: string; notes: string | null },
    input: UpdateApplicationInput,
    data: Prisma.ApplicationUncheckedUpdateManyInput,
    events: Prisma.ApplicationEventCreateManyInput[],
  ): void {
    if (input.notes === undefined) return;
    const nextNotes = boundedOptionalText(input.notes, MAX_NOTES, NOTES_OPTIONS);
    if (nextNotes === current.notes) return;
    data.notes = nextNotes;
    // Jamais le contenu de la note dans l'historique (spec §5/§8) : seul le fait qu'elle a
    // changé est journalisé, la note courante étant lue sur la fiche.
    events.push({ applicationId: current.id, type: 'NOTE_UPDATED' });
  }

  /** Champs d'instantané éditables à la main (spec §4), plus la lettre associée : nettoyés et
   * bornés comme à la création. La lettre ne donne pas d'évènement d'historique — les quatre
   * types du contrat (`CREATED`, `STATUS_CHANGED`, `NOTE_UPDATED`, `RESUME_CHANGED`) n'en
   * prévoient pas, et la fiche affiche toujours la lettre courante. */
  private applySnapshotChanges(
    input: UpdateApplicationInput,
    data: Prisma.ApplicationUncheckedUpdateManyInput,
  ): void {
    if (input.jobTitle !== undefined) data.jobTitle = boundedText(input.jobTitle, MAX_JOB_TITLE);
    if (input.company !== undefined) data.company = boundedOptionalText(input.company, MAX_COMPANY);
    if (input.locationLabel !== undefined) {
      data.locationLabel = boundedOptionalText(input.locationLabel, MAX_LOCATION_LABEL);
    }
    if (input.salaryLabel !== undefined) data.salaryLabel = boundedOptionalText(input.salaryLabel, MAX_SALARY_LABEL);
    if (input.contractLabel !== undefined) {
      data.contractLabel = boundedOptionalText(input.contractLabel, MAX_CONTRACT_LABEL);
    }
    if (input.coverLetterId !== undefined) data.coverLetterId = input.coverLetterId;
    if (input.source !== undefined) data.source = input.source;
    if (input.sourceUrl !== undefined) {
      data.sourceUrl = isDisplayableHttpUrl(input.sourceUrl) ? input.sourceUrl : null;
    }
  }
}
