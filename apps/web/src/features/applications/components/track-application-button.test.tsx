import type { JobDetailDto } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TrackApplicationButton } from './track-application-button';

function makeDetail(overrides: Partial<JobDetailDto> = {}): JobDetailDto {
  return {
    id: 'job-1',
    title: 'Développeuse full-stack',
    company: 'Acme',
    companyLogoUrl: null,
    locationLabel: 'Metz (57)',
    departmentCode: '57',
    contractType: 'CDI',
    contractLabel: 'CDI',
    remoteMode: null,
    remoteModeInferred: false,
    experienceLevel: null,
    salaryMinAnnual: null,
    salaryMaxAnnual: null,
    salaryLabel: null,
    currency: 'EUR',
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiredAt: null,
    description: '',
    companyDescription: null,
    companyUrl: null,
    communeCode: null,
    postalCode: null,
    latitude: null,
    longitude: null,
    contractNature: null,
    experienceLabel: null,
    experienceRequired: null,
    workingTimeLabel: null,
    isFullTime: null,
    isApprenticeship: false,
    positionsCount: null,
    accessibleTh: null,
    sectorLabel: null,
    romeCode: null,
    romeLabel: null,
    qualificationLabel: null,
    sourceUpdatedAt: null,
    lastSeenAt: new Date().toISOString(),
    skills: [],
    sources: [],
    requirements: [],
    saved: false,
    match: null,
    application: null,
    ...overrides,
  };
}

function renderButton(
  job: JobDetailDto,
  options: { open?: boolean; onOpenChange?: (open: boolean) => void; compact?: boolean } = {},
) {
  const onOpenChange = options.onOpenChange ?? vi.fn();
  render(
    <MemoryRouter>
      <TrackApplicationButton job={job} open={options.open ?? false} onOpenChange={onOpenChange} compact={options.compact} />
    </MemoryRouter>,
  );
  return { onOpenChange };
}

describe('TrackApplicationButton', () => {
  it('sans candidature (job.application nul) : bouton secondaire qui demande l_ouverture du dialogue au clic', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderButton(makeDetail({ application: null }));

    const button = screen.getByRole('button', { name: 'Suivre cette candidature' });
    expect(button).toBeInTheDocument();

    await user.click(button);

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('reflete l_etat ouvert via aria-expanded sans le forcer a true', () => {
    renderButton(makeDetail({ application: null }), { open: true });

    expect(screen.getByRole('button', { name: 'Suivre cette candidature' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('avec candidature : lien vers la fiche portant le libelle de statut et le href attendu', () => {
    renderButton(makeDetail({ application: { id: 'app-1', status: 'INTERVIEW' } }));

    const link = screen.getByRole('link', { name: 'Candidature suivie · Entretien' });
    expect(link).toHaveAttribute('href', '/applications?candidature=app-1');
  });

  it('avec candidature : le libelle suit le statut fourni (ex: Offre)', () => {
    renderButton(makeDetail({ application: { id: 'app-2', status: 'OFFER' } }));

    expect(screen.getByRole('link', { name: 'Candidature suivie · Offre' })).toHaveAttribute(
      'href',
      '/applications?candidature=app-2',
    );
  });

  it('barre mobile (compact) sans candidature : libelle visible court Suivre, aria-label complet', () => {
    renderButton(makeDetail({ application: null }), { compact: true });

    expect(screen.getByText('Suivre')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suivre cette candidature' })).toBeInTheDocument();
  });

  it('barre mobile (compact) avec candidature : libelle visible court Suivie, aria-label complet avec statut', () => {
    renderButton(makeDetail({ application: { id: 'app-3', status: 'REJECTED' } }), { compact: true });

    expect(screen.getByText('Suivie')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Candidature suivie · Refusée' });
    expect(link).toHaveAttribute('href', '/applications?candidature=app-3');
  });

  it('n_ouvre pas de dialogue quand une candidature existe deja (rendu en lien, jamais en bouton declencheur)', () => {
    renderButton(makeDetail({ application: { id: 'app-4', status: 'TO_APPLY' } }));

    expect(screen.queryByRole('button', { name: 'Suivre cette candidature' })).not.toBeInTheDocument();
  });
});
