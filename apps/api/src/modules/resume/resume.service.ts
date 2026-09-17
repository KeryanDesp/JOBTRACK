import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  resumeContentSchema,
  type BaseResumeDto,
  type CreateTailoredResumeInput,
  type ResumeChanges,
  type ResumeContent,
  type ResumeDto,
  type ResumeSummaryDto,
  type ResumeTemplate,
  type UpdateResumeInput,
} from '@jobtrack/shared';
import { Prisma } from '@prisma/client';
import type { ResumeVersion } from '@prisma/client';
import { stripControlChars } from '../../common/text/control-chars';
import { PrismaService } from '../../common/prisma.service';
import { parseSanitizedOrThrow } from './lib/validation';
import { RESUME_NOT_FOUND_MESSAGE } from './resume.errors';
import { ResumeSourceService } from './resume-source.service';
import { ResumeTailoringService } from './resume-tailoring.service';

const VALIDATION_ERROR_MESSAGE = 'Certains éléments ne font pas partie de votre profil.';
const RESUME_CONFLICT_MESSAGE = 'Ce CV a été modifié entre-temps. Réessayez.';

/** CV vide mais valide (spec tâche 5) : renvoyé par `GET /resume/base` quand le compte n'a — cas
 * défensif, en pratique jamais atteint puisqu'un profil est toujours créé à l'inscription
 * (`AuthService.register`) — aucun profil du tout (`ResumeSourceService.loadBase` renvoie
 * `null`). Une fonction, jamais un littéral partagé entre appels (revue sécurité, tâche 5) : un
 * futur appelant qui muterait le document reçu (identité, tableaux) ne doit jamais affecter les
 * autres requêtes. Jamais `resumeContentSchema.parse(...)` : `firstName`/`lastName` vides
 * violeraient le schéma (`.min(1)`), qui ne borne que ce qui est *enregistré*, pas ce document de
 * repli affiché tel quel.
 */
function buildEmptyResumeContent(): ResumeContent {
  return {
    schemaVersion: 1,
    identity: { firstName: '', lastName: '', title: null },
    summary: '',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
  };
}

type ResumeWithJob = Prisma.ResumeGetPayload<{ include: { job: { select: { title: true; company: true } } } }>;

/** Retire les caractères de contrôle/bidi d'un champ affiché sur une seule ligne (identité,
 * intitulés, puces, noms) — jamais de saut de ligne, même s'il y en avait un dans la source. */
function stripLine(value: string): string {
  return stripControlChars(value);
}

/** Même nettoyage, en conservant les sauts de ligne (résumé, description source d'expérience,
 * description de projet) — des champs multi-paragraphes plutôt qu'une seule ligne affichée. */
function stripMultiline(value: string): string {
  return stripControlChars(value, { keepNewlines: true });
}

/**
 * Nettoie chaque champ textuel du document de CV (spec §8 : « textes nettoyés (caractères de
 * contrôle/bidi) ») avant enregistrement d'une version `USER` — jamais les identifiants, dates,
 * URLs, catégories/niveaux (énumérations), déjà contraints par `resumeContentSchema`.
 */
function sanitizeResumeContent(content: ResumeContent): ResumeContent {
  return {
    ...content,
    identity: {
      ...content.identity,
      firstName: stripLine(content.identity.firstName),
      lastName: stripLine(content.identity.lastName),
      title: content.identity.title === null ? null : stripLine(content.identity.title),
      ...(content.identity.email !== undefined && { email: stripLine(content.identity.email) }),
      ...(content.identity.phone !== undefined && { phone: stripLine(content.identity.phone) }),
      ...(content.identity.city !== undefined && { city: stripLine(content.identity.city) }),
      ...(content.identity.country !== undefined && { country: stripLine(content.identity.country) }),
      ...(content.identity.links !== undefined && {
        links: content.identity.links.map((link) => ({ ...link, label: stripLine(link.label) })),
      }),
    },
    summary: stripMultiline(content.summary),
    experiences: content.experiences.map((experience) => ({
      ...experience,
      company: stripLine(experience.company),
      role: stripLine(experience.role),
      location: experience.location === null ? null : stripLine(experience.location),
      highlights: experience.highlights.map(stripLine),
      sourceDescription: experience.sourceDescription === null ? null : stripMultiline(experience.sourceDescription),
    })),
    educations: content.educations.map((education) => ({
      ...education,
      school: stripLine(education.school),
      degree: stripLine(education.degree),
      field: education.field === null ? null : stripLine(education.field),
    })),
    skills: content.skills.map((skill) => ({ ...skill, name: stripLine(skill.name) })),
    languages: content.languages.map((language) => ({ ...language, name: stripLine(language.name) })),
    certifications: content.certifications.map((certification) => ({
      ...certification,
      name: stripLine(certification.name),
      issuer: stripLine(certification.issuer),
    })),
    projects: content.projects.map((project) => ({
      ...project,
      name: stripLine(project.name),
      description: project.description === null ? null : stripMultiline(project.description),
      technologies: project.technologies.map(stripLine),
    })),
  };
}

