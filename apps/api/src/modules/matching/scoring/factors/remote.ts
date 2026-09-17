import type { RemoteMode } from '@prisma/client';
import { REMOTE_MODE_LABELS, type JobRequirements, type MatchFactorDto, type RequirementRemoteMode } from '@jobtrack/shared';
import type { JobInputs, ProfileInputs } from '../types';
import { evaluatedFactor, unknownFactor } from './support';

/** Mode de télétravail de l'analyse (`onsite`/`hybrid`/`remote`, spec §4) vers l'énumération Prisma partagée avec le profil. */
const REQUIREMENT_TO_PRISMA: Record<RequirementRemoteMode, RemoteMode> = {
  onsite: 'ONSITE',
  hybrid: 'HYBRID',
  remote: 'REMOTE',
};

/**
 * Facteur Télétravail (poids 5, spec §5) : mode de télétravail explicite de
 * l'analyse, sinon celui déduit par l'ingestion (tranche 3, alors annoté dans
 * l'évidence), comparé aux modes acceptés par le profil. `unknown` si ni
 * l'analyse ni l'offre n'indiquent de mode, ou si le profil n'a exprimé
 * aucune préférence de télétravail — l'absence de préférence n'est jamais
 * créditée d'un score de 100 par défaut (rien à comparer dans les deux cas).
 */
export function scoreRemote(profile: ProfileInputs, job: JobInputs, requirements: JobRequirements, _now: Date): MatchFactorDto {
  const explicit = requirements.remoteMode;
  const effective: RemoteMode | null = explicit !== null ? REQUIREMENT_TO_PRISMA[explicit] : job.remoteMode;

  if (effective === null) {
    return unknownFactor('remote', "Le mode de télétravail n'est pas précisé.");
  }
  if (profile.remoteModes.length === 0) {
    return unknownFactor('remote', "Vous n'avez pas indiqué de préférence de télétravail.");
  }

  const label = REMOTE_MODE_LABELS[effective];
  const inferredNote = explicit === null && job.remoteModeInferred ? ' (déduit de l\'annonce)' : '';
  const compatible = profile.remoteModes.includes(effective);

  if (compatible) {
    return evaluatedFactor('remote', 100, [
      { kind: 'ok', text: `${label} mentionné dans l'annonce${inferredNote}, compatible avec vos préférences.` },
    ]);
  }
  return evaluatedFactor('remote', 30, [
    { kind: 'warn', text: `${label} mentionné dans l'annonce${inferredNote}, incompatible avec vos préférences.` },
  ]);
}
