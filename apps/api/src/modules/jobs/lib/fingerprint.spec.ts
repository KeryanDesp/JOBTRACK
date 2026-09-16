import { describe, expect, it } from 'vitest';
import { jobFingerprint } from './fingerprint';

const BASE = {
  company: 'Solaris Ingénierie',
  title: 'Ingénieur logiciel senior',
  communeCode: '57463' as string | null,
  locationLabel: 'Metz (57)' as string | null,
  sourceKind: 'FRANCE_TRAVAIL' as const,
  externalId: 'FT-0001',
};

describe('jobFingerprint', () => {
  it('deux offres de meme entreprise, titre et commune partagent la meme empreinte', () => {
    const a = jobFingerprint(BASE);
    const b = jobFingerprint({ ...BASE, externalId: 'FT-9999' });
    expect(a).toBe(b);
  });

  it('la mention h/f est ignoree dans le titre', () => {
    const a = jobFingerprint(BASE);
    const b = jobFingerprint({ ...BASE, title: 'Ingénieur logiciel senior (H/F)' });
    expect(a).toBe(b);
  });

  it('une casse ou un accent different du titre ne change pas l_empreinte', () => {
    const a = jobFingerprint(BASE);
    const b = jobFingerprint({ ...BASE, title: 'INGENIEUR LOGICIEL SENIOR' });
    expect(a).toBe(b);
  });

  it('une commune differente change l_empreinte', () => {
    const a = jobFingerprint(BASE);
    const b = jobFingerprint({ ...BASE, communeCode: '75101' });
    expect(a).not.toBe(b);
  });

  it('sans commune, se replie sur le libelle de lieu normalise', () => {
    const a = jobFingerprint({ ...BASE, communeCode: null, locationLabel: 'Metz (57)' });
    const b = jobFingerprint({ ...BASE, communeCode: null, locationLabel: 'metz (57)' });
    expect(a).toBe(b);
  });

  it('sans entreprise, l_empreinte inclut la source et son identifiant externe', () => {
    const a = jobFingerprint({ ...BASE, company: '', externalId: 'FT-0001' });
    const b = jobFingerprint({ ...BASE, company: '', externalId: 'FT-0002' });
    expect(a).not.toBe(b);
  });

  it('sans entreprise, une meme source et un meme identifiant donnent la meme empreinte', () => {
    const a = jobFingerprint({ ...BASE, company: '' });
    const b = jobFingerprint({ ...BASE, company: null });
    expect(a).toBe(b);
  });

  it('avec ou sans entreprise, les empreintes different (chemins de calcul distincts)', () => {
    const withCompany = jobFingerprint(BASE);
    const withoutCompany = jobFingerprint({ ...BASE, company: '' });
    expect(withCompany).not.toBe(withoutCompany);
  });
});
