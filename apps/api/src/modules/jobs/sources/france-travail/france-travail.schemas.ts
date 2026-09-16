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
    codeFormation: z.string().optional().nullable(),
    domaineLibelle: z.string().optional().nullable(),
    niveauLibelle: z.string().optional().nullable(),
    commentaire: z.string().optional().nullable(),
    exigence: z.string().optional().nullable(),
  })
  .strip();

const franceTravailLangueSchema = z
  .object({
    libelle: z.string().optional().nullable(),
    exigence: z.string().optional().nullable(),
  })
  .strip();

const franceTravailCompetenceSchema = z
  .object({
    code: z.string().optional().nullable(),
    libelle: z.string().optional().nullable(),
    exigence: z.string().optional().nullable(),
  })
  .strip();

const franceTravailLieuTravailSchema = z
  .object({
    libelle: z.string().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    codePostal: z.string().optional().nullable(),
    commune: z.string().optional().nullable(),
  })
  .strip();

const franceTravailEntrepriseSchema = z
  .object({
    nom: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
  })
  .strip();

const franceTravailSalaireSchema = z
  .object({
    libelle: z.string().optional().nullable(),
    commentaire: z.string().optional().nullable(),
    complement1: z.string().optional().nullable(),
    complement2: z.string().optional().nullable(),
  })
  .strip();

const franceTravailContactSchema = z
  .object({
    nom: z.string().optional().nullable(),
    coordonnees1: z.string().optional().nullable(),
    coordonnees2: z.string().optional().nullable(),
    coordonnees3: z.string().optional().nullable(),
    telephone: z.string().optional().nullable(),
    courriel: z.string().optional().nullable(),
    commentaire: z.string().optional().nullable(),
    urlRecruteur: z.string().optional().nullable(),
    urlPostulation: z.string().optional().nullable(),
  })
  .strip();

const franceTravailPartenaireSchema = z
  .object({
    nom: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),
  })
  .strip();

const franceTravailOrigineOffreSchema = z
  .object({
    origine: z.string().optional().nullable(),
    urlOrigine: z.string().optional().nullable(),
    partenaires: tolerantArray(franceTravailPartenaireSchema),
  })
  .strip();

/** Une offre France Travail — tous les champs sont optionnels (spec §4). */
export const franceTravailOfferSchema = z
  .object({
    id: z.string().optional().nullable(),
    intitule: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    dateCreation: z.string().optional().nullable(),
    dateActualisation: z.string().optional().nullable(),
    lieuTravail: franceTravailLieuTravailSchema.optional().nullable(),
    romeCode: z.string().optional().nullable(),
    romeLibelle: z.string().optional().nullable(),
    appellationlibelle: z.string().optional().nullable(),
    entreprise: franceTravailEntrepriseSchema.optional().nullable(),
    typeContrat: z.string().optional().nullable(),
    typeContratLibelle: z.string().optional().nullable(),
    natureContrat: z.string().optional().nullable(),
    experienceExige: z.string().optional().nullable(),
    experienceLibelle: z.string().optional().nullable(),
    formations: tolerantArray(franceTravailFormationSchema),
    langues: tolerantArray(franceTravailLangueSchema),
    competences: tolerantArray(franceTravailCompetenceSchema),
    salaire: franceTravailSalaireSchema.optional().nullable(),
    dureeTravailLibelle: z.string().optional().nullable(),
    dureeTravailLibelleConverti: z.string().optional().nullable(),
    alternance: z.boolean().optional().nullable(),
    contact: franceTravailContactSchema.optional().nullable(),
    nombrePostes: z.number().optional().nullable(),
    accessibleTH: z.boolean().optional().nullable(),
    qualificationCode: z.string().optional().nullable(),
    qualificationLibelle: z.string().optional().nullable(),
    secteurActivite: z.string().optional().nullable(),
    secteurActiviteLibelle: z.string().optional().nullable(),
    origineOffre: franceTravailOrigineOffreSchema.optional().nullable(),
    // Absent sur certaines offres (mission d'intérim, apprentissage) : jamais garanti.
    tempsPlein: z.boolean().optional().nullable(),
    deplacementLibelle: z.string().optional().nullable(),
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
