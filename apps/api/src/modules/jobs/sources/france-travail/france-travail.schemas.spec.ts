import { describe, expect, it } from 'vitest';
import { franceTravailOfferSchema } from './france-travail.schemas';

/**
 * Troncature (jamais rejet) des chaînes libres trop longues (revue sécurité, tâche 3) :
 * une offre décrite avec un champ excessif ne doit jamais faire échouer le parsing de toute
 * l'offre, seulement être raccourcie — cohérent avec le reste du fichier (`tolerantArray`).
 */
function buildRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { formations: [], langues: [], competences: [], ...overrides };
}

describe('franceTravailOfferSchema — troncature des chaines libres', () => {
  it('tronque description a 20000 caracteres sans rejeter l_offre', () => {
    const raw = buildRaw({ id: 'FT-1', intitule: 'Poste', description: 'x'.repeat(25_000) });
    const parsed = franceTravailOfferSchema.parse(raw);
    expect(parsed.description).toHaveLength(20_000);
  });

  it('tronque intitule a 2000 caracteres', () => {
    const raw = buildRaw({ id: 'FT-2', intitule: 'y'.repeat(3_000) });
    const parsed = franceTravailOfferSchema.parse(raw);
    expect(parsed.intitule).toHaveLength(2_000);
  });

  it('tronque un libelle court (romeLibelle) a 200 caracteres', () => {
    const raw = buildRaw({ id: 'FT-3', intitule: 'Poste', romeLibelle: 'z'.repeat(500) });
    const parsed = franceTravailOfferSchema.parse(raw);
    expect(parsed.romeLibelle).toHaveLength(200);
  });

  it('tronque la description d_entreprise a 2000 caracteres', () => {
    const raw = buildRaw({
      id: 'FT-4',
      intitule: 'Poste',
      entreprise: { nom: 'Acme', description: 'w'.repeat(3_000), logo: null, url: null },
    });
    const parsed = franceTravailOfferSchema.parse(raw);
    expect(parsed.entreprise?.description).toHaveLength(2_000);
  });

  it('laisse intacte une chaine sous la limite', () => {
    const raw = buildRaw({ id: 'FT-5', intitule: 'Développeuse React' });
    const parsed = franceTravailOfferSchema.parse(raw);
    expect(parsed.intitule).toBe('Développeuse React');
  });

  it('ne tronque jamais l_identifiant, meme demesure : jamais du texte libre', () => {
    const id = `FT-${'9'.repeat(3_000)}`;
    const raw = buildRaw({ id, intitule: 'Poste' });
    const parsed = franceTravailOfferSchema.parse(raw);
    expect(parsed.id).toBe(id);
  });
});
