import { describe, expect, it } from 'vitest';
import { detectRemoteMode } from './remote';

describe('detectRemoteMode', () => {
  it('detecte le teletravail complet', () => {
    expect(detectRemoteMode('Poste en télétravail complet, aucune presence au bureau requise.')).toBe('REMOTE');
  });

  it('detecte le teletravail total avec accent et variantes de casse', () => {
    expect(detectRemoteMode('TÉLÉTRAVAIL TOTAL possible sur ce poste.')).toBe('REMOTE');
  });

  it('detecte le teletravail a 100 pourcent', () => {
    expect(detectRemoteMode('Télétravail à 100 % pour toute l_equipe.')).toBe('REMOTE');
  });

  it('detecte le full remote en anglais', () => {
    expect(detectRemoteMode('Full remote position, work from anywhere in France.')).toBe('REMOTE');
  });

  it('detecte le teletravail hybride explicite', () => {
    expect(detectRemoteMode('Poste en télétravail hybride, deux jours au bureau.')).toBe('HYBRID');
  });

  it('detecte un nombre de jours de teletravail par semaine', () => {
    expect(detectRemoteMode('3 jours de télétravail par semaine, 2 jours au bureau.')).toBe('HYBRID');
  });

  it('detecte le teletravail partiel', () => {
    expect(detectRemoteMode('Télétravail partiel envisageable après la periode d_essai.')).toBe('HYBRID');
  });

  it('retombe sur hybride quand seul le mot teletravail est mentionne', () => {
    expect(detectRemoteMode('Le télétravail fait partie des avantages de ce poste.')).toBe('HYBRID');
  });

  it('la negation prevaut sur une mention positive presente ailleurs dans le texte', () => {
    expect(
      detectRemoteMode('Nos equipes apprecient le télétravail chez nos clients, mais ce poste : pas de télétravail.'),
    ).toBeNull();
  });

  it('detecte teletravail impossible', () => {
    expect(detectRemoteMode('Télétravail impossible sur ce site de production.')).toBeNull();
  });

  it('renvoie null quand rien n_est mentionne', () => {
    expect(detectRemoteMode('Poste de comptable au sein d_une agence a Nancy.')).toBeNull();
  });
});
