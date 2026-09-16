import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapFranceTravailOffer } from './france-travail.mapper';
import { franceTravailSearchResponseSchema, type FranceTravailOffer } from './france-travail.schemas';

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'france-travail');

function readOffers(fileName: string): FranceTravailOffer[] {
  const raw: unknown = JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), 'utf-8'));
  return franceTravailSearchResponseSchema.parse(raw).resultats;
}

function findOffer(offers: FranceTravailOffer[], id: string): FranceTravailOffer {
  const offer = offers.find((candidate) => candidate.id === id);
  if (!offer) throw new Error(`Offre ${id} absente de la fixture`);
  return offer;
}

/** Offre minimale valide : les trois listes sont les seuls champs non optionnels du schema. */
function buildOffer(overrides: Partial<FranceTravailOffer> = {}): FranceTravailOffer {
  return { formations: [], langues: [], competences: [], ...overrides };
}

const page1 = readOffers('search-page-1.json');
const page2 = readOffers('search-page-2.json');

describe('mapFranceTravailOffer — cas invalides', () => {
  it('renvoie null quand l_identifiant est absent', () => {
    expect(mapFranceTravailOffer(buildOffer({ id: null, intitule: 'Poste' }))).toBeNull();
  });

  it('renvoie null quand l_intitule est absent', () => {
    expect(mapFranceTravailOffer(buildOffer({ id: 'FT-X', intitule: null }))).toBeNull();
  });
});

describe('mapFranceTravailOffer — FT-0001 (CDI, cadre)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0001'));

  it('mappe le contrat CDI et conserve le libelle', () => {
    expect(draft?.contractType).toBe('CDI');
    expect(draft?.contractLabel).toBe('Contrat à durée indéterminée');
    expect(draft?.isApprenticeship).toBe(false);
  });

  it('mappe l_experience exigee avec le nombre d_annees', () => {
    expect(draft?.experienceLevel).toBe('SENIOR');
    expect(draft?.experienceRequired).toBe(true);
  });

  it('mappe le salaire annuel en fourchette', () => {
    expect(draft?.salaryMinAnnual).toBe(45000);
    expect(draft?.salaryMaxAnnual).toBe(55000);
  });

  it('nettoie le libelle de lieu et deduit le departement', () => {
    expect(draft?.communeCode).toBe('57463');
    expect(draft?.departmentCode).toBe('57');
    expect(draft?.locationLabel).toBe('Metz (57)');
  });

  it('reprend les competences avec leur exigence', () => {
    expect(draft?.skills).toEqual([
      { name: 'TypeScript', required: true },
      { name: 'NestJS', required: true },
      { name: 'PostgreSQL', required: false },
    ]);
  });

  it('reprend formation et langue en exigences', () => {
    expect(draft?.requirements).toEqual([
      { kind: 'EDUCATION', label: 'BAC+5 et plus ou équivalents – Informatique', required: false },
      { kind: 'LANGUAGE', label: 'Anglais', required: false },
    ]);
  });

  it('utilise l_url d_origine et l_url de candidature http(s)', () => {
    expect(draft?.source.url).toBe('https://candidat.francetravail.fr/offres/recherche/detail/FT-0001-fictive');
    expect(draft?.source.applyUrl).toBe('https://candidature.francetravail.fr/offre/FT-0001-fictive');
  });

  it('sans partenaire relaye, partnerName est nul', () => {
    expect(draft?.source.partnerName).toBeNull();
  });

  it('aucune mention de teletravail dans le texte : remoteMode nul et non inferee', () => {
    expect(draft?.remoteMode).toBeNull();
    expect(draft?.remoteModeInferred).toBe(false);
  });
});

describe('mapFranceTravailOffer — FT-0002 (CDD, salaire mensuel)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0002'));

  it('mappe le contrat CDD', () => {
    expect(draft?.contractType).toBe('CDD');
  });

  it('convertit le salaire mensuel en annuel via la duree en mois', () => {
    expect(draft?.salaryMinAnnual).toBe(30000);
    expect(draft?.salaryMaxAnnual).toBe(36000);
  });

  it('experience souhaitee d_un an donne mid et non exige', () => {
    expect(draft?.experienceLevel).toBe('MID');
    expect(draft?.experienceRequired).toBe(false);
  });
});

describe('mapFranceTravailOffer — FT-0003 (mission d_interim)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0003'));

  it('MIS se traduit en INTERIM', () => {
    expect(draft?.contractType).toBe('INTERIM');
  });

  it('experience debutant accepte donne junior et non exige', () => {
    expect(draft?.experienceLevel).toBe('JUNIOR');
    expect(draft?.experienceRequired).toBe(false);
  });

  it('convertit un taux horaire unique en annuel', () => {
    expect(draft?.salaryMinAnnual).toBe(Math.round(12.5 * 151.67 * 12));
    expect(draft?.salaryMaxAnnual).toBe(draft?.salaryMinAnnual);
  });

  it('reprend le nombre de postes', () => {
    expect(draft?.positionsCount).toBe(3);
  });
});

