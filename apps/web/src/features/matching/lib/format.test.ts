import { describe, expect, it } from 'vitest';
import { analysisStatusMessage, bandTone, formatScore, recommendationFor } from './format';

describe('bandTone', () => {
  it('renvoie une teinte succes pour la bande EXCELLENT', () => {
    expect(bandTone('EXCELLENT').text).toBe('text-success');
  });

  it('renvoie une teinte primaire pour la bande GOOD', () => {
    expect(bandTone('GOOD').text).toBe('text-primary');
  });

  it('renvoie une teinte avertissement pour la bande PARTIAL', () => {
    expect(bandTone('PARTIAL').text).toBe('text-warning');
  });

  it('renvoie une teinte atenuee pour la bande WEAK et pour une bande nulle', () => {
    expect(bandTone('WEAK').text).toBe('text-muted-foreground');
    expect(bandTone(null).text).toBe('text-muted-foreground');
  });
});

describe('formatScore', () => {
  it('formate un score connu en chaine simple', () => {
    expect(formatScore(92)).toBe('92');
    expect(formatScore(0)).toBe('0');
  });

  it('renvoie un tiret pour un score non evalue', () => {
    expect(formatScore(null)).toBe('—');
  });
});

describe('recommendationFor', () => {
  it('recommande de preparer sa candidature pour une priorite tres forte ou forte', () => {
    expect(recommendationFor('VERY_HIGH')).toBe('Priorité élevée : candidature à préparer cette semaine.');
    expect(recommendationFor('HIGH')).toBe('Priorité élevée : candidature à préparer cette semaine.');
  });

  it('recommande d_etudier une bonne opportunite', () => {
    expect(recommendationFor('GOOD')).toBe('Bonne opportunité : à étudier.');
  });

  it('recommande de considerer selon les autres options', () => {
    expect(recommendationFor('CONSIDER')).toBe('À considérer selon vos autres options.');
  });

  it('recommande de privilegier d_autres offres pour une faible correspondance', () => {
    expect(recommendationFor('LOW')).toBe("Correspondance faible : privilégiez d'autres offres.");
  });

  it('renvoie une chaine vide sans priorite connue', () => {
    expect(recommendationFor(null)).toBe('');
  });
});

describe('analysisStatusMessage', () => {
  it('decrit chaque statut d_analyse en francais', () => {
    expect(analysisStatusMessage('none')).toBe("Cette offre n'a pas encore été analysée.");
    expect(analysisStatusMessage('pending')).toBe('Analyse en cours…');
    expect(analysisStatusMessage('failed')).toBe("L'analyse de cette offre a échoué.");
    expect(analysisStatusMessage('ai_not_configured')).toBe("L'analyse des offres nécessite le service IA (non configuré).");
    expect(analysisStatusMessage('done')).toBe('');
  });
});
