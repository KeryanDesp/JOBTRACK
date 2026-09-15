import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Briefcase } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('affiche le titre, la description et déclenche l_action', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <EmptyState
        icon={Briefcase}
        title="Aucun favori"
        description="Vous n'avez pas encore sauvegardé d'offre."
        action={{ label: 'Découvrir les offres', onClick: onAction }}
      />,
    );

    expect(screen.getByText('Aucun favori')).toBeInTheDocument();
    expect(screen.getByText("Vous n'avez pas encore sauvegardé d'offre.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Découvrir les offres' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('se rend sans action', () => {
    render(<EmptyState icon={Briefcase} title="Aucun favori" description="Rien ici." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
