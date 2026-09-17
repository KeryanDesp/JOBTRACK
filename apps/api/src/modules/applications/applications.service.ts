import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPLICATION_STATUSES,
  applicationTabToStatus,
  isCreateFromJob,
  type ApplicationBoardDto,
  type ApplicationDetailDto,
  type ApplicationDto,
  type ApplicationEventDto,
  type ApplicationListQuery,
  type ApplicationListResponseDto,
  type ApplicationSort,
  type ApplicationSource,
  type ApplicationStatsDto,
  type ApplicationStatus,
  type CreateApplicationInput,
  type CreateManualInput,
  type MatchScoreSummaryDto,
  type MoveApplicationInput,
  type UpdateApplicationInput,
} from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { stripControlChars, type StripControlCharsOptions } from '../../common/text/control-chars';
import { toMatchSummary } from '../jobs/jobs.service';
import { JOB_ANALYSIS_VERSION } from '../matching/job-analysis.prompt';
import { ProfileInputsService } from '../matching/profile-inputs.service';
import {
  applicationExists,
  applicationNotFound,
  cvExclusivityError,
  jobNotFound,
  letterNotFound,
  resumeNotFound,
} from './applications.errors';

/** Cartes chargées par colonne du Kanban (spec §6 : « 200 cartes max par colonne »). */
const BOARD_COLUMN_TAKE = 200;
/** Évènements renvoyés par la fiche de détail, les plus récents d'abord (l'historique d'une
 * candidature est court par nature ; la borne évite qu'une fiche très ancienne devienne
 * lourde à charger). */
const EVENT_TAKE = 100;

// Bornes du contrat partagé (`applications.ts`) appliquées aussi à l'instantané pris depuis
// une offre : le titre d'une offre France Travail peut dépasser `jobTitle` (160), et un DTO
// renvoyé doit toujours rester dans les bornes que le `PATCH` accepterait ensuite.
const MAX_JOB_TITLE = 160;
const MAX_COMPANY = 120;
const MAX_LOCATION_LABEL = 120;
const MAX_SALARY_LABEL = 80;
const MAX_CONTRACT_LABEL = 80;
const MAX_NOTES = 4000;
const MAX_SOURCE_URL = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Les notes sont le seul champ multi-paragraphes d'une candidature : leurs sauts de ligne
 * sont conservés, les autres caractères de contrôle retirés comme ailleurs. */
const NOTES_OPTIONS: StripControlCharsOptions = { keepNewlines: true };

const EMPTY_BY_STATUS: Record<ApplicationStatus, number> = {
  TO_APPLY: 0,
  APPLIED: 0,
  INTERVIEW: 0,
  OFFER: 0,
  REJECTED: 0,
};

/** Relations exposées par `ApplicationDto` : l'offre (catalogue partagé), le CV adapté et la
 * lettre (tous deux personnels — `userId` sélectionné pour ne jamais rendre la référence d'un
 * autre utilisateur, spec §8). */
const APPLICATION_INCLUDE = {
  job: { select: { id: true, title: true, company: true } },
  resume: { select: { id: true, title: true, currentVersion: true, userId: true } },
  coverLetter: { select: { id: true, tone: true, userId: true } },
} satisfies Prisma.ApplicationInclude;

type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;
type ApplicationEventRow = Prisma.ApplicationEventGetPayload<Record<string, never>>;

/** Instantané figé à la création (spec §5) : jamais mis à jour ensuite, l'offre pouvant
 * expirer ou disparaître du catalogue. */
interface ApplicationSnapshot {
  jobId: string | null;
  jobTitle: string;
  company: string | null;
  locationLabel: string | null;
  salaryLabel: string | null;
  contractLabel: string | null;
  source: ApplicationSource;
  sourceUrl: string | null;
  notes: string | null;
}

