import {
  coverLetterContentSchema,
  resumeContentSchema,
  COVER_LETTER_MAX_CHARS,
  type CoverLetterContent,
  type CoverLetterTone,
  type ResumeContent,
  type ResumeContentExperience,
  type ResumeTailoringInput,
} from '@jobtrack/shared';
import { stripControlChars } from '../../../common/text/control-chars';
import { canonicalSkill } from '../../matching/scoring/normalize';
import { parseAiOutputOrThrow } from './validation';
import { extractNumbers, extractNumbersDetailed, extractProperNounsDetailed, sentences } from './text-units';

/**
 * Ancrage lexical des reformulations de l'IA (spec §5 : « jamais inventer ») —
 * pur, testé isolément. `groundTailoring` applique la sélection/l'ordre
 * choisis par le modèle puis vérifie chaque texte reformulé contre les
 * sources du profil ; toute reformulation non ancrée est remplacée par le
 * texte de base correspondant.
 */

export interface GroundingResult {
  ok: boolean;
  /** Formes de surface d'origine (pas la clé canonique — revue, pour des messages lisibles). */
  missingNumbers: string[];
  /** Formes de surface d'origine ; pour une entité multi-mots partiellement connue, seuls les mots inconnus. */
  missingTerms: string[];
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Vérifie une entité (éventuellement multi-mots) contre `sourceTerms`
 * (clés canoniques extraites des sources) et `knownTerms` (clés canoniques
 * connues de tout le profil). Revue : une entité multi-mots absente sous sa
 * forme jointe (« Docker Java ») est réévaluée mot par mot — chaque
 * constituant individuellement connu suffit à l'ancrer dans son ensemble ;
 * seuls les constituants effectivement inconnus (« Google Cloud » si ni
 * « Google » ni « Cloud » ne sont connus) sont rapportés comme manquants.
 */
function missingConstituents(
  raw: string,
  canonical: string,
  sourceTerms: ReadonlySet<string>,
  knownTerms: ReadonlySet<string>,
): string[] {
  if (sourceTerms.has(canonical) || knownTerms.has(canonical)) return [];

  const rawParts = raw.split(' ');
  if (rawParts.length <= 1) return [raw];

  return rawParts.filter((rawPart) => {
    const partCanonical = canonicalSkill(rawPart);
    return !sourceTerms.has(partCanonical) && !knownTerms.has(partCanonical);
  });
}

/**
 * `true` si `candidate` ne contient aucun nombre ni nom propre absent des
 * `sources` (texte brut), de `knownNumbers`/`knownTerms` (déjà connus de
 * l'ensemble du profil) — une entité multi-mots inconnue sous sa forme jointe
 * est réévaluée constituant par constituant (`missingConstituents`). Les
 * nombres et noms propres manquants sont renvoyés sous leur forme de surface
 * d'origine (pas la clé canonique), pour construire un message lisible.
 */
export function isGrounded(
  candidate: string,
  sources: readonly string[],
  knownTerms: ReadonlySet<string>,
  knownNumbers: ReadonlySet<string> = new Set(),
): GroundingResult {
  const sourceNumbers = new Set(sources.flatMap((source) => extractNumbers(source)));
  const sourceTerms = new Set(sources.flatMap((source) => extractProperNounsDetailed(source).map((term) => term.canonical)));

  const candidateNumbers = dedupeBy(extractNumbersDetailed(candidate), (number) => number.canonical);
  const missingNumbers = candidateNumbers
    .filter((number) => !sourceNumbers.has(number.canonical) && !knownNumbers.has(number.canonical))
    .map((number) => number.raw);

  const candidateTerms = dedupeBy(extractProperNounsDetailed(candidate), (term) => term.canonical);
  const missingTerms = candidateTerms.flatMap((term) => missingConstituents(term.raw, term.canonical, sourceTerms, knownTerms));

  return { ok: missingNumbers.length === 0 && missingTerms.length === 0, missingNumbers, missingTerms };
}

/** Tous les textes du document de base (spec §5 : « contre le reste du profil ») — dates incluses (revue). */
function collectAllProfileTexts(base: ResumeContent): string[] {
  const texts: string[] = [base.summary];
  if (base.identity.title) texts.push(base.identity.title);

  for (const experience of base.experiences) {
    texts.push(...experienceSources(experience));
    if (experience.location) texts.push(experience.location);
  }
  for (const education of base.educations) {
    texts.push(education.school, education.degree);
    if (education.field) texts.push(education.field);
    if (education.startDate) texts.push(education.startDate);
    if (education.endDate) texts.push(education.endDate);
  }
  for (const certification of base.certifications) {
    texts.push(certification.name, certification.issuer);
    if (certification.issuedAt) texts.push(certification.issuedAt);
  }
  for (const project of base.projects) {
    texts.push(project.name, ...project.technologies);
    if (project.description) texts.push(project.description);
  }
  for (const skill of base.skills) texts.push(skill.name);
  for (const language of base.languages) texts.push(language.name);

  return texts;
}

/**
 * Noms canoniques connus de l'ensemble du profil : compétences, projets et
 * leurs technologies, entreprises — auxquels s'ajoute (revue) tout nom propre
 * détecté dans n'importe quel texte du profil (écoles, émetteurs de
 * certification, puces d'une AUTRE expérience…). Un nom propre reformulé qui
 * y figure est toujours ancré, même absent du texte source précis de
 * l'élément en cours de reformulation (spec §5 : « ou dans les
 * compétences/projets du profil »).
 */
export function buildKnownTerms(content: ResumeContent): Set<string> {
  const terms = new Set<string>();
  for (const skill of content.skills) terms.add(canonicalSkill(skill.name));
  for (const project of content.projects) {
    terms.add(canonicalSkill(project.name));
    for (const technology of project.technologies) terms.add(canonicalSkill(technology));
  }
  for (const experience of content.experiences) terms.add(canonicalSkill(experience.company));

  for (const text of collectAllProfileTexts(content)) {
    for (const term of extractProperNounsDetailed(text)) terms.add(term.canonical);
  }

  return terms;
}

/**
 * Nombres canoniques connus de l'ensemble du profil (revue) — un nombre
 * reformulé qui y figure est ancré même absent des sources précises de
 * l'élément en cours de reformulation (ex. « React 18 » dans le nom d'une
 * compétence rend « 18 » ancré dans n'importe quelle puce).
 */
export function buildKnownNumbers(content: ResumeContent): Set<string> {
  const numbers = new Set<string>();
  for (const text of collectAllProfileTexts(content)) {
    for (const number of extractNumbers(text)) numbers.add(number);
  }
  return numbers;
}

function buildRejectionReason(result: GroundingResult): string {
  const parts: string[] = [];
  if (result.missingNumbers.length > 0) {
    parts.push(`mention non présente dans votre profil : ${result.missingNumbers.join(', ')}`);
  }
  if (result.missingTerms.length > 0) {
    parts.push(`entité non présente : ${result.missingTerms.join(', ')}`);
  }
  return parts.join(' ; ');
}

type HighlightValidation = { ok: true } | { ok: false; reason: string };

const MAX_HIGHLIGHT_LENGTH = 300;

/**
 * Vérifie une puce reformulée : vide ou trop longue → rejet immédiat (avant
 * même de tester l'ancrage), sinon ancrage contre `sources`, `knownTerms` et
 * `knownNumbers`.
 */
function validateHighlight(
  highlight: string,
  sources: readonly string[],
  knownTerms: ReadonlySet<string>,
  knownNumbers: ReadonlySet<string>,
): HighlightValidation {
  const trimmed = highlight.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'reformulation vide' };
  if (trimmed.length > MAX_HIGHLIGHT_LENGTH) {
    return { ok: false, reason: `reformulation trop longue (plus de ${MAX_HIGHLIGHT_LENGTH} caractères)` };
  }
  const result = isGrounded(trimmed, sources, knownTerms, knownNumbers);
  if (result.ok) return { ok: true };
  return { ok: false, reason: buildRejectionReason(result) };
}

