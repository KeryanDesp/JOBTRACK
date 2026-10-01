import type { ApplicationWeeklyPointDto } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WeeklyChart } from './weekly-chart';

function weeks(...applied: number[]): ApplicationWeeklyPointDto[] {
  // Des lundis consécutifs, à partir du 1er septembre 2026 (un lundi).
  return applied.map((value, index) => ({
    weekStart: new Date(Date.UTC(2026, 8, 7 + index * 7)).toISOString().slice(0, 10),
    applied: value,
  }));
}

describe('WeeklyChart', () => {
  it('double le graphique d_un tableau lisible par un lecteur d_ecran', () => {
    render(<WeeklyChart weeks={weeks(2, 0, 5)} />);

    const table = screen.getByRole('table', { name: 'Candidatures envoyées par semaine' });
    expect(table).toBeInTheDocument();
    // La semaine à zéro figure dans le tableau : une semaine sans candidature est une
    // information, pas une ligne à retirer.
    expect(screen.getByRole('row', { name: /14 sept\. 0/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /21 sept\. 5/ })).toBeInTheDocument();
  });

  it('remplace le graphique par une phrase quand aucune candidature n_a ete envoyee', () => {
    render(<WeeklyChart weeks={weeks(0, 0, 0)} />);

    expect(screen.getByText('Aucune candidature envoyée sur les 3 dernières semaines.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('cale l_echelle sur le maximum de la fenetre, jamais sur le total', () => {
    const { container } = render(<WeeklyChart weeks={weeks(5, 10)} />);

    const heights = [...container.querySelectorAll<HTMLElement>('.bg-primary')].map((bar) => bar.style.height);
    expect(heights).toEqual(['50%', '100%']);
  });
});