/** Date calendaire `AAAA-MM-JJ` (jamais d'heure : `appliedAt` est un jour, spec §4). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `AAAA-MM-JJ` → minuit UTC. Le format est déjà validé par `isoDateSchema` (contrat partagé). */
function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Minuit UTC du jour courant : valeur de `appliedAt` posée automatiquement (spec §5). */
function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Lundi 00:00 de la semaine courante, calculé **en UTC** à partir de la date du jour
 * (`appliedThisWeek`, spec §4). Choix documenté : `appliedAt` est un jour stocké à minuit UTC,
 * jamais un instant — comparer en UTC compare donc deux jours entre eux, sans décalage de
 * fuseau ni surprise au changement d'heure. La semaine commence le lundi (usage français) :
 * `getUTCDay()` renvoie 0 pour dimanche, d'où le `+ 6 % 7`.
 */
function startOfWeekUtc(now: Date = new Date()): Date {
  const today = todayUtc(now);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - daysSinceMonday * MS_PER_DAY);
}

/** Texte d'une candidature : caractères de contrôle/bidi retirés (helper commun de l'API,
 * déjà utilisé par l'import de CV et les offres), espaces extérieurs coupés, borne appliquée
 * (spec §5). Le contrat partagé applique déjà ce nettoyage aux corps de requête ; le service
 * le refait pour ses propres entrées (instantané d'une offre, appel direct du service) —
 * jamais de texte non nettoyé écrit en base. `keepNewlines` pour les seules notes, un champ
 * multi-lignes ; tous les autres restent sur une seule ligne affichée. */
function sanitizeText(value: string, max: number, options: StripControlCharsOptions = {}): string {
  return stripControlChars(value, options).trim().slice(0, max);
}

/** Même nettoyage, une chaîne vide (ou absente) devenant `null` : une colonne optionnelle ne
 * porte jamais `''`, qui s'afficherait comme une valeur présente mais vide. */
function sanitizeOptionalText(
  value: string | null | undefined,
  max: number,
  options: StripControlCharsOptions = {},
): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = sanitizeText(value, max, options);
  return cleaned === '' ? null : cleaned;
}

/**
 * Neutralise les métacaractères LIKE/ILIKE (`%`, `_`, `\`) avant un `contains` Prisma — même
 * précaution que `JobsService.buildWhere` : sans elle, `q=%` redeviendrait le joker « tout »
 * plutôt qu'une recherche littérale.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Lien externe affichable (spec §5) : `http(s)` uniquement, borné — un `javascript:`/`data:`
 * n'est jamais enregistré, même issu d'une source. */
