import { describe, expect, it } from 'vitest';
import { matchKeys } from './query-keys';

describe('matchKeys', () => {
  it('construit une cle de detail prefixee par all et portant l_identifiant', () => {
    expect(matchKeys.detail('job-1')).toEqual(['jobs', 'match', 'job-1']);
  });

  it('produit des cles distinctes pour deux offres differentes', () => {
    expect(matchKeys.detail('job-1')).not.toEqual(matchKeys.detail('job-2'));
  });
});