/**
 * Textes source d'une expérience (spec §5) : puces de base, intitulé,
 * entreprise, description brute, dates (revue — « depuis 2021 » doit s'ancrer
 * sur la date de début, même absente de toute puce ou description).
 */
function experienceSources(experience: ResumeContentExperience): string[] {
  const sources: string[] = [...experience.highlights, experience.role, experience.company];
  if (experience.sourceDescription) sources.push(experience.sourceDescription);
  if (experience.startDate) sources.push(experience.startDate);
  if (experience.endDate) sources.push(experience.endDate);
  return sources;
}

// ---------------------------------------------------------------------------
// Sélection/ordre (keep/order) — générique aux collections concernées
// ---------------------------------------------------------------------------

interface SelectionRow {
  keep: boolean;
  order?: number;
}

/**
 * Table id → première ligne de la sortie IA portant cet id (première
 * occurrence gagnante) — revue : une seule construction par collection,
 * partagée entre la sélection/l'ordre et (pour les expériences) la lecture
 * des puces reformulées, pour qu'un id dupliqué dans la sortie du modèle ne
 * fasse jamais utiliser deux lignes différentes selon l'usage.
 */
function buildFirstOccurrenceMap<Row extends { id: string }>(rows: readonly Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return map;
}

/**
 * Applique une sélection/ordre (spec §5) à une collection de base à partir
 * d'une table id → ligne partagée (`buildFirstOccurrenceMap`) et d'un
 * accesseur `toSelection` propre à la forme de ligne de la collection : les
 * éléments dotés d'une ligne et `keep: true` sont triés par `order` (ou par
 * leur position de base si `order` est absent — cas formations/
 * certifications, qui n'ont pas ce champ), puis les éléments absents de la
 * table sont ajoutés ensuite, dans leur ordre de base, toujours conservés
 * (« gardent leur position de base après les éléments ordonnés et
 * `keep: true` »).
 */
