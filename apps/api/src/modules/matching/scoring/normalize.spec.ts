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

  it('unifie csharp et c# sans les confondre avec le langage C', () => {
    expect(canonicalSkill('C#')).toBe(canonicalSkill('csharp'));
    expect(canonicalSkill('C#')).toBe(canonicalSkill('C Sharp'));
    expect(canonicalSkill('C#')).not.toBe(canonicalSkill('C'));
  });

  it('unifie cplusplus et c++ sans les confondre avec le langage C ni C#', () => {
    expect(canonicalSkill('C++')).toBe(canonicalSkill('cplusplus'));
    expect(canonicalSkill('C++')).not.toBe(canonicalSkill('C'));
    expect(canonicalSkill('C++')).not.toBe(canonicalSkill('C#'));
  });

  it('c# et dotnet restent deux groupes distincts (langage vs plateforme)', () => {
    expect(canonicalSkill('C#')).not.toBe(canonicalSkill('.NET'));
  });

  it('unifie dotnet, .NET Core et ASP.NET', () => {
    expect(canonicalSkill('.NET')).toBe(canonicalSkill('.NET Core'));
    expect(canonicalSkill('.NET')).toBe(canonicalSkill('ASP.NET'));
  });

  it('ignore un numero de version isole en fin de nom', () => {
    expect(canonicalSkill('Vue 3')).toBe(canonicalSkill('Vue'));
    expect(canonicalSkill('PHP 8')).toBe(canonicalSkill('PHP'));
    expect(canonicalSkill('Java 11')).toBe(canonicalSkill('Java'));
    expect(canonicalSkill('Node 20')).toBe(canonicalSkill('Node'));
  });

  it('ne matche plus le mot francais ordinaire tableau, seulement le logiciel', () => {
    expect(canonicalSkill('Tableau Software')).toBe(canonicalSkill('Tableau Desktop'));
    expect(canonicalSkill('tableau')).not.toBe(canonicalSkill('Tableau Software'));
  });

  it('reconnait les nouveaux outils ajoutes a la table de synonymes', () => {
    expect(canonicalSkill('Ruby on Rails')).toBe(canonicalSkill('Rails'));
    expect(canonicalSkill('SQL Server')).toBe(canonicalSkill('sqlserver'));
  });

  it('est insensible aux accents et a la casse pour une forme sans synonyme', () => {
    expect(canonicalSkill('Agilité')).toBe(canonicalSkill('AGILITE'));
  });

  it('renvoie une cle normalisee stable pour une competence sans synonyme connu', () => {
    expect(canonicalSkill('Photoshop')).toBe(canonicalSkill('photoshop'));
    expect(canonicalSkill('Photoshop')).not.toBe(canonicalSkill('Illustrator'));
  });
});
