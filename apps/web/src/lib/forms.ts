import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Résolveur React Hook Form pour un schéma zod *partagé* (celui-là même que
 * l'API applique côté serveur), sans le forker. `normalize` convertit les
 * valeurs brutes du formulaire — `''` sur un champ HTML vidé, une chaîne de
 * tags séparés par des virgules — dans la forme que le schéma accepte en
 * entrée, avant `safeParse`. Un chemin d'erreur vide (erreur portée par
 * `.refine` au niveau racine de l'objet) est reporté sous la clé `root`,
 * seule reconnue par React Hook Form pour une erreur qui ne cible aucun champ ;
 * un chemin à plusieurs segments (`'a.b'`) est reconstitué en objet imbriqué
 * (`errors.a.b`, jamais une clé littérale `'a.b'`), la seule forme que React
 * Hook Form lit réellement (voir `setNestedError`).
 *
 * Type de retour `Resolver<TValues, unknown, TOut>` : React Hook Form (≥7.43,
 * ici 7.88) distingue les valeurs de formulaire `TValues` — ce qu'un champ
 * HTML produit, encore `''` — des valeurs validées `TOut` — ce que le schéma
 * produit en sortie, `''` déjà transformé en `null`, valeurs par défaut
 * posées. Ces deux types divergent structurellement sur les champs
 * texte/nombre/URL optionnels ; les sections n'utilisent donc pas les valeurs
 * validées comme corps de requête (elles renvoient au serveur les valeurs
 * brutes normalisées, que l'API retransforme elle-même via le même schéma),
 * seulement le verdict valide/invalide et les messages d'erreur par champ.
 */
export function zodResolverWith<TValues extends FieldValues, TOut>(
  schema: ZodType<TOut, ZodTypeDef, unknown>,
  normalize: (raw: unknown) => unknown,
): Resolver<TValues, unknown, TOut> {
  return (rawValues) => {
    const result = schema.safeParse(normalize(rawValues));
    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      // Une seule erreur conservée par chemin : la première rencontrée, la plus
      // proche de la cause (ex. `invalid_union` masquerait sinon un message
      // plus parlant émis par une branche plus spécifique du schéma).
      setNestedError(errors, path, { type: 'validation', message: issue.message });
    }
    // Cast documenté, seul de la fonction : `errors` est construit à la main comme un
    // objet imbriqué générique (`setNestedError`), jamais comme le `FieldErrors<TValues>`
    // précis — sa forme concrète dépend de `TValues`, inconnue ici.
    return { values: {}, errors: errors as unknown as FieldErrors<TValues> };
  };
}

/**
 * Assigne `error` dans `target` au chemin pointé par `path` (`'a.b'` →
 * `target.a.b`), en créant les niveaux intermédiaires manquants. Ne remplace
 * jamais une entrée déjà posée (première erreur gagne, cf. ci-dessus).
 */
function setNestedError(
  target: Record<string, unknown>,
  path: string,
  error: { type: string; message: string },
): void {
  const segments = path.split('.');
  let cursor = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    // `String.split` sur un chemin non vide ne produit jamais de segment `undefined` ;
    // seule concession à `noUncheckedIndexedAccess`, jamais atteinte en pratique.
    if (segment === undefined) return;
    if (index === segments.length - 1) {
      if (!(segment in cursor)) cursor[segment] = error;
      return;
    }
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
}

/**
 * Convertit en `null` les clés valant `''` dans `raw` — pour les champs dont
 * le schéma partagé n'accepte que `null`/une valeur/`undefined` en entrée
 * (une date nullable telle que `endDate`), jamais `''`. Ne s'applique pas aux
 * champs texte/nombre/URL optionnels du schéma (`optionalText`,
 * `optionalNumber`, `optionalUrl` dans `@jobtrack/shared`) : ceux-ci acceptent
 * déjà `''` nativement et la transforment eux-mêmes en `null` en sortie — les
 * y convertir ici enverrait `null` là où seul `''` est un type d'entrée valide.
 *
 * Volontairement non « curryfiée » (`(keys) => (raw) => …`) : chaque appelant
 * n'applique jamais qu'un seul jeu de clés à un seul objet, une fonction à
 * deux paramètres directs reste la forme la plus simple à lire et à tester —
 * cf. `splitTags` ci-dessous, avec la même forme.
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
