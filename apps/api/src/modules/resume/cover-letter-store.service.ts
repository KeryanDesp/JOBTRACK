import { Injectable, NotFoundException } from '@nestjs/common';
import {
  coverLetterContentSchema,
  type CoverLetterContent,
  type CoverLetterDto,
  type CoverLetterSummaryDto,
  type CreateCoverLetterInput,
  type UpdateCoverLetterInput,
} from '@jobtrack/shared';
import type { Prisma } from '@prisma/client';
import { stripControlChars } from '../../common/text/control-chars';
import { PrismaService } from '../../common/prisma.service';
import { CoverLetterService } from './cover-letter.service';
import { parseSanitizedOrThrow } from './lib/validation';
import { RESUME_NOT_FOUND_MESSAGE } from './resume.errors';

const LETTER_NOT_FOUND_MESSAGE = 'Lettre introuvable.';

type LetterWithJob = Prisma.CoverLetterGetPayload<{ include: { job: { select: { title: true; company: true } } } }>;

/** Nettoie chaque champ textuel de la lettre (spec §8) — aucun identifiant, aucune énumération à
 * préserver ici (contrairement à `sanitizeResumeContent`, `resume.service.ts`) : tous les champs
 * de `coverLetterContentSchema` sont du texte libre. `paragraphs`/`subject`/`greeting`/`closing`/
 * `signature` restent affichés sur une ou quelques lignes courtes ; seul `recipient` (nom d'une
 * personne, jamais multi-ligne) suit la même règle. */
function sanitizeLetterContent(content: CoverLetterContent): CoverLetterContent {
  return {
    recipient: content.recipient === null ? null : stripControlChars(content.recipient),
    subject: stripControlChars(content.subject),
    greeting: stripControlChars(content.greeting),
    paragraphs: content.paragraphs.map((paragraph) => stripControlChars(paragraph)),
    closing: stripControlChars(content.closing),
    signature: stripControlChars(content.signature),
  };
}

/**
 * Persistance des lettres de motivation (spec §3/§6, tâche 5) : orchestre `CoverLetterService`
 * (génération IA + ancrage, tâche 4), qui ne connaît pas Prisma au-delà de sa propre lecture du
 * CV de base — l'écriture de `CoverLetter` est entièrement ici. Contrairement au CV, une lettre
 * n'est jamais versionnée (spec §3 : `CoverLetter.content` est mis à jour en place).
 */
@Injectable()
export class CoverLetterStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverLetter: CoverLetterService,
  ) {}

  /** Lettres de l'utilisateur, plus récentes d'abord (spec §6 : `GET /resume/letters`). */
  async list(userId: string): Promise<CoverLetterSummaryDto[]> {
    const rows = await this.prisma.coverLetter.findMany({
      where: { userId },
      include: { job: { select: { title: true, company: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.toSummaryDto(row));
  }

  /**
   * Génère puis enregistre une lettre (spec §5/§6 : `POST /resume/letters`) : `resumeId`, s'il est
   * fourni, doit appartenir à l'utilisateur (404 sinon, jamais un 403 — isolation par `userId`,
   * spec §6) avant même d'appeler le service IA. Toute erreur de `CoverLetterService.write` (profil
   * incomplet, offre introuvable, IA non configurée/indisponible, sortie inexploitable, génération
   * déjà en cours) se propage avant toute écriture.
   */
  async create(userId: string, input: CreateCoverLetterInput): Promise<CoverLetterDto> {
    if (input.resumeId) {
      const resume = await this.prisma.resume.findFirst({ where: { id: input.resumeId, userId }, select: { id: true } });
      if (!resume) throw new NotFoundException({ code: 'RESUME_NOT_FOUND', message: RESUME_NOT_FOUND_MESSAGE });
    }

    const result = await this.coverLetter.write(userId, input.jobId, input.tone, input.resumeId);

    const created = await this.prisma.coverLetter.create({
      data: {
        userId,
        jobId: input.jobId,
        resumeId: input.resumeId ?? null,
        tone: input.tone,
        content: result.content,
        model: result.model,
        promptVersion: result.promptVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      include: { job: { select: { title: true, company: true } } },
    });

    return this.toDto(created);
  }

  /** Détail d'une lettre (spec §6 : `GET /resume/letters/:id`). */
  async get(userId: string, id: string): Promise<CoverLetterDto> {
    const row = await this.prisma.coverLetter.findFirst({
      where: { id, userId },
      include: { job: { select: { title: true, company: true } } },
    });
    if (!row) throw this.notFound();
    return this.toDto(row);
  }

  /** Édition du contenu (spec §6/§8 : `PATCH /resume/letters/:id`) : texte nettoyé puis revalidé
   * (400 `VALIDATION_ERROR` plutôt qu'une `ZodError` brute si le nettoyage réduit un champ requis
   * à une chaîne vide — ex. `subject` composé uniquement de caractères de contrôle, revue
   * sécurité tâche 5), aucune vérification d'identifiant (la lettre n'en porte aucun issu du
   * profil, contrairement au CV). */
  async update(userId: string, id: string, input: UpdateCoverLetterInput): Promise<CoverLetterDto> {
    const row = await this.prisma.coverLetter.findFirst({ where: { id, userId }, select: { id: true } });
    if (!row) throw this.notFound();

    const sanitized = parseSanitizedOrThrow(coverLetterContentSchema, sanitizeLetterContent(input.content));

    const updated = await this.prisma.coverLetter.update({
      where: { id },
      data: { content: sanitized },
      include: { job: { select: { title: true, company: true } } },
    });
    return this.toDto(updated);
  }

  /** Suppression d'une lettre (spec §6 : `DELETE /resume/letters/:id`) — 404 plutôt que 204 sur une
   * seconde suppression, jamais un 403 (isolation par `userId`). */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.coverLetter.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw this.notFound();
  }

  private toSummaryDto(row: LetterWithJob): CoverLetterSummaryDto {
    return {
      id: row.id,
      jobId: row.jobId,
      jobTitle: row.job?.title ?? null,
      company: row.job?.company ?? null,
      resumeId: row.resumeId,
      tone: row.tone,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDto(row: LetterWithJob): CoverLetterDto {
    return { ...this.toSummaryDto(row), content: row.content as unknown as CoverLetterContent };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'LETTER_NOT_FOUND', message: LETTER_NOT_FOUND_MESSAGE });
  }
}
