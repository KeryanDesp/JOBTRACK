import { jobSearchQuerySchema } from '@jobtrack/shared';
import { describe, expect, it } from 'vitest';
import { jobKeys } from './query-keys';

describe('jobKeys', () => {
  it('produit des cles stables pour les references simples', () => {
    expect(jobKeys.all).toEqual(['jobs']);
    expect(jobKeys.capabilities).toEqual(['jobs', 'capabilities']);
    expect(jobKeys.saved).toEqual(['jobs', 'saved']);
    expect(jobKeys.detail('job-1')).toEqual(['jobs', 'detail', 'job-1']);
    expect(jobKeys.communes('metz')).toEqual(['jobs', 'communes', 'metz']);
  });

  it('produit la meme cle de recherche quelle que soit l_ordre des tableaux', () => {
    const queryA = jobSearchQuerySchema.parse({ contractTypes: ['CDI', 'CDD'], communes: ['57463', '75056'] });
    const queryB = jobSearchQuerySchema.parse({ contractTypes: ['CDD', 'CDI'], communes: ['75056', '57463'] });

    expect(jobKeys.search(queryA)).toEqual(jobKeys.search(queryB));
  });

  it('distingue deux recherches dont les mots-cles differents', () => {
    const queryA = jobSearchQuerySchema.parse({ q: 'developpeur' });
    const queryB = jobSearchQuerySchema.parse({ q: 'designer' });

    expect(jobKeys.search(queryA)).not.toEqual(jobKeys.search(queryB));
  });
});
