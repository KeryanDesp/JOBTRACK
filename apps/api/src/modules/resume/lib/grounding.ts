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
import { extractNumbers, extractProperNouns, sentences } from './text-units';

/**
 * Ancrage lexical des reformulations de l'IA (spec §5 : « jamais inventer ») —
 * pur, testé isolément. `groundTailoring` applique la sélection/l'ordre
 * choisis par le modèle puis vérifie chaque texte reformulé contre les
 * sources du profil ; toute reformulation non ancrée est remplacée par le
 * texte de base correspondant.
 */

export interface GroundingResult {
  ok: boolean;
  missingNumbers: string[];
  missingTerms: string[];
}

/**
 * `true` si `candidate` ne contient aucun nombre ni nom propre absent des
 * `sources` (texte brut) ou de `knownTerms` (clés canoniques déjà connues du
 * profil entier — compétences, projets, entreprises). Les nombres et noms
 * propres manquants sont renvoyés (formes canoniques) pour construire un
 * message d'explication.
 */
export function isGrounded(candidate: string, sources: readonly string[], knownTerms: ReadonlySet<string>): GroundingResult {
  const sourceNumbers = new Set(sources.flatMap((source) => extractNumbers(source)));
  const sourceTerms = new Set(sources.flatMap((source) => extractProperNouns(source)));

  const missingNumbers = [...new Set(extractNumbers(candidate))].filter((number) => !sourceNumbers.has(number));
  const missingTerms = [...new Set(extractProperNouns(candidate))].filter(
    (term) => !sourceTerms.has(term) && !knownTerms.has(term),
  );

  return { ok: missingNumbers.length === 0 && missingTerms.length === 0, missingNumbers, missingTerms };
}

/**
 * Noms canoniques (compétences, technologies de projets, entreprises) connus
 * de l'ensemble du profil — un nom propre reformulé qui y figure est toujours
 * ancré, même absent du texte source précis de l'expérience concernée (spec
 * §5 : « ou dans les compétences/projets du profil »).
 */
export function buildKnownTerms(content: ResumeContent): Set<string> {
  const terms = new Set<string>();
  for (const skill of content.skills) terms.add(canonicalSkill(skill.name));
  for (const project of content.projects) {
    terms.add(canonicalSkill(project.name));
    for (const technology of project.technologies) terms.add(canonicalSkill(technology));
  }
  for (const experience of content.experiences) terms.add(canonicalSkill(experience.company));
  return terms;
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
 * même de tester l'ancrage), sinon ancrage contre `sources` et `knownTerms`.
 */
function validateHighlight(
  highlight: string,
  sources: readonly string[],
  knownTerms: ReadonlySet<string>,
): HighlightValidation {
  const trimmed = highlight.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'reformulation vide' };
  if (trimmed.length > MAX_HIGHLIGHT_LENGTH) {
    return { ok: false, reason: `reformulation trop longue (plus de ${MAX_HIGHLIGHT_LENGTH} caractères)` };
  }
  const result = isGrounded(trimmed, sources, knownTerms);
  if (result.ok) return { ok: true };
  return { ok: false, reason: buildRejectionReason(result) };
}

/** Textes source d'une expérience (spec §5) : puces de base, intitulé, entreprise, description brute. */
function experienceSources(experience: ResumeContentExperience): string[] {
  const sources: string[] = [...experience.highlights, experience.role, experience.company];
  if (experience.sourceDescription) sources.push(experience.sourceDescription);
  return sources;
}

/** Tous les textes du document de base — sources pour l'ancrage du résumé (spec §5 : « contre le reste du profil »). */
function collectBaseSourceTexts(base: ResumeContent): string[] {
  const texts: string[] = [base.summary];
  if (base.identity.title) texts.push(base.identity.title);

  for (const experience of base.experiences) {
    texts.push(...experienceSources(experience));
    if (experience.location) texts.push(experience.location);
  }
  for (const education of base.educations) {
    texts.push(education.school, education.degree);
    if (education.field) texts.push(education.field);
  }
  for (const certification of base.certifications) {
    texts.push(certification.name, certification.issuer);
  }
  for (const project of base.projects) {
    texts.push(project.name, ...project.technologies);
    if (project.description) texts.push(project.description);
  }
  for (const skill of base.skills) texts.push(skill.name);
  for (const language of base.languages) texts.push(language.name);

  return texts;
}

// ---------------------------------------------------------------------------
// Sélection/ordre (keep/order) — générique aux quatre collections concernées
// ---------------------------------------------------------------------------

interface SelectionRow {
  keep: boolean;
  order?: number;
}

function buildRowMap<Row extends { id: string }>(
  rows: readonly Row[],
  toSelectionRow: (row: Row) => SelectionRow,
): Map<string, SelectionRow> {
  const map = new Map<string, SelectionRow>();
  for (const row of rows) {
    // Première occurrence d'un id retenue ; les identifiants inconnus du
    // profil de base ne sont jamais recherchés dans cette table par
    // `applySelection` (elle interroge uniquement par id de base), donc
    // ignorés de fait.
    if (!map.has(row.id)) map.set(row.id, toSelectionRow(row));
  }
  return map;
}

