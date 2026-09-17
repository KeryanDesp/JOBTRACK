import { z } from 'zod';

/**
 * Schémas Zod « tolérants » pour l'API France Travail — Offres d'emploi v2.
 * L'API n'est pas versionnée de façon stricte : un champ ajouté, renommé ou
 * absent ne doit jamais casser l'ingestion. Principe : tout est optionnel,
 * `.strip()` retire les champs inconnus, et les listes passent par
 * `tolerantArray`, qui écarte silencieusement une ligne invalide plutôt que de
 * faire échouer la liste entière.
 */

/**
 * Accepte n'importe quelle entrée (y compris absente) et renvoie un tableau
 * filtré : chaque élément est validé individuellement par `itemSchema`, les
 * éléments invalides sont simplement écartés (jamais d'échec global).
 */
function tolerantArray<T extends z.ZodType<unknown, z.ZodTypeDef, unknown>>(
  itemSchema: T,
): z.ZodType<Array<z.infer<T>>, z.ZodTypeDef, unknown> {
  return z.unknown().transform((value) => {
    const items = Array.isArray(value) ? value : [];
    const result: Array<z.infer<T>> = [];
    for (const item of items) {
      const parsed = itemSchema.safeParse(item);
      if (parsed.success) result.push(parsed.data);
    }
    return result;
  });
}

/**
 * Chaîne libre optionnelle, tronquée à `max` caractères plutôt que rejetée :
 * dans l'esprit tolérant de ce fichier (voir l'en-tête), un champ texte trop
 * long (source hostile ou aberrante) ne doit jamais faire échouer le parsing
 * d'une offre entière — il est simplement raccourci, comme `cleanText` le
 * refait de toute façon plus loin dans le mapper pour les champs affichés.
 */
function tolerantString(max: number) {
  return z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value == null ? value : value.slice(0, max)));
}

/** Jeton OAuth2 (`client_credentials`). `access_token` est le seul champ indispensable. */
export const franceTravailTokenSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().optional().nullable(),
    expires_in: z.number().int().positive().optional().nullable(),
    scope: z.string().optional().nullable(),
  })
  .strip();

export type FranceTravailToken = z.infer<typeof franceTravailTokenSchema>;

const franceTravailFormationSchema = z
  .object({
    codeFormation: tolerantString(200),
    domaineLibelle: tolerantString(200),
    niveauLibelle: tolerantString(200),
    commentaire: tolerantString(200),
    exigence: tolerantString(200),
  })
  .strip();

const franceTravailLangueSchema = z
  .object({
    libelle: tolerantString(200),
    exigence: tolerantString(200),
  })
  .strip();

const franceTravailCompetenceSchema = z
  .object({
    code: tolerantString(200),
    libelle: tolerantString(200),
    exigence: tolerantString(200),
  })
  .strip();

const franceTravailLieuTravailSchema = z
  .object({
    libelle: tolerantString(200),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    // Codes, jamais du texte libre : longueur non bornée ici, la forme exacte
    // (cinq chiffres, ou `2A`/`2B` + trois chiffres) est vérifiée plus loin par
    // le mapper (`cleanLocationCode`), qui renvoie `null` sur toute anomalie.
    codePostal: z.string().optional().nullable(),
    commune: z.string().optional().nullable(),
  })
  .strip();

const franceTravailEntrepriseSchema = z
  .object({
    nom: tolerantString(200),
    description: tolerantString(2000),
    logo: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
  })
  .strip();

const franceTravailSalaireSchema = z
  .object({
    libelle: tolerantString(200),
    commentaire: tolerantString(200),
    complement1: tolerantString(200),
    complement2: tolerantString(200),
  })
  .strip();

const franceTravailContactSchema = z
  .object({
    nom: tolerantString(200),
    coordonnees1: tolerantString(200),
    coordonnees2: tolerantString(200),
    coordonnees3: tolerantString(200),
    telephone: tolerantString(200),
    courriel: tolerantString(200),
    commentaire: tolerantString(200),
    urlRecruteur: z.string().optional().nullable(),
    urlPostulation: z.string().optional().nullable(),
  })
  .strip();

const franceTravailPartenaireSchema = z
  .object({
    nom: tolerantString(200),
    url: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),
  })
  .strip();

const franceTravailOrigineOffreSchema = z
  .object({
    origine: tolerantString(200),
    urlOrigine: z.string().optional().nullable(),
    partenaires: tolerantArray(franceTravailPartenaireSchema),
  })
  .strip();

/** Une offre France Travail — tous les champs sont optionnels (spec §4). */
export const franceTravailOfferSchema = z
  .object({
    // Identifiant, jamais du texte libre : aucune troncature, une valeur
    // tronquée casserait l'égalité avec les identifiants utilisés ailleurs
    // (dédoublonnage, `markRemoved`, purge des fixtures…).
    id: z.string().optional().nullable(),
    intitule: tolerantString(2000),
    description: tolerantString(20_000),
    dateCreation: z.string().optional().nullable(),
    dateActualisation: z.string().optional().nullable(),
    lieuTravail: franceTravailLieuTravailSchema.optional().nullable(),
    romeCode: tolerantString(200),
    romeLibelle: tolerantString(200),
    appellationlibelle: tolerantString(200),
    entreprise: franceTravailEntrepriseSchema.optional().nullable(),
    typeContrat: tolerantString(200),
    typeContratLibelle: tolerantString(200),
    natureContrat: tolerantString(200),
    experienceExige: tolerantString(200),
    experienceLibelle: tolerantString(200),
    formations: tolerantArray(franceTravailFormationSchema),
    langues: tolerantArray(franceTravailLangueSchema),
    competences: tolerantArray(franceTravailCompetenceSchema),
    salaire: franceTravailSalaireSchema.optional().nullable(),
    dureeTravailLibelle: tolerantString(200),
    dureeTravailLibelleConverti: tolerantString(200),
    alternance: z.boolean().optional().nullable(),
    contact: franceTravailContactSchema.optional().nullable(),
    nombrePostes: z.number().optional().nullable(),
    accessibleTH: z.boolean().optional().nullable(),
    qualificationCode: tolerantString(200),
    qualificationLibelle: tolerantString(200),
    secteurActivite: tolerantString(200),
    secteurActiviteLibelle: tolerantString(200),
    origineOffre: franceTravailOrigineOffreSchema.optional().nullable(),
    // Absent sur certaines offres (mission d'intérim, apprentissage) : jamais garanti.
    tempsPlein: z.boolean().optional().nullable(),
    deplacementLibelle: tolerantString(200),
  })
  .strip();

export type FranceTravailOffer = z.infer<typeof franceTravailOfferSchema>;

/** Réponse de `GET /offres/search` : `resultats` est absent sur un 204 (aucun résultat). */
export const franceTravailSearchResponseSchema = z
  .object({
    resultats: tolerantArray(franceTravailOfferSchema),
  })
  .strip();

export type FranceTravailSearchResponse = z.infer<typeof franceTravailSearchResponseSchema>;

/** Une commune du référentiel (`GET /referentiel/communes`). */
export const franceTravailCommuneSchema = z
  .object({
    code: z.string().optional().nullable(),
    libelle: z.string().optional().nullable(),
    codePostal: z.string().optional().nullable(),
    codeDepartement: z.string().optional().nullable(),
  })
  .strip();

export type FranceTravailCommune = z.infer<typeof franceTravailCommuneSchema>;
