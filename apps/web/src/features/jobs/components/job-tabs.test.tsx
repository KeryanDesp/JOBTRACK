import { JOB_TABS } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JobTabs } from './job-tabs';

function renderTabs(onChange = vi.fn()) {
  render(<JobTabs value="all" onChange={onChange} />);
  return onChange;
}

describe('JobTabs', () => {
  it('affiche chaque onglet une seule fois, tous actifs (score, tranche 4)', () => {
    renderTabs();

    for (const tab of JOB_TABS) {
      const trigger = screen.getByRole('tab', { name: tab.label });
      expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
      expect(trigger).not.toBeDisabled();
    }
  });

  it('declenche onChange("for_you") en cliquant sur Pour vous', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Pour vous' }));

    expect(onChange).toHaveBeenCalledWith('for_you');
  });

  it('declenche onChange("priority") en cliquant sur Forte priorite', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Forte priorité' }));

    expect(onChange).toHaveBeenCalledWith('priority');
  });

  it('declenche onChange("new") en cliquant sur Nouvelles', async () => {
    const user = userEvent.setup();
    const onChange = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Nouvelles' }));

    expect(onChange).toHaveBeenCalledWith('new');
  });
});
