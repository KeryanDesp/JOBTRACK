import { jobSearchQuerySchema } from '@jobtrack/shared';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { isDefaultQuery, readJobSearchQuery, useJobSearchParams, writeJobSearchQuery } from './search-params';

function wrapperAt(path: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
}

describe('readJobSearchQuery / writeJobSearchQuery', () => {
  it('fait un aller-retour stable pour une recherche non vide', () => {
    const query = jobSearchQuerySchema.parse({
      q: 'developpeur',
      communes: ['57463'],
      distance: 25,
      contractTypes: ['CDI', 'CDD'],
      sort: 'salary',
      tab: 'new',
      page: 3,
    });

    const roundTripped = readJobSearchQuery(writeJobSearchQuery(query));

    expect(roundTripped).toEqual(query);
  });

  it('serialise la recherche par defaut en une chaine vide', () => {
    const query = jobSearchQuerySchema.parse({});
    expect(writeJobSearchQuery(query).toString()).toBe('');
  });

  it('n_ecrit jamais refresh dans l_url, meme quand il vaut vrai', () => {
    const query = jobSearchQuerySchema.parse({ q: 'developpeur', refresh: true });
    expect(writeJobSearchQuery(query).toString()).not.toContain('refresh');
  });
});

describe('isDefaultQuery', () => {
  it('renvoie vrai pour la recherche par defaut', () => {
    expect(isDefaultQuery(jobSearchQuerySchema.parse({}))).toBe(true);
  });

  it('renvoie faux des qu_un champ differe du defaut', () => {
    expect(isDefaultQuery(jobSearchQuerySchema.parse({ q: 'developpeur' }))).toBe(false);
  });
});

describe('useJobSearchParams', () => {
  it('lit la recherche depuis les parametres d_url courants', () => {
    const { result } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs?q=developpeur&rayon=25'),
    });

    const [query] = result.current;
    expect(query.q).toBe('developpeur');
    expect(query.distance).toBe(25);
  });

  it('remet la page a 1 quand un filtre change', () => {
    const { result } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs?page=3'),
    });

    act(() => result.current[1]({ q: 'developpeur' }));

    expect(result.current[0].page).toBe(1);
    expect(result.current[0].q).toBe('developpeur');
  });

  it('conserve la page demandee quand next porte lui-meme page', () => {
    const { result } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs'),
    });

    act(() => result.current[1]({ page: 4 }));

    expect(result.current[0].page).toBe(4);
  });

  it('respecte un resetPage explicite meme quand page est fourni', () => {
    const { result } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs'),
    });

    act(() => result.current[1]({ page: 4 }, { resetPage: true }));

    expect(result.current[0].page).toBe(1);
  });

  it('remet refresh a faux des qu_un appel ne le mentionne pas explicitement', () => {
    const { result } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs?refresh=1'),
    });

    expect(result.current[0].refresh).toBe(true);

    act(() => result.current[1]({ q: 'developpeur' }));

    expect(result.current[0].refresh).toBe(false);
  });

  it('applique deux appels successifs de setQuery dans le meme tick', () => {
    const { result } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs'),
    });

    act(() => {
      result.current[1]({ q: 'developpeur' });
      result.current[1]({ distance: 20 });
    });

    expect(result.current[0].q).toBe('developpeur');
    expect(result.current[0].distance).toBe(20);
  });

  it('renvoie une fonction setQuery referentiellement stable entre deux rendus', () => {
    const { result, rerender } = renderHook(() => useJobSearchParams(), {
      wrapper: wrapperAt('/jobs'),
    });

    const firstSetQuery = result.current[1];
    rerender();

    expect(result.current[1]).toBe(firstSetQuery);
  });
});
