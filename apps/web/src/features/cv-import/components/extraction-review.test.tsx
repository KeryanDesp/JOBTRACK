import type { CvApplyFormInput, CvExtraction } from '@jobtrack/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionReview } from './extraction-review';

const EMPTY_IDENTITY: CvExtraction['identity'] = {
  firstName: null,
  lastName: null,
  phone: null,
  city: null,
  country: null,
  title: null,
  summary: null,
};

function buildExtraction(overrides: Partial<CvExtraction> = {}): CvExtraction {
  return {
    identity: { ...EMPTY_IDENTITY },
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
    preferences: { desiredRoles: [], locations: [] },
    ...overrides,
  };
}

/** Premier appel de `onSubmit` : jamais vide dans ces tests (toujours vérifié juste après un clic sur « Appliquer au profil »). */
function firstCall(onSubmit: ReturnType<typeof vi.fn<(body: CvApplyFormInput) => void>>): CvApplyFormInput {
  const call = onSubmit.mock.calls[0];
  if (!call) throw new Error('onSubmit n_a pas ete appele.');
  return call[0];
}

function firstOf<T>(items: readonly T[] | undefined): T {
  const [item] = items ?? [];
  if (item === undefined) throw new Error('Tableau vide.');
  return item;
}

function renderReview(extraction: CvExtraction, overrides: Partial<Parameters<typeof ExtractionReview>[0]> = {}) {
  const onSubmit = vi.fn<(body: CvApplyFormInput) => void>();
  const onBack = vi.fn();
  const onSkip = vi.fn();
  render(
    <ExtractionReview
      extraction={extraction}
      onSubmit={onSubmit}
      isPending={false}
      error={null}
      onBack={onBack}
      onSkip={onSkip}
      {...overrides}
    />,
  );
  return { onSubmit, onBack, onSkip };
}

describe('ExtractionReview', () => {
  it("decocher une ligne l_exclut du corps envoye (selected: false), sans retirer l_element du tableau", async () => {
    const user = userEvent.setup();
    const extraction = buildExtraction({
      identity: { ...EMPTY_IDENTITY, firstName: 'Camille' },
      experiences: [
        {
          company: 'Acme',
          role: 'Ingenieure',
          location: 'Lyon',
          startDate: '2020-01-01',
          endDate: null,
          isCurrent: true,
          description: null,
        },
      ],
    });
    const { onSubmit } = renderReview(extraction);

    await user.click(screen.getByRole('checkbox', { name: 'Inclure cet élément dans « Expériences »' }));
    await user.click(screen.getByRole('button', { name: 'Appliquer au profil' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = firstCall(onSubmit);
    expect(body.experiences).toHaveLength(1);
    const row = firstOf(body.experiences);
    expect(row.selected).toBe(false);
    expect(row.item.company).toBe('Acme');
  });

  it('un champ d_identite vide n_est pas envoye, un champ renseigne l_est', async () => {
    const user = userEvent.setup();
    const extraction = buildExtraction({
      identity: { ...EMPTY_IDENTITY, firstName: 'Camille', title: 'Developpeuse' },
    });
    const { onSubmit } = renderReview(extraction);

    const titleInput = screen.getByLabelText('Titre');
    await user.clear(titleInput);
    await user.click(screen.getByRole('button', { name: 'Appliquer au profil' }));

    const body = firstCall(onSubmit);
    expect(body.identity?.title).toBeUndefined();
    expect(body.identity?.firstName).toBe('Camille');
  });

  it("l_edition d_un element via « Modifier » est reflete dans le corps envoye", async () => {
    const user = userEvent.setup();
    const extraction = buildExtraction({
      experiences: [
        {
          company: 'Acme',
          role: 'Ingenieure',
          location: 'Lyon',
          startDate: '2020-01-01',
          endDate: null,
          isCurrent: true,
          description: null,
        },
      ],
    });
    const { onSubmit } = renderReview(extraction);

    await user.click(screen.getByRole('button', { name: 'Modifier cet élément dans « Expériences »' }));
    const roleInput = screen.getByLabelText('Poste');
    await user.clear(roleInput);
    await user.type(roleInput, 'Ingenieure principale');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await user.click(screen.getByRole('button', { name: 'Appliquer au profil' }));

    const body = firstCall(onSubmit);
    expect(firstOf(body.experiences).item.role).toBe('Ingenieure principale');
  });

  it("« Aucun » deselectionne un bloc et le compteur du pied de page se met a jour", async () => {
    const user = userEvent.setup();
    const extraction = buildExtraction({
      skills: [
        { name: 'TypeScript', category: 'TECHNICAL', level: 'ADVANCED' },
        { name: 'React', category: 'TECHNICAL', level: 'ADVANCED' },
      ],
    });
    renderReview(extraction);

    expect(screen.getByText('2 éléments seront ajoutés à votre profil.')).toBeInTheDocument();

    // Seul bloc rendu (l'extraction ne porte que des compétences) : un seul « Aucun » dans la page.
    await user.click(screen.getByRole('button', { name: 'Aucun' }));

    expect(screen.getByText('0 sur 2 sélectionnés')).toBeInTheDocument();
    expect(screen.getByText('0 éléments seront ajoutés à votre profil.')).toBeInTheDocument();
  });

  it("une extraction vide affiche l_etat vide avec les deux actions", async () => {
    const user = userEvent.setup();
    const extraction = buildExtraction();
    const { onBack, onSkip } = renderReview(extraction);

    expect(
      screen.getByText("Aucune information exploitable n'a été trouvée dans ce document."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choisir un autre fichier' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Continuer sans importer' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
