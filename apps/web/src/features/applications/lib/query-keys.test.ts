import { describe, expect, it } from 'vitest';
import { applicationKeys } from './query-keys';

describe('applicationKeys', () => {
  it('produit des cles stables pour les references simples', () => {
    expect(applicationKeys.all).toEqual(['applications']);
    expect(applicationKeys.lists()).toEqual(['applications', 'list']);
    expect(applicationKeys.stats).toEqual(['applications', 'stats']);
    expect(applicationKeys.board).toEqual(['applications', 'board']);
    expect(applicationKeys.detail('app-1')).toEqual(['applications', 'detail', 'app-1']);
  });

  it('normalise une requete vide et une requete aux valeurs par defaut explicites vers la meme cle', () => {
    const implicit = applicationKeys.list({});
    const explicit = applicationKeys.list({ tab: 'all', q: undefined, page: 1, limit: 20, sort: 'updated_desc' });

    expect(implicit).toEqual(explicit);
  });

  it('rogne q et l omet quand il est vide ou absent apres normalisation', () => {
    const withSpaces = applicationKeys.list({ q: '  react  ' });
    const withoutQ = applicationKeys.list({});
    const blank = applicationKeys.list({ q: '   ' });

    expect(withSpaces).toEqual(applicationKeys.list({ q: 'react' }));
    expect(blank).toEqual(withoutQ);
  });

  it('distingue deux requetes dont les mots-cles differents', () => {
    const queryA = applicationKeys.list({ q: 'react' });
    const queryB = applicationKeys.list({ q: 'vue' });

    expect(queryA).not.toEqual(queryB);
  });

  it('imbrique list/stats/board/detail sous le prefixe commun all', () => {
    expect(applicationKeys.lists().slice(0, applicationKeys.all.length)).toEqual(applicationKeys.all);
    expect(applicationKeys.list({}).slice(0, applicationKeys.lists().length)).toEqual(applicationKeys.lists());
    expect(applicationKeys.stats.slice(0, applicationKeys.all.length)).toEqual(applicationKeys.all);
    expect(applicationKeys.board.slice(0, applicationKeys.all.length)).toEqual(applicationKeys.all);
    expect(applicationKeys.detail('app-1').slice(0, applicationKeys.all.length)).toEqual(applicationKeys.all);
  });
});
