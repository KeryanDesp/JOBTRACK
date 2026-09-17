import type { MatchScoreDto } from '@jobtrack/shared';
import { FACTOR_LABELS, MATCH_BAND_LABELS } from '@jobtrack/shared';
import { AlertCircle, AlertTriangle, Check, Loader2, Sparkles, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api/client';
import { bandTone, formatScore, recommendationFor } from '../lib/format';
import { IncompleteProfileNotice } from './incomplete-profile-notice';
import { PriorityChip } from './priority-chip';

interface MatchPanelProps {
  match: MatchScoreDto | undefined;
  isPending: boolean;
  error: Error | null;
  onAnalyze: () => void;
  onRetry: () => void;
  isAnalyzing: boolean;
}

/** Squelette pendant le chargement initial du score (spec §7). */
function MatchPanelSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-6 w-56" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Section « Pourquoi cette offre vous correspond » (spec §2, produit §17) :
 * bandeau bande + priorité, barres par facteur, compétences correspondantes,
 * points faibles, facteurs non évalués, recommandation. Toutes les lignes
 * viennent du moteur de score (`MatchScoreDto`) — jamais composées ici.
 *
 * États gérés dans l'ordre : squelette (`isPending`) ; erreur réseau
 * (`error`) ; profil incomplet (`profileComplete`, avant même de proposer
 * « Analyser cette offre » — sans compétence ni expérience dans le profil, le
 * score ne sera de toute façon pas calculable une fois l'offre analysée) ;
 * statut d'analyse (`none`/`pending`/`failed`/`ai_not_configured`) ; rendu
 * complet, avec un bandeau supplémentaire si `insufficientData` (les facteurs
 * déjà évalués restent affichés).
 */
export function MatchPanel({ match, isPending, error, onAnalyze, onRetry, isAnalyzing }: MatchPanelProps) {
  if (isPending) return <MatchPanelSkeleton />;

  if (error) {
    const message = error instanceof ApiError ? error.message : 'Une erreur est survenue. Veuillez réessayer.';
    return <ErrorState message={message} onRetry={onRetry} role="status" />;
  }

  if (!match) return null;

  if (!match.profileComplete) {
    return <IncompleteProfileNotice />;
  }

  if (match.analysis.status === 'none') {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Sparkles}
          title="Cette offre n'a pas encore été analysée."
          description="Lancez l'analyse pour obtenir un score de correspondance basé sur votre profil."
        />
        <div className="flex justify-center">
          <Button type="button" onClick={onAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Analyse en cours…
              </>
            ) : (
              'Analyser cette offre'
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (match.analysis.status === 'pending') {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Analyse en cours…
      </div>
    );
  }

  if (match.analysis.status === 'failed') {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>L&apos;analyse de cette offre a échoué.</AlertTitle>
          {match.analysis.error && <AlertDescription>{match.analysis.error}</AlertDescription>}
        </Alert>
        <Button type="button" variant="outline" onClick={onRetry}>
          Réessayer l&apos;analyse
        </Button>
      </div>
    );
  }

  if (match.analysis.status === 'ai_not_configured') {
    return (
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>L&apos;analyse des offres nécessite le service IA (non configuré).</AlertTitle>
      </Alert>
    );
  }

  const tone = bandTone(match.band);
  const skillsFactor = match.factors.find((factor) => factor.key === 'skills');
  const matchingSkills = skillsFactor ? skillsFactor.evidence.filter((entry) => entry.kind === 'ok') : [];
  const weakPoints = match.factors.flatMap((factor) =>
    factor.evidence.filter((entry) => entry.kind === 'warn' || entry.kind === 'missing'),
  );
  const unknownFactors = match.factors.filter((factor) => factor.status === 'unknown');
  const recommendation = recommendationFor(match.priority);

  return (
    <div className="space-y-5">
      {match.insufficientData && (
        <Alert>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Données insuffisantes pour un score fiable.</AlertTitle>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h3 className={cn('text-lg font-semibold', tone.text)}>
          {match.band ? MATCH_BAND_LABELS[match.band] : 'Correspondance non évaluée'}
          {match.score !== null && ` · ${formatScore(match.score)}`}
        </h3>
        <PriorityChip priority={match.priority} />
      </div>

      <div className="space-y-3">
        {match.factors.map((factor) => (
          <div key={factor.key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{FACTOR_LABELS[factor.key]}</span>
              {factor.status === 'evaluated' && factor.score !== null && (
                <span className="text-muted-foreground">{factor.score} %</span>
              )}
            </div>
            {factor.status === 'evaluated' && factor.score !== null ? (
              <Progress value={factor.score} aria-label={`${FACTOR_LABELS[factor.key]} : ${factor.score} sur 100`} />
            ) : (
              <p className="text-xs text-muted-foreground">Non évalué</p>
            )}
          </div>
        ))}
      </div>

      {matchingSkills.length > 0 && (
        <section>
          <h4 className="text-sm font-medium">Compétences correspondantes</h4>
          <ul className="mt-1.5 space-y-1 text-sm">
            {matchingSkills.map((entry, index) => (
              <li key={index} className="flex items-start gap-1.5">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {weakPoints.length > 0 && (
        <section>
          <h4 className="text-sm font-medium">Points faibles</h4>
          <ul className="mt-1.5 space-y-1 text-sm">
            {weakPoints.map((entry, index) => (
              <li key={index} className="flex items-start gap-1.5">
                {entry.kind === 'missing' ? (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                )}
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unknownFactors.length > 0 && (
        <section>
          <h4 className="text-sm font-medium">Non évalué</h4>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            {unknownFactors.map((factor) => (
              <li key={factor.key}>{factor.evidence[0]?.text ?? `${FACTOR_LABELS[factor.key]} : non évalué`}</li>
            ))}
          </ul>
        </section>
      )}

      {recommendation && <p className="text-sm text-muted-foreground">{recommendation}</p>}
    </div>
  );
}
