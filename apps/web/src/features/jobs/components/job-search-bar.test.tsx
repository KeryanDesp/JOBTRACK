import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobSearchBar } from './job-search-bar';

vi.mock('@/services/api/jobs', () => ({
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobsCapabilities: vi.fn(),
  fetchSavedJobs: vi.fn(),
  searchCommunes: vi.fn(),
  searchJobs: vi.fn(),
}));

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JobSearchBar q="" distance={10} communes={[]} onCommunesResolved={vi.fn()} onSearch={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('JobSearchBar', () => {
  it('lie le libelle « Lieux » au champ de saisie du selecteur de communes', () => {
    renderBar();

    expect(screen.getByRole('combobox', { name: 'Lieux' })).toBeInTheDocument();
  });
});
