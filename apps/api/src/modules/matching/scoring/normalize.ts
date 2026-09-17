import { normalizeForKey } from '../../jobs/lib/text';
import { SYNONYM_GROUPS } from './synonyms';

/**
 * Prétraitements ponctuels avant `normalizeForKey`, pour des formes que la
 * normalisation générique (accents/casse/ponctuation) transformerait de façon
 * ambiguë : `normalizeForKey('C#')` vaut `'c'` (le `#` est retiré comme toute
 * ponctuation), ce qui confondrait le langage C# avec le langage C. On
 * réécrit ces formes en toutes lettres avant normalisation.
 */
function preprocess(name: string): string {
  return name.replace(/c#/gi, 'csharp').replace(/\.net/gi, 'dotnet');
}

/**
 * Table de résolution alias → forme canonique, construite une seule fois à
 * partir de `SYNONYM_GROUPS` : chaque forme du groupe (y compris la
 * canonique elle-même) est normalisée et pointe vers la normalisation de la
 * première entrée du groupe.
 */
function buildSynonymMap(groups: readonly (readonly string[])[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    const [first] = group;
    if (!first) continue;
    const canonical = normalizeForKey(first);
    for (const alias of group) {
      map.set(normalizeForKey(alias), canonical);
    }
  }
  return map;
}

const SYNONYM_MAP = buildSynonymMap(SYNONYM_GROUPS);

/**
 * Clé canonique d'une compétence ou technologie : `normalizeForKey` (accents,
 * casse, ponctuation) puis résolution via la table de synonymes versionnée
 * (`react` ≈ `reactjs` ≈ `react.js`, `node` ≈ `nodejs` ≈ `node.js`…). Une
 * forme absente de la table reste sa propre clé normalisée — comparer deux
 * compétences revient toujours à comparer `canonicalSkill(a) === canonicalSkill(b)`.
 */
export function canonicalSkill(name: string): string {
  const key = normalizeForKey(preprocess(name));
  return SYNONYM_MAP.get(key) ?? key;
}
