import { describe, expect, it } from 'vitest';
import { canonicalSkill } from './normalize';

describe('canonicalSkill', () => {
  it('unifie react, reactjs et react.js', () => {
    expect(canonicalSkill('React')).toBe(canonicalSkill('ReactJS'));
    expect(canonicalSkill('React')).toBe(canonicalSkill('React.js'));
  });

  it('unifie node, nodejs et node.js', () => {
    expect(canonicalSkill('Node')).toBe(canonicalSkill('NodeJS'));
    expect(canonicalSkill('Node')).toBe(canonicalSkill('Node.js'));
  });

  it('unifie js et javascript', () => {
    expect(canonicalSkill('JS')).toBe(canonicalSkill('JavaScript'));
  });

  it('unifie postgres, postgresql et pgsql', () => {
    expect(canonicalSkill('Postgres')).toBe(canonicalSkill('PostgreSQL'));
    expect(canonicalSkill('Postgres')).toBe(canonicalSkill('pgsql'));
  });

  it('unifie k8s et kubernetes', () => {
    expect(canonicalSkill('K8s')).toBe(canonicalSkill('Kubernetes'));
  });

  it('unifie csharp, c# et dotnet sans confondre avec le langage C', () => {
    expect(canonicalSkill('C#')).toBe(canonicalSkill('.NET'));
    expect(canonicalSkill('C#')).toBe(canonicalSkill('dotnet'));
    expect(canonicalSkill('C#')).not.toBe(canonicalSkill('C'));
  });

  it('est insensible aux accents et a la casse pour une forme sans synonyme', () => {
    expect(canonicalSkill('Agilité')).toBe(canonicalSkill('AGILITE'));
  });

  it('renvoie une cle normalisee stable pour une competence sans synonyme connu', () => {
    expect(canonicalSkill('Photoshop')).toBe(canonicalSkill('photoshop'));
    expect(canonicalSkill('Photoshop')).not.toBe(canonicalSkill('Illustrator'));
  });
});
