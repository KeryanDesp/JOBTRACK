import type { ApplicationStatus } from '@jobtrack/shared';
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApplicationStatusBadge } from './application-status-badge';

function badgeClassName(status: ApplicationStatus): string {
  const { container, unmount } = render(<ApplicationStatusBadge status={status} />);
  const className = container.querySelector('[data-slot="badge"]')?.className ?? '';
  unmount();
  return className;
}

describe('ApplicationStatusBadge', () => {
  it('affiche le libelle francais de chaque statut', () => {
    for (const status of APPLICATION_STATUSES) {
      const { unmount } = render(<ApplicationStatusBadge status={status} />);
      expect(screen.getByText(APPLICATION_STATUS_LABELS[status])).toBeInTheDocument();
      unmount();
    }
  });

  it('donne une couleur distincte a chaque statut', () => {
    const colors = APPLICATION_STATUSES.map((status) =>
      badgeClassName(status)
        .split(' ')
        .filter((entry) => entry.startsWith('bg-') || entry.startsWith('text-'))
        .join(' '),
    );

    expect(new Set(colors).size).toBe(APPLICATION_STATUSES.length);
  });

  it('exprime chaque couleur avec un jeton de theme, jamais une teinte en dur', () => {
    const tokens: Record<ApplicationStatus, string> = {
      TO_APPLY: 'bg-muted',
      APPLIED: 'bg-primary/10',
      INTERVIEW: 'bg-warning/15',
      OFFER: 'bg-success/15',
      REJECTED: 'bg-destructive/10',
    };

    for (const status of APPLICATION_STATUSES) {
      expect(badgeClassName(status)).toContain(tokens[status]);
    }
  });
});