function isDisplayableHttpUrl(value: string | null | undefined): value is string {
  if (value === null || value === undefined || value.length > MAX_SOURCE_URL) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Lien de candidature de l'offre : le premier `applyUrl` exploitable, sinon le premier `url`
 * (spec §5), les sources étant fournies de la plus récente à la plus ancienne. */
function pickSourceUrl(sources: ReadonlyArray<{ applyUrl: string | null; url: string }>): string | null {
  for (const source of sources) {
    if (isDisplayableHttpUrl(source.applyUrl)) return source.applyUrl;
  }
  for (const source of sources) {
    if (isDisplayableHttpUrl(source.url)) return source.url;
  }
  return null;
}

/**
 * Salaire de l'instantané : le libellé de l'offre quand elle en porte un, sinon une fourchette
 * reconstruite côté serveur à partir des bornes annuelles — et seulement si les **deux** sont
 * connues (spec §5 : une borne seule ne fait pas une fourchette, la candidature affiche alors
 * « — »).
 */
function formatSalarySnapshot(minAnnual: number | null, maxAnnual: number | null): string | null {
  if (minAnnual === null || maxAnnual === null) return null;
  return `${minAnnual}–${maxAnnual} € brut/an`;
}

function toEventDto(row: ApplicationEventRow): ApplicationEventDto {
  return {
    id: row.id,
    type: row.type,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Tri de la vue table (spec §4/§6). `nulls: 'last'` sur les colonnes optionnelles : une
 * candidature sans date de candidature (« À postuler ») ou sans entreprise ne doit jamais
 * occuper le haut de la liste. Un second critère stable (`updatedAt`, puis `id`) évite qu'une
 * page 2 réordonne des ex æquo déjà affichés en page 1.
 */
function buildOrderBy(sort: ApplicationSort): Prisma.ApplicationOrderByWithRelationInput[] {
  switch (sort) {
    case 'applied_desc':
      return [{ appliedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'desc' }];
    case 'company_asc':
      return [{ company: { sort: 'asc', nulls: 'last' } }, { jobTitle: 'asc' }, { id: 'desc' }];
    case 'updated_desc':
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }
}

/**
 * Suivi des candidatures (spec §5/§6, tranche 6) : CRUD strictement filtré par `userId`
 * (jamais un `update`/`delete` par seul identifiant), instantané figé de l'offre à la
 * création, historique (`ApplicationEvent`) écrit dans la même transaction que la
 * modification qui le justifie, et réindexation transactionnelle des colonnes du Kanban.
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
      items: rows.map((row) => this.toDto(userId, row, null)),
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
    const matches = await this.loadMatchSummaries(
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
      columns[status] = (perStatus[index] ?? []).map((row) => this.toDto(userId, row, this.matchOf(matches, row)));
    });

    return { columns };
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

    const snapshot = isCreateFromJob(input)
      ? await this.snapshotFromJob(input.jobId)
      : this.snapshotFromInput(input);

    const status = input.status;
    // `appliedAt` explicite s'il est fourni, sinon le jour courant dès que le statut initial
    // n'est plus « À postuler » (spec §5) — une candidature déjà envoyée porte toujours une date.
    const appliedAt =
      input.appliedAt != null ? parseIsoDate(input.appliedAt) : status === 'TO_APPLY' ? null : todayUtc();
    // Ajout en fin de colonne : la nouvelle carte apparaît sous les existantes du Kanban.
    const position = await this.prisma.application.count({ where: { userId, status } });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
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

  /** Fiche de détail (spec §6) : historique antéchronologique, référence d'offre (avec le
   * score de correspondance de CET utilisateur, `null` s'il n'en a pas), CV et lettre. */
  async get(userId: string, id: string): Promise<ApplicationDetailDto> {
    const row = await this.prisma.application.findFirst({ where: { id, userId }, include: APPLICATION_INCLUDE });
    if (!row) throw applicationNotFound();

    const [events, matches] = await Promise.all([
      this.prisma.applicationEvent.findMany({
        where: { applicationId: row.id },
        // `id` en second critère : deux évènements écrits dans la même transaction (changement
        // de statut + notes) partagent la même milliseconde, leur ordre doit rester stable.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EVENT_TAKE,
      }),
      this.loadMatchSummaries(userId, row.jobId === null ? [] : [row.jobId]),
    ]);

    return { ...this.toDto(userId, row, this.matchOf(matches, row)), events: events.map(toEventDto) };
  }

  /**
   * Modification de la fiche (spec §6) : écriture filtrée par `userId` (`updateMany`, jamais
   * un `update` par seul identifiant) et évènements d'historique écrits dans la même
   * transaction. Un changement de statut depuis la fiche ou la table ajoute la carte **en fin**
   * de la colonne cible — seul `move` (Kanban) choisit une position précise.
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
      data.position = await this.prisma.application.count({ where: { userId, status: nextStatus } });
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
      const updated = await tx.application.updateMany({ where: { id, userId }, data });
      if (updated.count === 0) throw applicationNotFound();
      if (events.length > 0) await tx.applicationEvent.createMany({ data: events });
    });

    if (statusChanged) {
      this.logger.log(`Candidature ${id} : ${current.status} → ${nextStatus} user:${userId}`);
    }
    return this.get(userId, id);
  }

  /**
   * Déplacement Kanban (spec §5/§6) : tout se joue dans une seule transaction — retrait de la
   * colonne source (réindexée `0..n-1`), insertion à la position demandée (bornée à la taille
   * de la colonne cible), réindexation `0..n-1` de la cible. Les positions restent donc
   * toujours une suite continue sans trou ni doublon, quelle que soit la valeur envoyée.
   */
  async move(userId: string, id: string, input: MoveApplicationInput): Promise<ApplicationDetailDto> {
    const fromStatus = await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findFirst({
        where: { id, userId },
        select: { id: true, status: true, appliedAt: true },
      });
      if (!current) throw applicationNotFound();

      const sameColumn = current.status === input.status;
      const orderBy: Prisma.ApplicationOrderByWithRelationInput[] = [{ position: 'asc' }, { createdAt: 'asc' }];
      // La carte déplacée est toujours retirée des deux listes avant réinsertion : elle n'y
      // apparaît jamais deux fois, même dans un déplacement à l'intérieur de sa colonne.
      const sourceIds = await tx.application
        .findMany({ where: { userId, status: current.status, id: { not: id } }, orderBy, select: { id: true } })
        .then((rows) => rows.map((row) => row.id));
      const targetIds = sameColumn
        ? sourceIds
        : await tx.application
            .findMany({ where: { userId, status: input.status, id: { not: id } }, orderBy, select: { id: true } })
            .then((rows) => rows.map((row) => row.id));

      const index = Math.min(Math.max(input.position, 0), targetIds.length);
      const ordered = [...targetIds];
      ordered.splice(index, 0, id);

      if (!sameColumn) {
        for (const [position, rowId] of sourceIds.entries()) {
          await tx.application.update({ where: { id: rowId }, data: { position } });
        }
      }
      for (const [position, rowId] of ordered.entries()) {
        if (rowId === id) continue;
        await tx.application.update({ where: { id: rowId }, data: { position } });
      }

      const movedData: Prisma.ApplicationUncheckedUpdateInput = {
        position: ordered.indexOf(id),
        status: input.status,
      };
      if (!sameColumn && input.status !== 'TO_APPLY' && current.appliedAt === null) {
        movedData.appliedAt = todayUtc();
      }
      await tx.application.update({ where: { id }, data: movedData });

      if (!sameColumn) {
        await tx.applicationEvent.create({
          data: { applicationId: id, type: 'STATUS_CHANGED', fromStatus: current.status, toStatus: input.status },
        });
      }
      return current.status;
    });

    this.logger.log(`Candidature ${id} déplacée ${fromStatus} → ${input.status} (${input.position}) user:${userId}`);
    return this.get(userId, id);
  }

  /** Suppression (évènements en cascade, spec §5) : 404 plutôt que 204 sur une seconde
   * suppression, et jamais un 403 sur la candidature d'un autre utilisateur. */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.application.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw applicationNotFound();
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
        contractLabel: true,
        sources: { select: { applyUrl: true, url: true }, orderBy: { publishedAt: 'desc' } },
      },
    });
    if (!job) throw jobNotFound();

    return {
      jobId: job.id,
      jobTitle: sanitizeText(job.title, MAX_JOB_TITLE),
      company: sanitizeOptionalText(job.company, MAX_COMPANY),
      locationLabel: sanitizeOptionalText(job.locationLabel, MAX_LOCATION_LABEL),
      salaryLabel:
        sanitizeOptionalText(job.salaryLabel, MAX_SALARY_LABEL) ??
        sanitizeOptionalText(formatSalarySnapshot(job.salaryMinAnnual, job.salaryMaxAnnual), MAX_SALARY_LABEL),
      contractLabel: sanitizeOptionalText(job.contractLabel, MAX_CONTRACT_LABEL),
      // Seule source branchée aujourd'hui (spec §5) ; une candidature créée manuellement porte
      // la source choisie par l'utilisateur.
      source: 'FRANCE_TRAVAIL',
      sourceUrl: pickSourceUrl(job.sources),
      // Aucune note à la création depuis une offre : le formulaire court n'en propose pas.
      notes: null,
    };
  }

  /** Candidature saisie à la main (spec §2) : les champs tels que fournis, nettoyés et bornés. */
  private snapshotFromInput(input: CreateManualInput): ApplicationSnapshot {
    return {
      jobId: null,
      jobTitle: sanitizeText(input.jobTitle, MAX_JOB_TITLE),
      company: sanitizeOptionalText(input.company, MAX_COMPANY),
      locationLabel: sanitizeOptionalText(input.locationLabel, MAX_LOCATION_LABEL),
      salaryLabel: sanitizeOptionalText(input.salaryLabel, MAX_SALARY_LABEL),
      contractLabel: sanitizeOptionalText(input.contractLabel, MAX_CONTRACT_LABEL),
      source: input.source,
      sourceUrl: isDisplayableHttpUrl(input.sourceUrl) ? input.sourceUrl : null,
      notes: sanitizeOptionalText(input.notes, MAX_NOTES, NOTES_OPTIONS),
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

    const nextUsedBaseResume =
      input.usedBaseResume ?? (input.resumeId != null ? false : current.usedBaseResume);
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
    const nextNotes = sanitizeOptionalText(input.notes, MAX_NOTES, NOTES_OPTIONS);
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
    if (input.jobTitle !== undefined) data.jobTitle = sanitizeText(input.jobTitle, MAX_JOB_TITLE);
    if (input.company !== undefined) data.company = sanitizeOptionalText(input.company, MAX_COMPANY);
    if (input.locationLabel !== undefined) {
      data.locationLabel = sanitizeOptionalText(input.locationLabel, MAX_LOCATION_LABEL);
    }
    if (input.salaryLabel !== undefined) data.salaryLabel = sanitizeOptionalText(input.salaryLabel, MAX_SALARY_LABEL);
    if (input.contractLabel !== undefined) {
      data.contractLabel = sanitizeOptionalText(input.contractLabel, MAX_CONTRACT_LABEL);
    }
    if (input.coverLetterId !== undefined) data.coverLetterId = input.coverLetterId;
    if (input.source !== undefined) data.source = input.source;
    if (input.sourceUrl !== undefined) {
      data.sourceUrl = isDisplayableHttpUrl(input.sourceUrl) ? input.sourceUrl : null;
    }
  }

  /**
   * Scores de correspondance déjà calculés pour CE profil (spec §4) : lecture seule de
   * `MatchScore`, filtrée par l'empreinte courante du profil et la version d'analyse — comme
   * `JobsService`, une simple consultation ne recalcule jamais de score (`POST /jobs/analyses`
   * et `GET /jobs/:id/match` sont les seules routes qui le font).
   */
  private async loadMatchSummaries(
    userId: string,
    jobIds: readonly string[],
  ): Promise<Map<string, MatchScoreSummaryDto>> {
    const unique = [...new Set(jobIds)];
    const summaries = new Map<string, MatchScoreSummaryDto>();
    if (unique.length === 0) return summaries;

    const profile = await this.profileInputs.build(userId);
    if (!profile || !profile.complete) return summaries;

    const rows = await this.prisma.matchScore.findMany({
      where: {
        profileId: profile.profileId,
        profileFingerprint: profile.fingerprint,
        analysisVersion: JOB_ANALYSIS_VERSION,
        jobId: { in: unique },
      },
      select: { jobId: true, score: true, band: true, priority: true, factors: true },
    });
    for (const row of rows) {
      const summary = toMatchSummary(row);
      if (summary) summaries.set(row.jobId, summary);
    }
    return summaries;
  }

  private matchOf(
    summaries: Map<string, MatchScoreSummaryDto>,
    row: { jobId: string | null },
  ): MatchScoreSummaryDto | null {
    return row.jobId === null ? null : (summaries.get(row.jobId) ?? null);
  }

  private toDto(userId: string, row: ApplicationRow, match: MatchScoreSummaryDto | null): ApplicationDto {
    return {
      id: row.id,
      jobId: row.jobId,
      status: row.status,
      position: row.position,
      jobTitle: row.jobTitle,
      company: row.company,
      locationLabel: row.locationLabel,
      salaryLabel: row.salaryLabel,
      contractLabel: row.contractLabel,
      source: row.source,
      sourceUrl: row.sourceUrl,
      appliedAt: row.appliedAt === null ? null : toIsoDate(row.appliedAt),
      usedBaseResume: row.usedBaseResume,
      resumeId: row.resumeId,
      coverLetterId: row.coverLetterId,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      job: row.job ? { id: row.job.id, title: row.job.title, company: row.job.company, match } : null,
      // Filet défensif (spec §8) : un CV ou une lettre qui ne serait pas de cet utilisateur
      // n'est jamais exposé — en pratique impossible, les écritures vérifiant la propriété.
      resume:
        row.resume && row.resume.userId === userId
          ? { id: row.resume.id, title: row.resume.title, currentVersion: row.resume.currentVersion }
          : null,
      coverLetter:
        row.coverLetter && row.coverLetter.userId === userId
          ? { id: row.coverLetter.id, tone: row.coverLetter.tone }
          : null,
    };
  }
}