describe('mapFranceTravailOffer — FT-0004 (apprentissage)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0004'));

  it('natureContrat E2 et alternance donnent APPRENTICESHIP', () => {
    expect(draft?.contractType).toBe('APPRENTICESHIP');
    expect(draft?.isApprenticeship).toBe(true);
  });

  it('salaire « Selon profil » renvoie des montants nuls mais conserve le libelle', () => {
    expect(draft?.salaryMinAnnual).toBeNull();
    expect(draft?.salaryMaxAnnual).toBeNull();
    expect(draft?.salaryLabel).toBe('Selon profil');
  });

  it('reprend la formation associee a l_apprentissage', () => {
    expect(draft?.requirements).toEqual([
      { kind: 'EDUCATION', label: 'BAC ou équivalent – Métallurgie', required: true },
    ]);
  });
});

describe('mapFranceTravailOffer — FT-0006 (teletravail partiel, Paris)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0006'));

  it('detecte un teletravail hybride dans la description', () => {
    expect(draft?.remoteMode).toBe('HYBRID');
    expect(draft?.remoteModeInferred).toBe(true);
  });

  it('deduit le departement 75 depuis la commune parisienne', () => {
    expect(draft?.communeCode).toBe('75101');
    expect(draft?.departmentCode).toBe('75');
  });

  it('conserve le numero d_arrondissement dans le libelle de lieu', () => {
    expect(draft?.locationLabel).toBe('Paris 1 (75)');
  });
});

describe('mapFranceTravailOffer — FT-0007 (Corse, offre relayee par un partenaire)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0007'));

  it('deduit le departement corse 2A depuis le code commune', () => {
    expect(draft?.communeCode).toBe('2A004');
    expect(draft?.departmentCode).toBe('2A');
  });

  it('reprend le nom du partenaire et son url d_origine', () => {
    expect(draft?.source.partnerName).toBe('JobRelais Corse');
    expect(draft?.source.url).toBe('https://partenaire-fictif.example/offres/FT-0007');
  });

  it('six mois d_experience souhaitee donnent junior', () => {
    expect(draft?.experienceLevel).toBe('JUNIOR');
    expect(draft?.experienceRequired).toBe(false);
  });
});

describe('mapFranceTravailOffer — FT-0008 (Saint-Denis, outre-mer)', () => {
  const draft = mapFranceTravailOffer(findOffer(page1, 'FT-0008'));

  it('deduit le departement 974 (trois caracteres) depuis la commune', () => {
    expect(draft?.communeCode).toBe('97411');
    expect(draft?.departmentCode).toBe('974');
  });

  it('nettoie le libelle de lieu compose', () => {
    expect(draft?.locationLabel).toBe('Saint-Denis (974)');
  });
});

describe('mapFranceTravailOffer — FT-0010 (contrat saisonnier)', () => {
  const draft = mapFranceTravailOffer(findOffer(page2, 'FT-0010'));

  it('SAI se traduit en CDD', () => {
    expect(draft?.contractType).toBe('CDD');
  });
});

describe('mapFranceTravailOffer — FT-0011 (profession liberale)', () => {
  const draft = mapFranceTravailOffer(findOffer(page2, 'FT-0011'));

  it('LIB se traduit en FREELANCE', () => {
    expect(draft?.contractType).toBe('FREELANCE');
  });

  it('deduit le departement 67 depuis la commune de Strasbourg', () => {
    expect(draft?.departmentCode).toBe('67');
  });
});

describe('mapFranceTravailOffer — url de repli et dates', () => {
  it('construit l_url candidat quand aucune url d_origine http(s) n_est fournie', () => {
    const draft = mapFranceTravailOffer(
      buildOffer({
        id: 'FT-9000',
        intitule: 'Poste sans url d_origine',
        origineOffre: { origine: '1', urlOrigine: null, partenaires: [] },
      }),
    );

    expect(draft?.source.url).toBe('https://candidat.francetravail.fr/offres/recherche/detail/FT-9000');
  });

  it('ignore une url d_origine qui n_est pas http(s)', () => {
    const draft = mapFranceTravailOffer(
      buildOffer({
        id: 'FT-9001',
        intitule: 'Poste avec url douteuse',
        origineOffre: { origine: '1', urlOrigine: 'javascript:alert(1)', partenaires: [] },
      }),
    );

    expect(draft?.source.url).toBe('https://candidat.francetravail.fr/offres/recherche/detail/FT-9001');
  });

  it('utilise dateActualisation quand dateCreation est absente', () => {
    const draft = mapFranceTravailOffer(
      buildOffer({
        id: 'FT-9002',
        intitule: 'Poste sans date de creation',
        dateCreation: null,
        dateActualisation: '2026-01-15T10:00:00.000Z',
      }),
    );

    expect(draft?.publishedAt.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  it('utilise l_instant courant quand aucune date n_est exploitable', () => {
    const now = new Date('2026-09-16T12:00:00.000Z');
    const draft = mapFranceTravailOffer(
      buildOffer({ id: 'FT-9003', intitule: 'Poste sans date', dateCreation: null, dateActualisation: null }),
      now,
    );

    expect(draft?.publishedAt).toEqual(now);
  });
});

describe('mapFranceTravailOffer — deduplication des competences', () => {
  it('deduplique deux competences de meme nom normalise', () => {
    const draft = mapFranceTravailOffer(
      buildOffer({
        id: 'FT-9004',
        intitule: 'Poste avec competences dupliquees',
        competences: [
          { code: '1', libelle: 'TypeScript', exigence: 'E' },
          { code: '2', libelle: 'typescript', exigence: 'S' },
        ],
      }),
    );

    expect(draft?.skills).toEqual([{ name: 'TypeScript', required: true }]);
  });
});