/**
 * Services de persistance du CV adapté (spec §3/§6, tâche 5) : `ResumeService` orchestre
 * `ResumeSourceService` (CV de base) et `ResumeTailoringService` (adaptation IA), aucun des deux
 * ne connaissant Prisma au-delà de leur propre lecture — l'écriture des `Resume`/`ResumeVersion`
 * est entièrement ici.
 */
@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumeSource: ResumeSourceService,
    private readonly tailoring: ResumeTailoringService,
  ) {}

  /** CV principal dérivé du profil (spec §6 : `GET /resume/base`). */
  async getBase(userId: string): Promise<BaseResumeDto> {
    const [base, user] = await Promise.all([
      this.resumeSource.loadBase(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { resumeTemplate: true } }),
    ]);
    const template: ResumeTemplate = user?.resumeTemplate ?? 'CLASSIC';

    if (!base) return { content: buildEmptyResumeContent(), template, profileComplete: false };
    return { content: base.content, template, profileComplete: base.complete };
  }

  /** Modèle préféré pour le CV principal (spec §6 : `PATCH /resume/template`). */
  async setTemplate(userId: string, template: ResumeTemplate): Promise<BaseResumeDto> {
    await this.prisma.user.update({ where: { id: userId }, data: { resumeTemplate: template } });
    return this.getBase(userId);
  }

  /** CV adaptés de l'utilisateur, plus récents d'abord (spec §6 : `GET /resume`). */
  async list(userId: string): Promise<ResumeSummaryDto[]> {
    const rows = await this.prisma.resume.findMany({
      where: { userId },
      include: { job: { select: { title: true, company: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.toSummaryDto(row));
  }

  /**
   * Adapte le CV de base à l'offre (spec §5/§6) puis enregistre `Resume` + version 1 `AI` en une
   * transaction : toute erreur de `ResumeTailoringService.tailor` (profil incomplet, offre
   * introuvable, IA non configurée/indisponible, sortie inexploitable, adaptation déjà en cours,
   * budget épuisé) se propage avant toute écriture — le contrôleur la mappe vers son code HTTP.
   * `get` (revue, pas de DTO dupliqué ici) relit ensuite le CV créé — même requête que
   * `GET /resume/:id`, jamais une reconstruction manuelle divergente.
   */
  async createTailored(userId: string, input: CreateTailoredResumeInput): Promise<ResumeDto> {
    const result = await this.tailoring.tailor(userId, input.jobId);

    const resume = await this.prisma.$transaction(async (tx) => {
      const created = await tx.resume.create({
        data: { userId, title: result.title, jobId: input.jobId, template: input.template, currentVersion: 1 },
      });
      await tx.resumeVersion.create({
        data: {
          resumeId: created.id,
          version: 1,
          content: result.content,
          changes: result.changes,
          source: 'AI',
          model: result.model,
          promptVersion: result.promptVersion,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      });
      return created;
    });

    return this.get(userId, resume.id);
  }

  /** Détail d'un CV adapté (spec §6 : `GET /resume/:id`) : contenu de la version courante et
   * `changes` de la dernière version `AI` (la seule qui en porte — une version `USER` a toujours
   * `changes: null`, mais l'utilisateur doit continuer à voir l'avant/après d'origine) lus par
   * deux requêtes ciblées (revue perf) — jamais `include: { versions: true }`, qui chargerait le
   * contenu JSON complet de chaque version pour n'en garder que deux. */
  async get(userId: string, id: string): Promise<ResumeDto> {
    const resume = await this.prisma.resume.findFirst({
      where: { id, userId },
      include: { job: { select: { title: true, company: true } } },
    });
    if (!resume) throw this.notFound();

    const [current, latestAiVersion] = await Promise.all([
      this.prisma.resumeVersion.findUnique({
        where: { resumeId_version: { resumeId: id, version: resume.currentVersion } },
      }),
      this.prisma.resumeVersion.findFirst({ where: { resumeId: id, source: 'AI' }, orderBy: { version: 'desc' } }),
    ]);
    if (!current) throw this.notFound();

    return {
      ...this.toSummaryDto(resume),
      content: current.content as unknown as ResumeContent,
      changes: latestAiVersion ? (latestAiVersion.changes as unknown as ResumeChanges) : null,
      version: this.toVersionInfoDto(current),
    };
  }

  /**
   * Nouvelle version `USER` (spec §6/§8 : `PATCH /resume/:id`) : identifiants d'expérience/
   * formation/certification/projet/compétence/langue vérifiés comme appartenant au profil courant
   * de l'utilisateur (sinon 400 `VALIDATION_ERROR`), textes nettoyés puis revalidés (400 plutôt
   * qu'une `ZodError` brute si le nettoyage réduit un champ requis à une chaîne vide, revue
   * sécurité tâche 5). `currentVersion` incrémenté et la version `USER` créée dans la même
   * transaction, atomiquement (`increment`, jamais une lecture préalable de `currentVersion` hors
   * transaction — deux `PATCH` concurrents liraient alors la même valeur de départ et l'un des
   * deux échouerait en 500 sur la contrainte unique `(resumeId, version)`) ; l'écriture reste
   * filtrée par `userId` (`updateMany`, jamais un `update` par seul `id`) pour ne jamais modifier
   * le CV d'un autre utilisateur. `P2002` (contrainte unique) intercepté par précaution (« ceinture
   * et bretelles ») en 409 `RESUME_CONFLICT`, jamais un 500 — en pratique jamais atteint, le
   * verrou de ligne posé par `updateMany` sérialisant déjà les écritures concurrentes.
   */
  async update(userId: string, id: string, input: UpdateResumeInput): Promise<ResumeDto> {
    const exists = await this.prisma.resume.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exists) throw this.notFound();

    await this.assertContentIdsBelongToProfile(userId, input.content);
    const sanitized = parseSanitizedOrThrow(resumeContentSchema, sanitizeResumeContent(input.content));

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.resume.updateMany({
          where: { id, userId },
          data: { currentVersion: { increment: 1 }, ...(input.template ? { template: input.template } : {}) },
        });
        if (updated.count === 0) throw this.notFound();

        const resume = await tx.resume.findUniqueOrThrow({ where: { id }, select: { currentVersion: true } });

        await tx.resumeVersion.create({
          data: { resumeId: id, version: resume.currentVersion, content: sanitized, source: 'USER' },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'RESUME_CONFLICT', message: RESUME_CONFLICT_MESSAGE });
      }
      throw error;
    }

    return this.get(userId, id);
  }

  /** Suppression d'un CV adapté (versions en cascade, spec §3/§8 : `DELETE /resume/:id`) — 404
   * plutôt que 204 sur une seconde suppression (aucune ligne effacée), jamais un 403 (isolation
   * par `userId`, spec §6). */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.resume.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw this.notFound();
  }

  /** Vérifie que chaque identifiant d'expérience/formation/certification/projet/compétence/langue
   * du contenu envoyé appartient bien au profil de l'utilisateur au moment de la sauvegarde (spec
   * §8) — étendu aux compétences et langues (revue, tâche 5) pour la même raison que les quatre
   * autres collections : l'IA (adaptation) comme l'utilisateur (`PATCH`) ne peuvent que réordonner
   * des identifiants déjà connus du profil, jamais en proposer de nouveaux dans ce document. */
  private async assertContentIdsBelongToProfile(userId: string, content: ResumeContent): Promise<void> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        experiences: { select: { id: true } },
        educations: { select: { id: true } },
        certifications: { select: { id: true } },
        projects: { select: { id: true } },
        skills: { select: { id: true } },
        languages: { select: { id: true } },
      },
    });

    const experienceIds = new Set(profile?.experiences.map((row) => row.id) ?? []);
    const educationIds = new Set(profile?.educations.map((row) => row.id) ?? []);
    const certificationIds = new Set(profile?.certifications.map((row) => row.id) ?? []);
    const projectIds = new Set(profile?.projects.map((row) => row.id) ?? []);
    const skillIds = new Set(profile?.skills.map((row) => row.id) ?? []);
    const languageIds = new Set(profile?.languages.map((row) => row.id) ?? []);

    const details: Record<string, string> = {};
    content.experiences.forEach((experience, index) => {
      if (!experienceIds.has(experience.id)) {
        details[`content.experiences[${index}].id`] = "Cette expérience ne fait pas partie de votre profil.";
      }
    });
    content.educations.forEach((education, index) => {
      if (!educationIds.has(education.id)) {
        details[`content.educations[${index}].id`] = 'Cette formation ne fait pas partie de votre profil.';
      }
    });
    content.certifications.forEach((certification, index) => {
      if (!certificationIds.has(certification.id)) {
        details[`content.certifications[${index}].id`] = 'Cette certification ne fait pas partie de votre profil.';
      }
    });
    content.projects.forEach((project, index) => {
      if (!projectIds.has(project.id)) {
        details[`content.projects[${index}].id`] = 'Ce projet ne fait pas partie de votre profil.';
      }
    });
    content.skills.forEach((skill, index) => {
      if (!skillIds.has(skill.id)) {
        details[`content.skills[${index}].id`] = 'Cette compétence ne fait pas partie de votre profil.';
      }
    });
    content.languages.forEach((language, index) => {
      if (!languageIds.has(language.id)) {
        details[`content.languages[${index}].id`] = 'Cette langue ne fait pas partie de votre profil.';
      }
    });

    if (Object.keys(details).length > 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: VALIDATION_ERROR_MESSAGE, details });
    }
  }

  private toSummaryDto(row: ResumeWithJob): ResumeSummaryDto {
    return {
      id: row.id,
      title: row.title,
      jobId: row.jobId,
      jobTitle: row.job?.title ?? null,
      company: row.job?.company ?? null,
      template: row.template,
      currentVersion: row.currentVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toVersionInfoDto(version: ResumeVersion): ResumeDto['version'] {
    return {
      number: version.version,
      source: version.source,
      model: version.model,
      promptVersion: version.promptVersion,
      createdAt: version.createdAt.toISOString(),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'RESUME_NOT_FOUND', message: RESUME_NOT_FOUND_MESSAGE });
  }
}
