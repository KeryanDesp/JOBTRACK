import { Injectable } from '@nestjs/common';
import { buildBaseResume, type ResumeContent, type ResumeSourceProfile } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * CV de base résolu depuis le profil (spec §4/§5) : `content` (coordonnées
 * incluses, CV principal affiché à l'utilisateur) et `aiContent` (coordonnées
 * retirées — spec §5/§8, seule variante jamais envoyée au modèle). Les deux
 * partagent les mêmes identifiants (`experiences[].id`, etc.) que le profil,
 * nécessaires à l'ancrage et à la sélection par id de l'adaptation IA.
 */
export interface ResumeBase {
  profileId: string;
  content: ResumeContent;
  aiContent: ResumeContent;
  /** Au moins une expérience ou une compétence : sinon rien d'exploitable à adapter (spec §5). */
  complete: boolean;
  email: string;
}

/** `Date` (colonne `@db.Date`) → `'AAAA-MM-JJ'`, comme `toApi` (`profile/collection.service.ts`) —
 * dupliqué ici plutôt qu'importé : `toApi` opère sur `CollectionRow` (index signature générique),
 * incompatible sans cast avec les types Prisma nommés (`Experience`, `Education`…) que Prisma
 * renvoie ici via `include`. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoDateOrNull(date: Date | null): string | null {
  return date === null ? null : toIsoDate(date);
}

/**
 * Résout et construit le CV de base d'un utilisateur (spec §4/§5) : lecture du profil (+ ses six
 * collections et l'email du compte, `User.email` — absent du profil) en une seule requête,
 * conversion des dates `@db.Date` en chaînes `AAAA-MM-JJ`, puis `buildBaseResume` (fonction pure,
 * partagée web/API). Utilisé par `ResumeTailoringService`/`CoverLetterService` (entrée IA) et par
 * la route `GET /resume/base` (`ResumeService.getBase`).
 */
@Injectable()
export class ResumeSourceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Une seule requête (revue, tâche 4) : `Profile.user` (relation inverse) porte l'email du
   * compte, pas besoin d'un aller-retour séparé sur `User` avant de savoir si le profil existe. */
  async loadBase(userId: string): Promise<ResumeBase | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        user: { select: { email: true } },
        experiences: { orderBy: { sortOrder: 'asc' } },
        educations: { orderBy: { sortOrder: 'asc' } },
        skills: { orderBy: { sortOrder: 'asc' } },
        languages: { orderBy: { sortOrder: 'asc' } },
        certifications: { orderBy: { sortOrder: 'asc' } },
        projects: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!profile) return null;

    const source: ResumeSourceProfile = {
      firstName: profile.firstName,
      lastName: profile.lastName,
      title: profile.title,
      summary: profile.summary,
      email: profile.user.email,
      phone: profile.phone,
      city: profile.city,
      country: profile.country,
      experiences: profile.experiences.map((row) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        company: row.company,
        role: row.role,
        location: row.location,
        startDate: toIsoDate(row.startDate),
        endDate: toIsoDateOrNull(row.endDate),
        isCurrent: row.isCurrent,
        description: row.description,
      })),
      educations: profile.educations.map((row) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        school: row.school,
        degree: row.degree,
        field: row.field,
        startDate: toIsoDate(row.startDate),
        endDate: toIsoDateOrNull(row.endDate),
        description: row.description,
      })),
      skills: profile.skills.map((row) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        name: row.name,
        category: row.category,
        level: row.level,
      })),
      languages: profile.languages.map((row) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        name: row.name,
        level: row.level,
      })),
      certifications: profile.certifications.map((row) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        name: row.name,
        issuer: row.issuer,
        issuedAt: toIsoDate(row.issuedAt),
        expiresAt: toIsoDateOrNull(row.expiresAt),
        credentialUrl: row.credentialUrl,
      })),
      projects: profile.projects.map((row) => ({
        id: row.id,
        sortOrder: row.sortOrder,
        name: row.name,
        description: row.description,
        url: row.url,
        technologies: row.technologies,
      })),
    };

    return {
      profileId: profile.id,
      content: buildBaseResume(source, { includeContact: true }),
      aiContent: buildBaseResume(source, { includeContact: false }),
      complete: source.experiences.length > 0 || source.skills.length > 0,
      email: profile.user.email,
    };
  }
}
