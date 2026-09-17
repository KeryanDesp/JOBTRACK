import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  readApplicationsUrlState,
  useApplicationsUrlState,
  writeApplicationsUrlState,
  type ApplicationsUrlState,
} from './url-state';

function read(search: string): ApplicationsUrlState {
  return readApplicationsUrlState(new URLSearchParams(search));
}

/** Sonde : expose l'etat lu et la recherche reelle du routeur, et declenche des ecritures. */
function Probe() {
  const [state, setState] = useApplicationsUrlState();
  const location = useLocation();

  return (
    <div>
      <output data-testid="state">{JSON.stringify(state)}</output>
      <output data-testid="search">{location.search}</output>
      <button type="button" onClick={() => setState({ tab: 'interview' })}>
        onglet
      </button>
      <button type="button" onClick={() => setState({ page: 3 })}>
        page
      </button>
      <button type="button" onClick={() => setState({ view: 'kanban' })}>
        vue
      </button>
      <button type="button" onClick={() => setState({ applicationId: 'app_1' })}>
        ouvrir
      </button>
    </div>
  );
}

function renderProbe(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe />
    </MemoryRouter>,
  );
}

function currentState(): ApplicationsUrlState {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}') as ApplicationsUrlState;
}

describe('readApplicationsUrlState', () => {
  it('renvoie les valeurs par defaut sans parametre', () => {
    expect(read('')).toEqual({ view: 'table', tab: 'all', q: '', page: 1, applicationId: null, adding: false });
  });

  it('lit chaque parametre reconnu', () => {
    expect(read('?vue=kanban&onglet=offer&q=data&page=4&candidature=app_7&ajouter=1')).toEqual({
      view: 'kanban',
      tab: 'offer',
      q: 'data',
      page: 4,
      applicationId: 'app_7',
      adding: true,
    });
  });

  it('ramene une vue, un onglet et une page invalides a leur defaut', () => {
    expect(read('?vue=grille&onglet=inconnu&page=abc')).toMatchObject({ view: 'table', tab: 'all', page: 1 });
    expect(read('?page=0').page).toBe(1);
    expect(read('?page=-2').page).toBe(1);
    expect(read('?page=1.5').page).toBe(1);
  });

  it('borne la recherche a 120 caracteres et ignore une candidature vide', () => {
    expect(read(`?q=${'a'.repeat(200)}`).q).toHaveLength(120);
    expect(read('?candidature=').applicationId).toBeNull();
  });
});

describe('writeApplicationsUrlState', () => {
  it('omet chaque valeur egale a son defaut', () => {
    const params = writeApplicationsUrlState(read(''));
    expect(params.toString()).toBe('');
  });

  it('ecrit uniquement ce qui differe du defaut', () => {
    const state = { ...read(''), view: 'kanban' as const, tab: 'applied' as const, q: 'nantes', page: 2, adding: true };
    const params = writeApplicationsUrlState(state);
    expect(params.get('vue')).toBe('kanban');
    expect(params.get('onglet')).toBe('applied');
    expect(params.get('q')).toBe('nantes');
    expect(params.get('page')).toBe('2');
    expect(params.get('ajouter')).toBe('1');
    expect(params.get('candidature')).toBeNull();
  });
});

describe('useApplicationsUrlState', () => {
  it('ecrit un onglet dans l_URL et remet la page a 1', async () => {
    const user = userEvent.setup();
    renderProbe('/applications?page=5');
    await user.click(screen.getByRole('button', { name: 'onglet' }));

    expect(screen.getByTestId('search').textContent).toBe('?onglet=interview');
    expect(currentState()).toMatchObject({ tab: 'interview', page: 1 });
  });

  it('conserve la page demandee quand c_est justement elle qui change', async () => {
    const user = userEvent.setup();
    renderProbe('/applications?onglet=offer');
    await user.click(screen.getByRole('button', { name: 'page' }));

    expect(currentState()).toMatchObject({ tab: 'offer', page: 3 });
    expect(screen.getByTestId('search').textContent).toContain('page=3');
  });

  it('ecrit la vue et la candidature ouverte', async () => {
    const user = userEvent.setup();
    renderProbe('/applications');
    await user.click(screen.getByRole('button', { name: 'vue' }));
    expect(screen.getByTestId('search').textContent).toBe('?vue=kanban');

    await user.click(screen.getByRole('button', { name: 'ouvrir' }));
    expect(screen.getByTestId('search').textContent).toContain('candidature=app_1');
  });

  it('corrige une valeur invalide directement dans l_URL', async () => {
    renderProbe('/applications?vue=grille&page=0');
    await screen.findByTestId('search');

    expect(screen.getByTestId('search').textContent).toBe('');
    expect(currentState()).toMatchObject({ view: 'table', page: 1 });
  });
});
