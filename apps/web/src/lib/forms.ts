import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Résolveur React Hook Form pour un schéma zod *partagé* (celui-là même que
 * l'API applique côté serveur), sans le forker. `normalize` convertit les
 * valeurs brutes du formulaire — `''` sur un champ HTML vidé, une chaîne de
 * tags séparés par des virgules — dans la forme que le schéma accepte en
 * entrée, avant `safeParse`. Un chemin d'erreur vide (erreur portée par
 * `.refine` au niveau racine de l'objet) est reporté sous la clé `root`,
 * seule reconnue par React Hook Form pour une erreur qui ne cible aucun champ.
 *
 * Type de retour volontairement `Resolver<FieldValues>` (le type de base,
 * peu contraint, de React Hook Form) plutôt que `Resolver<TOut>` : les
 * valeurs validées par le schéma (`result.data`) portent ses transformations
 * de *sortie* (`'' -> null`, valeurs par défaut posées), alors que le
 * formulaire lui-même reste typé sur ce qu'un champ HTML produit (le type
 * d'entrée `*FormInput`). Ces deux types divergent structurellement (`null`
 * n'est pas assignable à `'' | string | undefined`), et React Hook Form ne
 * les distingue pas au niveau du type `Resolver` de cette version — les
 * sections n'utilisent donc pas les valeurs transformées comme corps de
 * requête (elles renvoient au serveur les valeurs brutes normalisées, que
 * l'API retransforme elle-même via le même schéma), seulement le verdict
 * valide/invalide et les messages d'erreur par champ.
 */
export function zodResolverWith<TOut>(
  schema: ZodType<TOut, ZodTypeDef, unknown>,
  normalize: (raw: unknown) => unknown,
): Resolver<FieldValues> {
  return (rawValues) => {
    const result = schema.safeParse(normalize(rawValues));
    if (result.success) {
      return { values: result.data as FieldValues, errors: {} };
    }

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      // Une seule erreur conservée par champ : la première rencontrée, la plus
      // proche de la cause (ex. `invalid_union` masquerait sinon un message
      // plus parlant émis par une branche plus spécifique du schéma).
      if (!errors[path]) errors[path] = { type: 'validation', message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<FieldValues> };
  };
}

/**
 * Convertit en `null` les clés valant `''` dans `raw` — pour les champs dont
 * le schéma partagé n'accepte que `null`/une valeur/`undefined` en entrée
 * (une date nullable telle que `endDate`), jamais `''`. Ne s'applique pas aux
 * champs texte/nombre/URL optionnels du schéma (`optionalText`,
 * `optionalNumber`, `optionalUrl` dans `@jobtrack/shared`) : ceux-ci acceptent
 * déjà `''` nativement et la transforment eux-mêmes en `null` en sortie — les
 * y convertir ici enverrait `null` là où seul `''` est un type d'entrée valide.
 */
export function emptyToNull(raw: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result = { ...raw };
  for (const key of keys) {
    if (result[key] === '') result[key] = null;
  }
  return result;
}

/**
 * Convertit en tableau la chaîne d'un champ « tags » saisie séparée par des
 * virgules (`'React, Node'` → `['React', 'Node']`), en ignorant les entrées
 * vides après recadrage. Ne modifie pas `raw` si la clé ne contient pas une
 * chaîne (déjà un tableau, ex. après un second appel).
 */
export function splitTags(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key];
  if (typeof value !== 'string') return raw;
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return { ...raw, [key]: tags };
}

/** Inverse d'affichage de `splitTags` : un tableau de tags en chaîne éditable. */
export function joinTags(tags: readonly string[] | null | undefined): string {
  return (tags ?? []).join(', ');
}
