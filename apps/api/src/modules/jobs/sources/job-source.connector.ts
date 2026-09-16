import type { JobSourceKind } from '@prisma/client';
import type { FranceTravailOffer } from './france-travail/france-travail.schemas';

/**
 * Requête générique adressée à une source d'offres. Les connecteurs mappent
 * ces champs vers leurs propres paramètres (ex. France Travail : `motsCles`,
 * `commune`, `distance`…) ; le mapping vers `Job` (tranche 3, tâche 4) se fait
 * en aval, jamais dans le connecteur.
 */
export interface SourceQuery {
  keywords?: string;
  communeCode?: string;
  distanceKm?: number;
  contractCodes?: string[];
  publishedWithinDays?: number;
  maxPages?: number;
}

/**
 * Une offre brute renvoyée par une source, déjà validée par le schéma Zod du
 * connecteur (jamais `unknown`) mais pas encore normalisée en `Job`.
 */
export interface SourceOffer {
  kind: JobSourceKind;
  externalId: string;
  raw: FranceTravailOffer;
}

/** Une commune du référentiel d'une source (France Travail : ~35 000 lignes). */
export interface SourceCommune {
  code: string;
  name: string;
  postalCode: string | null;
  departmentCode: string;
}

/**
 * Interface commune à toutes les sources d'offres. France Travail est la
 * seule implémentation aujourd'hui ; les connecteurs futurs (Adzuna,
 * Jooble… — tranche 8) implémentent la même interface.
 */
export interface JobSourceConnector {
  readonly kind: JobSourceKind;
  search(query: SourceQuery): Promise<SourceOffer[]>;
  getOffer(externalId: string): Promise<SourceOffer | null>;
  listCommunes(): Promise<SourceCommune[]>;
}

/** Jeton d'injection Nest : la liste des connecteurs configurés (vide si aucun identifiant). */
export const JOB_SOURCE_CONNECTORS = Symbol('JOB_SOURCE_CONNECTORS');

/** Vrai si un connecteur du type demandé figure parmi les connecteurs configurés. */
export function isConfigured(connectors: JobSourceConnector[], kind: JobSourceKind): boolean {
  return connectors.some((connector) => connector.kind === kind);
}
