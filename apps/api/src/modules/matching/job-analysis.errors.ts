/**
 * Erreurs métier de `JobAnalysisService`. `AiNotConfiguredError`/`AiUnavailableError`
 * sont celles de l'extraction de CV (tranche 2) : mêmes causes (clé absente/révoquée,
 * panne transitoire Anthropic), même contrat pour l'appelant — pas de duplication.
 */
export { AiNotConfiguredError, AiUnavailableError } from '../cv-import/cv-extraction.errors';

/** Message générique : ne révèle jamais la cause exacte (schéma non respecté, refus du
 * modèle, sortie tronquée, bug interne) — seuls les journaux (jobId + classe d'erreur) le font. */
export const JOB_ANALYSIS_FAILED_MESSAGE = "L'analyse de l'offre a échoué.";

/** Analyse en échec pour une raison non couverte par les deux erreurs ci-dessus : la ligne
 * `JobAnalysis` passe à `FAILED` avec ce message, jamais une exception qui remonterait en 500. */
export class JobAnalysisFailedError extends Error {
  readonly code = 'JOB_ANALYSIS_FAILED';

  constructor() {
    super(JOB_ANALYSIS_FAILED_MESSAGE);
    this.name = 'JobAnalysisFailedError';
  }
}