function applySelection<T extends { id: string }, Row>(
  baseItems: readonly T[],
  rowById: ReadonlyMap<string, Row>,
  toSelection: (row: Row) => SelectionRow,
): T[] {
  const withRow: { item: T; order: number; baseIndex: number }[] = [];
  const withoutRow: T[] = [];

  baseItems.forEach((item, baseIndex) => {
    const row = rowById.get(item.id);
    if (row === undefined) {
      withoutRow.push(item);
      return;
    }
    const selection = toSelection(row);
    if (!selection.keep) return;
    withRow.push({ item, order: selection.order ?? baseIndex, baseIndex });
  });

  withRow.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.baseIndex - b.baseIndex));
  return [...withRow.map((entry) => entry.item), ...withoutRow];
}

// ---------------------------------------------------------------------------
// groundTailoring
// ---------------------------------------------------------------------------

export interface RejectedHighlight {
  experienceId: string;
  index: number;
  reason: string;
  replacement: string;
}

export interface GroundTailoringResult {
  content: ResumeContent;
  rejected: RejectedHighlight[];
  summaryRejected: boolean;
  titleRejected: boolean;
}

/**
 * Applique la sortie de l'adaptation IA au document de base et l'ancre (spec
 * §5) : sélection/ordre des expériences/formations/compétences/certifications/
 * projets, puces reformulées vérifiées (remplacées par la puce de base au
 * même index si rejetées, ou abandonnées si la base n'en a pas à cet index),
 * résumé et titre vérifiés contre l'ensemble du document de base. Le résultat
 * est revalidé par `resumeContentSchema.parse` (dernière garantie de forme).
 */
