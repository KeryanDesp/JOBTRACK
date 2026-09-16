import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { ProfileService } from './profile.service';

/** Nom du modèle Prisma de la collection : sert à résoudre le délégué, jamais figé sur une instance. */
export type CollectionName = 'experience' | 'education' | 'skill' | 'language' | 'certification' | 'project';

export interface CollectionRow {
  id: string;
  sortOrder: number;
  [key: string]: unknown;
}

/**
 * Surface minimale commune aux six délégués Prisma ; on ne décrit que ce qu'on utilise.
 * Membres déclarés comme propriétés de type fonction (et non en syntaxe de méthode) :
 * une méthode d'interface est vérifiée de façon bivariante par TypeScript, ce qui masque
 * l'incompatibilité réelle avec les délégués Prisma (leurs arguments sont porteurs d'une
 * marque `SelectSubset`) et rendrait le cast `as unknown as CollectionDelegate` ci-dessous
 * faussement signalé comme superflu par `no-unnecessary-type-assertion`.
 */
export interface CollectionDelegate {
  findMany: (args: { where: { profileId: string }; orderBy: { sortOrder: 'asc' } }) => Promise<CollectionRow[]>;
  create: (args: { data: Record<string, unknown> }) => Promise<CollectionRow>;
  updateMany: (args: { where: { id: string; profileId: string }; data: Record<string, unknown> }) => Promise<{ count: number }>;
  deleteMany: (args: { where: { id: string; profileId: string } }) => Promise<{ count: number }>;
  findFirst: (args: { where: { id: string; profileId: string } }) => Promise<CollectionRow | null>;
  count: (args: { where: { profileId: string } }) => Promise<number>;
}

export interface CollectionConfig {
  name: CollectionName;
  /** Colonnes `@db.Date` : chaînes AAAA-MM-JJ côté API, `Date` côté Prisma. */
  dateFields: readonly string[];
}

type PrismaLike = PrismaService | Prisma.TransactionClient;

/**
 * Résout le délégué Prisma d'une collection à partir d'un client (normal ou transactionnel).
 * Le seul cast du module : la surface commune aux six délégués n'est pas exprimable sans lui.
 */
function delegateOf(client: PrismaLike, name: CollectionName): CollectionDelegate {
  return client[name] as unknown as CollectionDelegate;
}

/** `'2024-01-01'` → `Date` UTC minuit ; `null` reste `null` ; une clé absente reste absente. */
export function toDb(data: Record<string, unknown>, dateFields: readonly string[]): Record<string, unknown> {
  const result = { ...data };
  for (const field of dateFields) {
    const value = result[field];
    if (typeof value === 'string') result[field] = new Date(`${value}T00:00:00.000Z`);
  }
  return result;
}

/** `Date` → `'AAAA-MM-JJ'` ; `null` reste `null`. */
export function toApi(row: CollectionRow, dateFields: readonly string[]): CollectionRow {
  const result = { ...row };
  for (const field of dateFields) {
    const value = result[field];
    if (value instanceof Date) result[field] = value.toISOString().slice(0, 10);
  }
  return result;
}

@Injectable()
export class ProfileCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  async list(config: CollectionConfig, userId: string): Promise<CollectionRow[]> {
    const profileId = await this.profiles.resolveProfileId(userId);
    const rows = await delegateOf(this.prisma, config.name).findMany({
      where: { profileId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((row) => toApi(row, config.dateFields));
  }

  async create(config: CollectionConfig, userId: string, data: Record<string, unknown>): Promise<CollectionRow> {
    const profileId = await this.profiles.resolveProfileId(userId);
    // Pas de contrainte d'unicité sur (profileId, sortOrder) : un doublon après une course
    // concurrente est toléré, ce compteur n'a pas besoin d'être atomique avec la création.
    const sortOrder = await delegateOf(this.prisma, config.name).count({ where: { profileId } });
    const row = await delegateOf(this.prisma, config.name).create({
      data: { ...toDb(data, config.dateFields), profileId, sortOrder },
    });
    return toApi(row, config.dateFields);
  }

  async update(config: CollectionConfig, userId: string, id: string, data: Record<string, unknown>): Promise<CollectionRow> {
    const profileId = await this.profiles.resolveProfileId(userId);
    // Vérification d'appartenance et écriture en une seule instruction atomique.
    const { count } = await delegateOf(this.prisma, config.name).updateMany({
      where: { id, profileId },
      data: toDb(data, config.dateFields),
    });
    if (count === 0) throw this.notFound();
    const row = await delegateOf(this.prisma, config.name).findFirst({ where: { id, profileId } });
    // Impossible en pratique : updateMany vient de confirmer que la ligne existe.
    if (!row) throw this.notFound();
    return toApi(row, config.dateFields);
  }

  async remove(config: CollectionConfig, userId: string, id: string): Promise<void> {
    const profileId = await this.profiles.resolveProfileId(userId);
    const { count } = await delegateOf(this.prisma, config.name).deleteMany({ where: { id, profileId } });
    if (count === 0) throw this.notFound();
  }

  /**
   * Transaction interactive : les mises à jour passent par `tx`, le client transactionnel,
   * jamais par `this.prisma` directement — sinon l'annulation en cas d'identifiant étranger
   * ne serait qu'apparente, les écritures déjà émises resteraient commitées.
   */
  async reorder(config: CollectionConfig, userId: string, ids: string[]): Promise<void> {
    const profileId = await this.profiles.resolveProfileId(userId);
    await this.prisma.$transaction(async (tx) => {
      let updated = 0;
      for (const [index, id] of ids.entries()) {
        const { count } = await delegateOf(tx, config.name).updateMany({
          where: { id, profileId },
          data: { sortOrder: index },
        });
        updated += count;
      }
      // Un identifiant étranger, inconnu ou dupliqué : on annule tout.
      if (updated !== ids.length) throw this.notFound();
    });
  }

  private notFound(): NotFoundException {
    // 404 et jamais 403 : un 403 confirmerait que la ressource existe chez quelqu'un d'autre.
    return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Cet élément est introuvable.' });
  }
}
