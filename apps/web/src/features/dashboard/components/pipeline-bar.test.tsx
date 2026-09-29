import type { ApplicationStatsDto } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PipelineBar } from './pipeline-bar';

const BY_STATUS: ApplicationStatsDto['byStatus'] = {
  TO_APPLY: 1,
  APPLIED: 3,
  INTERVIEW: 0,
  OFFER: 0,
  REJECTED: 4,
};

describe('PipelineBar', () => {
  it('liste les cinq statuts, y compris ceux a zero', () => {
    render(<PipelineBar byStatus={BY_STATUS} total={8} />);

    for (const label of Object.values(APPLICATION_STATUS_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Deux statuts sont à zéro : la légende les nomme quand même.
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  it('ne dessine un segment que pour les statuts representes', () => {
    const { container } = render(<PipelineBar byStatus={BY_STATUS} total={8} />);

    const segments = [...container.querySelectorAll<HTMLElement>('[aria-hidden] > div')].filter(
      (element) => element.style.width !== '',
    );
    expect(segments.map((segment) => segment.style.width)).toEqual(['12.5%', '37.5%', '50%']);
  });
});
