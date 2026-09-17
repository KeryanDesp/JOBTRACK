import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { ResumeSourceService } from './resume-source.service';
import { ResumeTailoringService } from './resume-tailoring.service';

const RESUME_NOT_FOUND_MESSAGE = 'CV introuvable.';
const VALIDATION_ERROR_MESSAGE = 'Certains éléments ne font pas partie de votre profil.';

/** CV vide mais valide (spec tâche 5) : renvoyé par `GET /resume/base` quand le compte n'a — cas
 * défensif, en pratique jamais atteint puisqu'un profil est toujours créé à l'inscription
 * (`AuthService.register`) — aucun profil du tout (`ResumeSourceService.loadBase` renvoie
 * `null`). Un littéral, jamais `resumeContentSchema.parse(...)` : `firstName`/`lastName` vides
 * violeraient le schéma (`.min(1)`), qui ne borne que ce qui est *enregistré*, pas ce document de
 * repli affiché tel quel.
 */
const EMPTY_RESUME_CONTENT: ResumeContent = {
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

type ResumeWithJob = Prisma.ResumeGetPayload<{ include: { job: { select: { title: true; company: true } } } }>;
type ResumeWithJobAndVersions = Prisma.ResumeGetPayload<{
  include: { job: { select: { title: true; company: true } }; versions: true };
}>;

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

    if (!base) return { content: EMPTY_RESUME_CONTENT, template, profileComplete: false };
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
   * introuvable, IA non configurée/indisponible, sortie inexploitable, adaptation déjà en cours)
   * se propage avant toute écriture — le contrôleur la mappe vers son code HTTP.
   */
  async createTailored(userId: string, input: CreateTailoredResumeInput): Promise<ResumeDto> {
    const result = await this.tailoring.tailor(userId, input.jobId);

    const job = await this.prisma.job.findUnique({ where: { id: input.jobId }, select: { title: true, company: true } });

    const { resume, version } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.resume.create({
        data: { userId, title: result.title, jobId: input.jobId, template: input.template, currentVersion: 1 },
      });
      const createdVersion = await tx.resumeVersion.create({
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
      return { resume: created, version: createdVersion };
    });

    return {
      id: resume.id,
      title: resume.title,
      jobId: resume.jobId,
      jobTitle: job?.title ?? null,
      company: job?.company ?? null,
      template: resume.template,
      currentVersion: resume.currentVersion,
      createdAt: resume.createdAt.toISOString(),
      updatedAt: resume.updatedAt.toISOString(),
      content: result.content,
      changes: result.changes,
      version: this.toVersionInfoDto(version),
    };
  }

  /** Détail d'un CV adapté (spec §6 : `GET /resume/:id`) : contenu de la version courante,
   * `changes` de la dernière version `AI` (la seule qui en porte — une version `USER` a toujours
   * `changes: null`, mais l'utilisateur doit continuer à voir l'avant/après d'origine). */
  async get(userId: string, id: string): Promise<ResumeDto> {
    const resume = await this.prisma.resume.findFirst({
      where: { id, userId },
      include: { job: { select: { title: true, company: true } }, versions: true },
    });
    if (!resume) throw this.notFound();
    return this.toDto(resume);
  }

  /**
   * Nouvelle version `USER` (spec §6/§8 : `PATCH /resume/:id`) : identifiants d'expérience/
   * formation/certification/projet vérifiés comme appartenant au profil courant de l'utilisateur
   * (sinon 400 `VALIDATION_ERROR`), textes nettoyés, `currentVersion` incrémenté et modèle mis à
   * jour si fourni — en une transaction.
   */
  async update(userId: string, id: string, input: UpdateResumeInput): Promise<ResumeDto> {
    const resume = await this.prisma.resume.findFirst({ where: { id, userId }, select: { id: true, currentVersion: true } });
    if (!resume) throw this.notFound();

    await this.assertContentIdsBelongToProfile(userId, input.content);
    const sanitized = resumeContentSchema.parse(sanitizeResumeContent(input.content));
    const nextVersion = resume.currentVersion + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.resumeVersion.create({
        data: {
          resumeId: id,
          version: nextVersion,
          content: sanitized,
          changes: Prisma.JsonNull,
          source: 'USER',
        },
      });
      await tx.resume.update({
        where: { id },
        data: { currentVersion: nextVersion, ...(input.template ? { template: input.template } : {}) },
      });
    });

    return this.get(userId, id);
  }

  /** Suppression d'un CV adapté (versions en cascade, spec §3/§8 : `DELETE /resume/:id`) — 404
   * plutôt que 204 sur une seconde suppression (aucune ligne effacée), jamais un 403 (isolation
   * par `userId`, spec §6). */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.resume.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw this.notFound();
  }

  /** Vérifie que chaque identifiant d'expérience/formation/certification/projet du contenu envoyé
   * appartient bien au profil de l'utilisateur au moment de la sauvegarde (spec §8) — jamais les
   * compétences ni les langues, dont l'IA ne peut que réordonner les identifiants déjà connus du
   * profil, jamais en proposer de nouveaux dans ce document. */
  private async assertContentIdsBelongToProfile(userId: string, content: ResumeContent): Promise<void> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        experiences: { select: { id: true } },
        educations: { select: { id: true } },
        certifications: { select: { id: true } },
        projects: { select: { id: true } },
      },
    });

    const experienceIds = new Set(profile?.experiences.map((row) => row.id) ?? []);
    const educationIds = new Set(profile?.educations.map((row) => row.id) ?? []);
    const certificationIds = new Set(profile?.certifications.map((row) => row.id) ?? []);
    const projectIds = new Set(profile?.projects.map((row) => row.id) ?? []);

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

  private toDto(resume: ResumeWithJobAndVersions): ResumeDto {
    const current = resume.versions.find((version) => version.version === resume.currentVersion);
    if (!current) throw this.notFound();

    const latestAiVersion = resume.versions
      .filter((version) => version.source === 'AI')
      .sort((a, b) => b.version - a.version)[0];

    return {
      ...this.toSummaryDto(resume),
      content: current.content as unknown as ResumeContent,
      changes: latestAiVersion ? (latestAiVersion.changes as unknown as ResumeChanges) : null,
      version: this.toVersionInfoDto(current),
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
