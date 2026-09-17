import type { MatchFactorDto, MatchScoreDto } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MatchPanel } from './match-panel';

function makeFactor(overrides: Partial<MatchFactorDto> = {}): MatchFactorDto {
  return {
    key: 'skills',
    label: 'Compétences et technologies',
    weight: 35,
    score: 90,
    status: 'evaluated',
    evidence: [{ kind: 'ok', text: 'React correspond' }],
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchScoreDto> = {}): MatchScoreDto {
  return {
    score: 92,
    band: 'EXCELLENT',
    priority: 'VERY_HIGH',
    explanation: { top: ['React correspond'], weak: [] },
    factors: [makeFactor()],
    computedAt: '2026-09-17T00:00:00.000Z',
    analysis: { status: 'done', error: null },
    profileComplete: true,
    insufficientData: false,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof MatchPanel>[0]> = {}) {
  const onAnalyze = vi.fn();
  const onRetry = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <MatchPanel
        match={makeMatch()}
        isPending={false}
        error={null}
        onAnalyze={onAnalyze}
        onRetry={onRetry}
        isAnalyzing={false}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onAnalyze, onRetry, container };
}

describe('MatchPanel', () => {
  it('affiche un squelette pendant le chargement', () => {
    const { container } = renderPanel({ isPending: true, match: undefined });
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('ne rend rien sans score et sans etat de chargement ni d_erreur', () => {
    const { container } = renderPanel({ match: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche le bouton analyser cette offre quand l_analyse n_a pas encore ete lancee, et appelle onAnalyze', async () => {
    const user = userEvent.setup();
    const { onAnalyze } = renderPanel({ match: makeMatch({ analysis: { status: 'none', error: null } }) });

    expect(screen.getByText("Cette offre n'a pas encore été analysée.")).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Analyser cette offre' });
    await user.click(button);

    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('affiche l_etat de chargement du bouton pendant l_analyse en cours', () => {
    renderPanel({ match: makeMatch({ analysis: { status: 'none', error: null } }), isAnalyzing: true });

    const button = screen.getByRole('button', { name: 'Analyse en cours…' });
    expect(button).toBeDisabled();
  });

  it('affiche analyse en cours pour une analyse serveur en attente', () => {
    renderPanel({ match: makeMatch({ analysis: { status: 'pending', error: null } }) });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Analyse en cours…');
  });

  it('affiche une alerte et un bouton reessayer quand l_analyse a echoue, et appelle onRetry', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderPanel({
      match: makeMatch({ analysis: { status: 'failed', error: 'Erreur technique.' } }),
    });

    expect(screen.getByText("L'analyse de cette offre a échoué.")).toBeInTheDocument();
    expect(screen.getByText('Erreur technique.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Réessayer l'analyse" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('affiche une alerte informative quand l_ia n_est pas configuree', () => {
    renderPanel({ match: makeMatch({ analysis: { status: 'ai_not_configured', error: null } }) });

    expect(screen.getByText("L'analyse des offres nécessite le service IA (non configuré).")).toBeInTheDocument();
  });

  it('affiche le bandeau profil incomplet quand le profil n_a pas assez de donnees', () => {
    renderPanel({ match: makeMatch({ profileComplete: false }) });

    expect(screen.getByText('Complétez vos compétences et expériences pour obtenir un score fiable.')).toBeInTheDocument();
  });

  it('affiche une alerte donnees insuffisantes tout en listant les facteurs evalues', () => {
    renderPanel({
      match: makeMatch({
        score: null,
        band: null,
        priority: null,
        insufficientData: true,
        factors: [makeFactor({ key: 'skills', score: 80 })],
      }),
    });

    expect(screen.getByText('Données insuffisantes pour un score fiable.')).toBeInTheDocument();
    expect(screen.getByText('Compétences et technologies')).toBeInTheDocument();
  });

  it('rend le bandeau, les facteurs avec barres accessibles et les sections a partir du score complet', () => {
    renderPanel({
      match: makeMatch({
        factors: [
          makeFactor({
            key: 'skills',
            score: 90,
            evidence: [{ kind: 'ok', text: 'React correspond' }],
          }),
          makeFactor({
            key: 'experience',
            label: 'Expérience',
            score: 40,
            evidence: [{ kind: 'warn', text: 'Expérience un peu courte' }],
          }),
          makeFactor({
            key: 'salary',
            label: 'Salaire',
            score: null,
            status: 'unknown',
            evidence: [{ kind: 'info', text: "L'offre n'indique pas de salaire" }],
          }),
        ],
      }),
    });

    expect(screen.getByText('Très bonne correspondance · 92')).toBeInTheDocument();
    expect(screen.getByText('Très forte priorité')).toBeInTheDocument();

    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars).toHaveLength(2);
    expect(progressBars[0]).toHaveAttribute('aria-valuenow', '90');
    expect(progressBars[0]).toHaveAttribute('aria-label', 'Compétences et technologies : 90 sur 100');

    expect(screen.getByText('Compétences correspondantes')).toBeInTheDocument();
    expect(screen.getByText('React correspond')).toBeInTheDocument();
    expect(screen.getByText('Points faibles')).toBeInTheDocument();
    expect(screen.getByText('Expérience un peu courte')).toBeInTheDocument();
    // « Non évalué » apparait deux fois : sous la barre du facteur salaire et
    // comme titre de la section listant les facteurs non évalués.
    expect(screen.getByRole('heading', { name: 'Non évalué' })).toBeInTheDocument();
    expect(screen.getByText("L'offre n'indique pas de salaire")).toBeInTheDocument();
    expect(screen.getByText('Priorité élevée : candidature à préparer cette semaine.')).toBeInTheDocument();
  });
});
