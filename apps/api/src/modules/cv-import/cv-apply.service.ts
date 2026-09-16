import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CvApplyInput, CvApplyResult } from '@jobtrack/shared';
import { PrismaService } from '../../common/prisma.service';
import { toDb, type CollectionDelegate, type CollectionName } from '../profile/collection.service';

/**
 * Résout le délégué Prisma d'une collection depuis le client **transactionnel**.
 * Réplique volontairement `delegateOf` de `collection.service.ts` (non exporté par ce
 * module — cf. tâche 5) : même surface minimale (`CollectionDelegate`, exportée, elle),
 * même unique cast. Toujours `tx`, jamais `this.prisma` directement : c'est ce qui
 * garantit qu'un identifiant étranger annule bien toute l'application, pas seulement
 * la partie déjà exécutée.
 */
function delegateOf(tx: Prisma.TransactionClient, name: CollectionName): CollectionDelegate {
  return tx[name] as unknown as CollectionDelegate;
}

interface SelectableEntry<T extends Record<string, unknown>> {
  selected: boolean;
  item: T;
}

/** Union insensible à la casse et aux espaces, ordre de première apparition conservé, plafonnée à 10. */
function mergeUnique(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of [...existing, ...additions]) {
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (trimmed === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length === 10) break;
  }
  return result;
}

/**
 * Applique le contenu validé d'un import de CV (`cvApplySchema`) au profil de
 * l'utilisateur : identité, six collections, préférences — en une seule transaction.
 * Un identifiant étranger dans n'importe quel bloc, ou un import déjà appliqué / pas
 * encore prêt, annule l'ensemble (aucune écriture partielle).
 */
@Injectable()
export class CvApplyService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(userId: string, importId: string, input: CvApplyInput): Promise<CvApplyResult> {
    return this.prisma.$transaction(async (tx) => {
      // Première écriture de la transaction, et conditionnée à `status: 'EXTRACTED'` : sous
      // Postgres, deux applications concurrentes du même import se sérialisent sur le verrou
      // de cette ligne — la première à commiter gagne (`count === 1`), la seconde retombe sur
      // `count === 0` (le `WHERE` ne correspond plus, le statut a déjà changé) et se rabat sur
      // une erreur, sans jamais créer les collections deux fois.
      const claim = await tx.cvImport.updateMany({
        where: { id: importId, userId, status: 'EXTRACTED' },
        data: { status: 'APPLIED', appliedAt: new Date() },
      });
      if (claim.count === 0) throw await this.rejectClaim(tx, importId, userId);

      const profile = await tx.profile.findUnique({ where: { userId }, select: { id: true } });
      // En pratique toujours présent (créé à l'inscription) : jamais qu'une garde défensive.
      if (!profile) throw this.notFound();
      const profileId = profile.id;

      await tx.profile.update({ where: { id: profileId }, data: input.identity });

      const created: CvApplyResult['created'] = {
        experiences: await this.createSelected(tx, 'experience', ['startDate', 'endDate'], profileId, input.experiences),
        educations: await this.createSelected(tx, 'education', ['startDate', 'endDate'], profileId, input.educations),
        skills: await this.createSelected(tx, 'skill', [], profileId, input.skills),
        languages: await this.createSelected(tx, 'language', [], profileId, input.languages),
        certifications: await this.createSelected(
          tx,
          'certification',
          ['issuedAt', 'expiresAt'],
          profileId,
          input.certifications,
        ),
        projects: await this.createSelected(tx, 'project', [], profileId, input.projects),
      };

      await this.mergePreferences(tx, profileId, input.preferences);

      return { created };
    });
  }

  /** Le `claim` n'a rien pris : relit la ligne pour choisir la bonne erreur (404 / conflit). */
  private async rejectClaim(
    tx: Prisma.TransactionClient,
    importId: string,
    userId: string,
  ): Promise<NotFoundException | ConflictException> {
    const existing = await tx.cvImport.findUnique({ where: { id: importId }, select: { userId: true, status: true } });
    if (!existing || existing.userId !== userId) return this.notFound();
    if (existing.status === 'APPLIED') return this.conflict('ALREADY_APPLIED', 'Ce CV a déjà été appliqué au profil.');
    return this.conflict('IMPORT_NOT_READY', "Ce CV n'est pas encore prêt à être appliqué.");
  }

  /**
   * Crée les entrées sélectionnées d'une collection, à la suite des existantes
   * (`sortOrder` = compte existant + index dans la sélection). Les entrées non
   * sélectionnées (`selected: false`) sont silencieusement ignorées.
   */
  private async createSelected<T extends Record<string, unknown>>(
    tx: Prisma.TransactionClient,
    name: CollectionName,
    dateFields: readonly string[],
    profileId: string,
    entries: readonly SelectableEntry<T>[],
  ): Promise<number> {
    const items = entries.filter((entry) => entry.selected).map((entry) => entry.item);
    if (items.length === 0) return 0;

    const delegate = delegateOf(tx, name);
    const existingCount = await delegate.count({ where: { profileId } });
    for (const [index, item] of items.entries()) {
      await delegate.create({ data: { ...toDb(item, dateFields), profileId, sortOrder: existingCount + index } });
    }
    return items.length;
  }

  /** Clé absente (`undefined`) = inchangée ; clé présente = union avec l'existant (jamais un remplacement). */
  private async mergePreferences(
    tx: Prisma.TransactionClient,
    profileId: string,
    input: CvApplyInput['preferences'],
  ): Promise<void> {
    if (input.desiredRoles === undefined && input.locations === undefined) return;

    const existing = await tx.jobPreferences.findUnique({ where: { profileId } });
    const patch: { desiredRoles?: string[]; locations?: string[] } = {};
    if (input.desiredRoles !== undefined) {
      patch.desiredRoles = mergeUnique(existing?.desiredRoles ?? [], input.desiredRoles);
    }
    if (input.locations !== undefined) {
      patch.locations = mergeUnique(existing?.locations ?? [], input.locations);
    }

    await tx.jobPreferences.upsert({ where: { profileId }, create: { profileId, ...patch }, update: patch });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import de CV introuvable.' });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