/**
 * Applique une sélection/ordre (spec §5) à une collection de base : les
 * éléments dotés d'une ligne dans `rows` et `keep: true` sont triés par
 * `order` (ou par leur position de base si `order` est absent — cas
 * formations/certifications, qui n'ont pas de champ `order`), puis les
 * éléments absents de `rows` sont ajoutés ensuite, dans leur ordre de base,
 * toujours conservés (« gardent leur position de base après les éléments
 * ordonnés et `keep: true` »).
 */
function applySelection<T extends { id: string }>(baseItems: readonly T[], rows: ReadonlyMap<string, SelectionRow>): T[] {
  const withRow: { item: T; order: number; baseIndex: number }[] = [];
  const withoutRow: T[] = [];

  baseItems.forEach((item, baseIndex) => {
    const row = rows.get(item.id);
    if (row === undefined) {
      withoutRow.push(item);
      return;
    }
    if (!row.keep) return;
    withRow.push({ item, order: row.order ?? baseIndex, baseIndex });
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

const MAX_TITLE_LENGTH = 120;

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
  const baseSources = collectBaseSourceTexts(base);

  const experienceRows = buildRowMap(tailoring.experiences, (row) => ({ keep: row.keep, order: row.order }));
  const educationRows = buildRowMap(tailoring.educations, (row) => ({ keep: row.keep }));
  const certificationRows = buildRowMap(tailoring.certifications, (row) => ({ keep: row.keep }));
  const projectRows = buildRowMap(tailoring.projects, (row) => ({ keep: row.keep, order: row.order }));
  const skillRows = buildRowMap(tailoring.skills, (row) => ({ keep: true, order: row.order }));

  const orderedExperiences = applySelection(base.experiences, experienceRows);
  const orderedEducations = applySelection(base.educations, educationRows);
  const orderedCertifications = applySelection(base.certifications, certificationRows);
  const orderedProjects = applySelection(base.projects, projectRows);
  const orderedSkills = applySelection(base.skills, skillRows);

  const rejected: RejectedHighlight[] = [];
  const experienceTailoringById = new Map(tailoring.experiences.map((row) => [row.id, row] as const));

  const groundedExperiences = orderedExperiences.map((experience) => {
    const row = experienceTailoringById.get(experience.id);
    // Aucune ligne, ou aucune puce reformulée proposée : les puces de base
    // sont conservées telles quelles (spec §5 : « une expérience sans
    // highlights garde ceux de la base »).
    if (row === undefined || row.highlights.length === 0) return experience;

    const sources = experienceSources(experience);
    const highlights: string[] = [];

    row.highlights.forEach((highlight, index) => {
      const validation = validateHighlight(highlight, sources, knownTerms);
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
    const result = isGrounded(tailoring.summary, baseSources, knownTerms);
    if (result.ok) {
      summary = tailoring.summary;
    } else {
      summaryRejected = true;
    }
  }

  let title = base.identity.title;
  let titleRejected = false;
  if (tailoring.title !== '') {
    const hasNumber = extractNumbers(tailoring.title).length > 0;
    if (!hasNumber && tailoring.title.length <= MAX_TITLE_LENGTH) {
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

export interface GroundLetterResult {
  content: CoverLetterContent;
  removedSentences: string[];
}

function totalLength(paragraphs: readonly string[][]): number {
  return paragraphs.reduce((sum, sentencesInParagraph) => sum + sentencesInParagraph.join(' ').length, 0);
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
 * Ancre une lettre de motivation générée par l'IA (spec §5) : chaque phrase
 * de chaque paragraphe est vérifiée (nombres/noms propres) contre `sources`
 * (profil + offre) et `knownTerms` ; une phrase non ancrée est retirée, un
 * paragraphe vidé de toutes ses phrases est supprimé (repli neutre si la
 * lettre entière se retrouve vide), puis la longueur totale est plafonnée par
 * ton en retirant des phrases finales. Les champs hors paragraphes sont
 * assainis (`stripControlChars`) sans vérification d'ancrage (spec §5 : ils
 * ne portent pas de fait chiffré ou d'entité inventable au même titre).
 */
export function groundLetter(
  letter: CoverLetterContent,
  sources: readonly string[],
  knownTerms: ReadonlySet<string>,
  tone: CoverLetterTone,
): GroundLetterResult {
  const removedSentences: string[] = [];

  const paragraphSentences = letter.paragraphs
    .map((paragraph) =>
      sentences(paragraph).filter((sentence) => {
        const result = isGrounded(sentence, sources, knownTerms);
        if (result.ok) return true;
        removedSentences.push(sentence);
        return false;
      }),
    )
    .filter((sentenceList) => sentenceList.length > 0);

  const paragraphsToCap = paragraphSentences.length > 0 ? paragraphSentences : [[NEUTRAL_FALLBACK_PARAGRAPH]];
  const cappedParagraphs = capParagraphsLength(paragraphsToCap, COVER_LETTER_MAX_CHARS[tone]);

  const content = coverLetterContentSchema.parse({
    recipient: letter.recipient === null ? null : stripControlChars(letter.recipient),
    subject: stripControlChars(letter.subject),
    greeting: stripControlChars(letter.greeting),
    paragraphs: cappedParagraphs,
    closing: stripControlChars(letter.closing),
    signature: stripControlChars(letter.signature),
  });

  return { content, removedSentences };
}
