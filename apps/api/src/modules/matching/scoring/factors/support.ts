import { FACTOR_LABELS, FACTOR_WEIGHTS, type FactorKey, type MatchEvidenceDto, type MatchFactorDto } from '@jobtrack/shared';

/**
 * Construit un facteur `evaluated` : centralise le poids et le libellé
 * (`FACTOR_WEIGHTS`/`FACTOR_LABELS`, spec §5) pour que chaque fichier de
 * facteur ne porte que sa règle de score et son évidence.
 */
export function evaluatedFactor(key: FactorKey, score: number, evidence: MatchEvidenceDto[]): MatchFactorDto {
  return { key, label: FACTOR_LABELS[key], weight: FACTOR_WEIGHTS[key], score, status: 'evaluated', evidence };
}

/**
 * Construit un facteur `unknown` (`score: null`) avec une ligne d'évidence
 * `info` expliquant l'absence de donnée — affichée dans la section « Non
 * évalué » du détail (spec §3).
 */
export function unknownFactor(key: FactorKey, reason: string): MatchFactorDto {
  return { key, label: FACTOR_LABELS[key], weight: FACTOR_WEIGHTS[key], score: null, status: 'unknown', evidence: [{ kind: 'info', text: reason }] };
}
