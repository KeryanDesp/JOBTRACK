import type { Prisma } from '@prisma/client';
import type { ApplicationStatus } from '@jobtrack/shared';

/**
 * Positions des cartes du Kanban (spec §5/§6) : une suite `0..n-1` par utilisateur **et** par
 * colonne, maintenue par des écritures **ensemblistes**.
 *
 * Pourquoi du SQL brut plutôt qu'une boucle Prisma : réindexer une colonne carte par carte,
 * c'est une requête par ligne dans une transaction interactive — sur une colonne de 200
 * cartes, 200 allers-retours à tenir sous les 5 s du délai de transaction (P2028) et autant
 * de lignes verrouillées pendant tout ce temps. Les trois ordres ci-dessous font le même
 * travail en **une** requête chacun, sans jamais charger les lignes côté Node.
 *
 * Les valeurs sont toujours passées en paramètres (`${...}` d'un gabarit `$executeRaw`,
 * jamais une concaténation) ; le statut, colonne de type énuméré Postgres, reçoit un transtypage
 * explicite (`::"ApplicationStatus"`), un paramètre étant envoyé comme texte.
 *
 * Note : ces écritures ne touchent pas `updatedAt` (colonne `@updatedAt`, gérée par Prisma) —
 * c'est voulu, réordonner une colonne ne « modifie » aucune des cartes voisines, et la vue
 * table triée par dernière mise à jour ne doit pas être bouleversée par un simple glisser-déposer.
 */

/** Réindexation de réparation : bornée, jamais un scan complet d'une colonne dégénérée. */
export const REINDEX_TAKE = 1000;

/**
 * Retrait d'une carte d'une colonne : toutes celles qui la suivaient remontent d'un cran.
 * Appelée au déplacement (colonne source), au changement de statut depuis la fiche/la table et
 * à la suppression — sans elle, chaque départ laisserait un trou dans la suite des positions.
 */
export function shiftPositionsAfterRemoval(
  tx: Prisma.TransactionClient,
  userId: string,
  status: ApplicationStatus,
  position: number,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Application"
    SET "position" = "position" - 1
    WHERE "userId" = ${userId} AND "status" = ${status}::"ApplicationStatus" AND "position" > ${position}
  `;
}

/**
 * Insertion d'une carte à `position` dans une colonne : toutes celles à partir de cette
 * position descendent d'un cran. La carte déplacée est exclue (`id <> $4`) — elle est encore
 * dans la colonne quand le déplacement se fait à l'intérieur de celle-ci, et ne doit jamais se
 * décaler elle-même.
 */
export function shiftPositionsForInsertion(
  tx: Prisma.TransactionClient,
  userId: string,
  status: ApplicationStatus,
  position: number,
  excludeId: string,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Application"
    SET "position" = "position" + 1
    WHERE "userId" = ${userId}
      AND "status" = ${status}::"ApplicationStatus"
      AND "position" >= ${position}
      AND "id" <> ${excludeId}
  `;
}

/**
 * Réparation d'une colonne : les `REINDEX_TAKE` premières cartes (ordre d'affichage du Kanban,
 * `position` puis ancienneté) reçoivent les positions `0..n-1`. Les écritures ci-dessus
 * conservent déjà l'invariant ; ce helper n'existe que pour le rattraper si des positions
 * héritées d'avant (ou une écriture concurrente très improbable sous READ COMMITTED) le
 * violaient. Une seule requête, et seules les lignes réellement décalées sont écrites
 * (`WHERE a."position" <> r.rn`).
 */
export function reindexColumn(
  tx: Prisma.TransactionClient,
  userId: string,
  status: ApplicationStatus,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Application" AS a
    SET "position" = r.rn
    FROM (
      SELECT "id", (row_number() OVER (ORDER BY "position" ASC, "createdAt" ASC) - 1)::int AS rn
      FROM "Application"
      WHERE "userId" = ${userId} AND "status" = ${status}::"ApplicationStatus"
      ORDER BY "position" ASC, "createdAt" ASC
      LIMIT ${REINDEX_TAKE}
    ) AS r
    WHERE a."id" = r."id" AND a."position" <> r.rn
  `;
}