export function groundTailoring(base: ResumeContent, tailoring: ResumeTailoringInput): GroundTailoringResult {
  const knownTerms = buildKnownTerms(base);
  const knownNumbers = buildKnownNumbers(base);
  const baseSources = collectAllProfileTexts(base);

  const experienceRowById = buildFirstOccurrenceMap(tailoring.experiences);
  const educationRowById = buildFirstOccurrenceMap(tailoring.educations);
  const certificationRowById = buildFirstOccurrenceMap(tailoring.certifications);
  const projectRowById = buildFirstOccurrenceMap(tailoring.projects);
  const skillRowById = buildFirstOccurrenceMap(tailoring.skills);

  const orderedExperiences = applySelection(base.experiences, experienceRowById, (row) => ({ keep: row.keep, order: row.order }));
  const orderedEducations = applySelection(base.educations, educationRowById, (row) => ({ keep: row.keep }));
  const orderedCertifications = applySelection(base.certifications, certificationRowById, (row) => ({ keep: row.keep }));
  const orderedProjects = applySelection(base.projects, projectRowById, (row) => ({ keep: row.keep, order: row.order }));
  const orderedSkills = applySelection(base.skills, skillRowById, (row) => ({ keep: true, order: row.order }));

  const rejected: RejectedHighlight[] = [];

  const groundedExperiences = orderedExperiences.map((experience) => {
    // Même table que la sélection ci-dessus (`experienceRowById`) : la ligne
    // qui a décidé de la position de cette expérience est aussi celle dont
    // les puces sont lues (revue — plus de table séparée divergente).
    const row = experienceRowById.get(experience.id);
    // Aucune ligne, ou aucune puce reformulée proposée : les puces de base
    // sont conservées telles quelles (spec §5 : « une expérience sans
    // highlights garde ceux de la base »).
    if (row === undefined || row.highlights.length === 0) return experience;

    const sources = experienceSources(experience);
    const highlights: string[] = [];

    row.highlights.forEach((highlight, index) => {
      const validation = validateHighlight(highlight, sources, knownTerms, knownNumbers);
      if (validation.ok) {
        highlights.push(highlight);
        return;
      }
      const fallback = experience.highlights[index];
      if (fallback !== undefined) highlights.push(fallback);
      rejected.push({ experienceId: experience.id, index, reason: validation.reason, replacement: fallback ?? '' });
    });

    return { ...experience, highlights };
  });

  let summary = base.summary;
  let summaryRejected = false;
  if (tailoring.summary !== '') {
    const result = isGrounded(tailoring.summary, baseSources, knownTerms, knownNumbers);
    if (result.ok) {
      summary = tailoring.summary;
    } else {
      summaryRejected = true;
    }
  }

  // Titre libre (≤ 120, déjà garanti par `resumeTailoringSchema`) mais sans
  // nombre (spec §5) — seule cette dernière condition dépend du contenu et
  // doit donc être vérifiée ici (revue : la vérification de longueur était
  // du code mort, la borne étant déjà imposée par le type d'entrée).
  let title = base.identity.title;
  let titleRejected = false;
  if (tailoring.title !== '') {
    const hasNumber = extractNumbers(tailoring.title).length > 0;
    if (!hasNumber) {
      title = tailoring.title;
    } else {
      titleRejected = true;
    }
  }

  const content = resumeContentSchema.parse({
    ...base,
    identity: { ...base.identity, title },
    summary,
    experiences: groundedExperiences,
    educations: orderedEducations,
    skills: orderedSkills,
    certifications: orderedCertifications,
    projects: orderedProjects,
  });

  return { content, rejected, summaryRejected, titleRejected };
}

// ---------------------------------------------------------------------------
// groundLetter
// ---------------------------------------------------------------------------

// Phrase de repli neutre (spec §5) : n'invente ni fait ni chiffre, utilisée
// quand toutes les phrases de la lettre ont été retirées faute d'ancrage.
const NEUTRAL_FALLBACK_PARAGRAPH = "Je vous propose d'échanger sur ma candidature.";
// Séparateur entre deux paragraphes dans le rendu final de la lettre — compté
// dans le plafond de longueur par ton (revue), pas seulement le texte brut
// des phrases.
const PARAGRAPH_SEPARATOR_LENGTH = '\n\n'.length;

export interface GroundLetterResult {
  content: CoverLetterContent;
  removedSentences: string[];
}

