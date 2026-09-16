import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthApi from '@/services/api/auth';
import type * as CvImportApi from '@/services/api/cv-import';
import { OnboardingPage } from './onboarding-page';

const fetchMe = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/auth', async () => {
  const actual = await vi.importActual<typeof AuthApi>('@/services/api/auth');
  return { ...actual, fetchMe };
});

const fetchCvCapabilities = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/cv-import', async () => {
  const actual = await vi.importActual<typeof CvImportApi>('@/services/api/cv-import');
  return { ...actual, fetchCvCapabilities };
});

function renderPage(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/onboarding/:step" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMe.mockResolvedValue({
    id: '1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    onboardingCompleted: false,
  });
});

afterEach(() => {
  fetchMe.mockReset();
  fetchCvCapabilities.mockReset();
});

describe('OnboardingPage', () => {
  it('redirige une etape inconnue vers bienvenue', async () => {
    renderPage('/onboarding/inconnue');
    expect(await screen.findByText('Bienvenue, Ada')).toBeInTheDocument();
  });

  it('passe de bienvenue a cv au clic sur commencer', async () => {
    const user = userEvent.setup();
    fetchCvCapabilities.mockResolvedValue({ ai: false, maxSizeBytes: 10_000_000, acceptedTypes: [] });
    renderPage('/onboarding');

    await user.click(await screen.findByRole('button', { name: 'Commencer' }));

    expect(await screen.findByRole('button', { name: 'Remplir à la main' })).toBeInTheDocument();
  });

  it('redirige vers cv quand verification est demandee sans import en cours', async () => {
    fetchCvCapabilities.mockResolvedValue({ ai: true, maxSizeBytes: 10_000_000, acceptedTypes: ['application/pdf'] });
    renderPage('/onboarding/verification');
    expect(await screen.findByLabelText('Choisir un fichier CV')).toBeInTheDocument();
  });
});
