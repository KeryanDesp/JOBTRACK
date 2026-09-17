import { describe, expect, it } from 'vitest';
import { relevanceScore } from './relevance';

const NOW = new Date('2026-09-17T12:00:00.000Z');

describe('relevanceScore', () => {
  it('ne penalise pas une offre publiee il y a 2 heures', () => {
    const publishedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    expect(relevanceScore(85, publishedAt, NOW)).toBe(85);
  });

  it('ne penalise pas une offre publiee il y a moins de 2 jours', () => {
    const publishedAt = new Date(NOW.getTime() - 1.5 * 24 * 60 * 60 * 1000);
    expect(relevanceScore(100, publishedAt, NOW)).toBe(100);
  });

  it('applique le plancher de 0,6 a 45 jours', () => {
    const publishedAt = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000);
    expect(relevanceScore(100, publishedAt, NOW)).toBe(60);
  });

  it('reste au plancher de 0,6 au-dela de 45 jours', () => {
    const publishedAt = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(relevanceScore(100, publishedAt, NOW)).toBe(60);
  });

  it('decroit lineairement entre 2 et 45 jours', () => {
    // A mi-chemin (23,5 jours), le facteur vaut environ (1 + 0,6) / 2 = 0,8.
    const publishedAt = new Date(NOW.getTime() - 23.5 * 24 * 60 * 60 * 1000);
    expect(relevanceScore(100, publishedAt, NOW)).toBe(80);
  });

  it('permet a une offre recente moins bien notee de depasser une offre ancienne mieux notee', () => {
    const recent = relevanceScore(85, new Date(NOW.getTime() - 2 * 60 * 60 * 1000), NOW);
    const old = relevanceScore(100, new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000), NOW);
    expect(recent).toBeGreaterThan(old);
  });
});
