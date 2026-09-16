import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { JobTabs } from './job-tabs';

function renderTabs(onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <JobTabs value="all" onChange={onChange} />
    </TooltipProvider>,
  );
  return onChange;
}

describe('JobTabs', () => {
  it('affiche une info-bulle sur les onglets desactives et ne declenche jamais onChange', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs();

    const forYouTab = screen.getByRole('tab', { name: /Pour vous/ });
    // `aria-disabled`, jamais l'attribut natif `disabled` : l'onglet reste
    // focusable (et donc atteignable au clavier) pour que l'info-bulle
    // explicative puisse recevoir le focus, contrairement à un onglet
    // réellement désactivé qui sortirait de l'ordre de tabulation.
    expect(forYouTab).toHaveAttribute('aria-disabled', 'true');
    expect(forYouTab).not.toBeDisabled();

    await user.hover(forYouTab);
    expect(await screen.findByText('Disponible avec le score (tranche 4)')).toBeInTheDocument();

    await user.click(forYouTab);
    expect(onChange).not.toHaveBeenCalled();

    forYouTab.focus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('declenche onChange en cliquant sur un onglet actif', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Nouvelles' }));

    expect(onChange).toHaveBeenCalledWith('new');
  });
});
