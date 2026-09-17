import type { ApplicationEventDto } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApplicationEvents } from './application-events';

function makeEvent(overrides: Partial<ApplicationEventDto> = {}): ApplicationEventDto {
  return {
    id: 'evt-1',
    type: 'CREATED',
    fromStatus: null,
    toStatus: null,
    note: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    ...overrides,
  };
}

describe('ApplicationEvents', () => {
  it('affiche un message dedie quand l_historique est vide', () => {
    render(<ApplicationEvents events={[]} />);

    expect(screen.getByText('Aucun évènement.')).toBeInTheDocument();
  });

  it('affiche les libelles francais de chaque type d_evenement', () => {
    render(
      <ApplicationEvents
        events={[
          makeEvent({ id: 'evt-1', type: 'CREATED' }),
          makeEvent({ id: 'evt-2', type: 'NOTE_UPDATED' }),
          makeEvent({ id: 'evt-3', type: 'RESUME_CHANGED' }),
        ]}
      />,
    );

    expect(screen.getByText('Candidature créée')).toBeInTheDocument();
    expect(screen.getByText('Notes mises à jour')).toBeInTheDocument();
    expect(screen.getByText('CV modifié')).toBeInTheDocument();
  });

  it('detaille un changement de statut par ses deux bornes', () => {
    render(
      <ApplicationEvents
        events={[makeEvent({ id: 'evt-2', type: 'STATUS_CHANGED', fromStatus: 'APPLIED', toStatus: 'INTERVIEW' })]}
      />,
    );

    expect(screen.getByText('Candidature envoyée → Entretien')).toBeInTheDocument();
  });

  it('retombe sur le libelle generique quand les bornes du statut manquent', () => {
    render(<ApplicationEvents events={[makeEvent({ type: 'STATUS_CHANGED' })]} />);

    expect(screen.getByText('Statut modifié')).toBeInTheDocument();
  });

  it('classe les evenements du plus recent au plus ancien', () => {
    render(
      <ApplicationEvents
        events={[
          makeEvent({ id: 'evt-1', type: 'CREATED', createdAt: '2026-09-10T08:00:00.000Z' }),
          makeEvent({
            id: 'evt-2',
            type: 'STATUS_CHANGED',
            fromStatus: 'TO_APPLY',
            toStatus: 'APPLIED',
            createdAt: '2026-09-12T08:00:00.000Z',
          }),
          makeEvent({ id: 'evt-3', type: 'NOTE_UPDATED', createdAt: '2026-09-14T08:00:00.000Z' }),
        ]}
      />,
    );

    const labels = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(labels[0]).toContain('Notes mises à jour');
    expect(labels[1]).toContain('À postuler → Candidature envoyée');
    expect(labels[2]).toContain('Candidature créée');
  });
});