/** Longueur totale rendue (texte des phrases + séparateurs `\n\n` entre paragraphes non vides). */
function totalLength(paragraphs: readonly string[][]): number {
  const nonEmpty = paragraphs.filter((sentencesInParagraph) => sentencesInParagraph.length > 0);
  const textLength = nonEmpty.reduce((sum, sentencesInParagraph) => sum + sentencesInParagraph.join(' ').length, 0);
  const separatorsLength = Math.max(nonEmpty.length - 1, 0) * PARAGRAPH_SEPARATOR_LENGTH;
  return textLength + separatorsLength;
}

/**
 * Retire des phrases finales (en partant du dernier paragraphe, de sa
 * dernière phrase) jusqu'à respecter `maxChars` — jamais jusqu'à ne plus
 * rien laisser : au moins une phrase est toujours conservée.
 */
function capParagraphsLength(paragraphs: readonly string[][], maxChars: number): string[] {
  const working = paragraphs.map((sentencesInParagraph) => [...sentencesInParagraph]);

  while (totalLength(working) > maxChars) {
    const totalSentenceCount = working.reduce((sum, paragraph) => sum + paragraph.length, 0);
    if (totalSentenceCount <= 1) break;

    for (let i = working.length - 1; i >= 0; i -= 1) {
      const paragraph = working[i];
      if (paragraph !== undefined && paragraph.length > 0) {
        paragraph.pop();
        break;
      }
    }
    for (let i = working.length - 1; i >= 0; i -= 1) {
      if (working[i]?.length === 0) working.splice(i, 1);
    }
  }

  return working.map((sentencesInParagraph) => sentencesInParagraph.join(' '));
}

/**
 * Ancre une lettre de motivation générée par l'IA (spec §5) : chaque
 * paragraphe est assaini (`stripControlChars`) avant d'être découpé en
 * phrases (revue), chaque phrase est vérifiée (nombres/noms propres) contre
 * `sources` (profil + offre), `knownTerms` et `knownNumbers` ; une phrase non
 * ancrée est retirée, un paragraphe vidé de toutes ses phrases est supprimé
 * (repli neutre si la lettre entière se retrouve vide), puis la longueur
 * totale rendue (texte + séparateurs de paragraphe) est plafonnée par ton en
 * retirant des phrases finales. Les champs hors paragraphes sont assainis
 * (`stripControlChars`) sans vérification d'ancrage (spec §5 : ils ne
 * portent pas de fait chiffré ou d'entité inventable au même titre).
 */
export function groundLetter(
  letter: CoverLetterContent,
  sources: readonly string[],
  knownTerms: ReadonlySet<string>,
  tone: CoverLetterTone,
  knownNumbers: ReadonlySet<string> = new Set(),
): GroundLetterResult {
  const removedSentences: string[] = [];

  const paragraphSentences = letter.paragraphs
    .map((paragraph) => stripControlChars(paragraph))
    .map((sanitizedParagraph) =>
      sentences(sanitizedParagraph).filter((sentence) => {
        const result = isGrounded(sentence, sources, knownTerms, knownNumbers);
        if (result.ok) return true;
        removedSentences.push(sentence);
        return false;
      }),
    )
    .filter((sentenceList) => sentenceList.length > 0);

  const paragraphsToCap = paragraphSentences.length > 0 ? paragraphSentences : [[NEUTRAL_FALLBACK_PARAGRAPH]];
  const cappedParagraphs = capParagraphsLength(paragraphsToCap, COVER_LETTER_MAX_CHARS[tone]);

  // `parseAiOutputOrThrow` (jamais `.parse` nu, revue sécurité tâche 5) : un champ requis (ex.
  // `subject`) composé uniquement de caractères de contrôle/bidi est réduit à une chaîne vide par
  // `stripControlChars` ci-dessus — une sortie IA alors non conforme au schéma doit toujours
  // remonter en `AiOutputInvalidError` (502), jamais en `ZodError` brute (500).
  const content = parseAiOutputOrThrow(coverLetterContentSchema, {
    recipient: letter.recipient === null ? null : stripControlChars(letter.recipient),
    subject: stripControlChars(letter.subject),
    greeting: stripControlChars(letter.greeting),
    paragraphs: cappedParagraphs,
    closing: stripControlChars(letter.closing),
    signature: stripControlChars(letter.signature),
  });

  return { content, removedSentences };
}
