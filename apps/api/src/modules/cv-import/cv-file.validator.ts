/**
 * Validation d'un fichier de CV envoyé par le client, avant tout stockage ou appel au
 * service d'extraction : taille, cohérence déclarée/réelle du type, et nom de fichier
 * assaini. Ne lit jamais le contenu au-delà des premiers octets (signature) — le reste
 * du document reste opaque à cette étape.
 */

/** Levée pour toute incohérence détectée sur le fichier envoyé ; message français par cas. */
export class InvalidCvFileError extends Error {
  readonly code = 'INVALID_FILE';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidCvFileError';
  }
}

export type CvMimeType = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type CvExtension = 'pdf' | 'docx';

export interface CvFileInput {
  buffer: Buffer;
  /** Type MIME déclaré par le client (en-tête multipart) — jamais fiable seul. */
  mimeType: string;
  /** Nom de fichier déclaré par le client — jamais fiable seul (chemin, caractères de contrôle). */
  fileName: string;
}

export interface ValidatedCvFile {
  mimeType: CvMimeType;
  extension: CvExtension;
  safeName: string;
}

/** Exportee : reutilisee par `CvImportService.capabilities()` (memes limites annoncees que celles appliquees ici). */
export const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;

// `%PDF-` : signature de tout fichier PDF, quelle que soit sa version.
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
// Signature ZIP locale : un DOCX est un ZIP OOXML. On ne va pas plus loin (pas de lecture
// de la table centrale) — la cohérence mime/extension déclarée fait le reste du tri, et
// `mammoth` échouera bruyamment plus tard sur un ZIP qui ne serait pas un vrai DOCX.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const PDF_MIME: CvMimeType = 'application/pdf';
const DOCX_MIME: CvMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Exportee : reutilisee par `CvImportService.capabilities()`, seule source des types acceptes. */
export const ACCEPTED_MIME_TYPES: readonly CvMimeType[] = [PDF_MIME, DOCX_MIME];

function invalid(message: string): never {
  throw new InvalidCvFileError(message);
}

function extensionOf(fileName: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? (match[1] ?? '').toLowerCase() : null;
}

/**
 * Retire les caractères de contrôle (0x00-0x1F, 0x7F) d'une chaîne. Écrit caractère par
 * caractère plutôt qu'avec une classe de caractères de contrôle en regex (bannie par
 * `no-control-regex`, et de toute façon moins lisible qu'une comparaison de code point).
 */
function stripControlChars(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) result += char;
  }
  return result;
}

/**
 * Nom de fichier sûr pour l'affichage et le stockage : dernier segment de chemin
 * uniquement (pas de `/` ni `\`), caractères de contrôle retirés, longueur bornée.
 * Un résultat vide (nom réduit à des séparateurs ou des caractères de contrôle)
 * retombe sur un nom générique plutôt que d'échouer — ce champ n'est qu'un affichage.
 */
function sanitizeName(fileName: string, extension: CvExtension): string {
  const lastSegment = fileName.split(/[\\/]/).pop() ?? '';
  const withoutControlChars = stripControlChars(lastSegment).trim();
  if (withoutControlChars.length === 0) return `cv.${extension}`;
  return withoutControlChars.slice(0, MAX_NAME_LENGTH);
}

/**
 * Valide un fichier candidat à l'import de CV : taille, signature binaire, cohérence entre
 * le type déclaré et l'extension du nom de fichier. Lève `InvalidCvFileError` (code
 * `INVALID_FILE`) au premier problème détecté, avec un message français par cas.
 */
export function validateCvFile(input: CvFileInput): ValidatedCvFile {
  if (input.buffer.length === 0) {
    invalid('Le fichier est vide.');
  }
  if (input.buffer.length > MAX_SIZE_BYTES) {
    invalid('Ce fichier dépasse la taille maximale autorisée (10 Mo).');
  }

  const declaredExtension = extensionOf(input.fileName);

  if (input.mimeType === PDF_MIME || declaredExtension === 'pdf') {
    if (input.mimeType !== PDF_MIME || declaredExtension !== 'pdf') {
      invalid('Le type de fichier déclaré ne correspond pas à son extension.');
    }
    if (!input.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      invalid("Ce fichier n'est pas un PDF valide.");
    }
    return { mimeType: PDF_MIME, extension: 'pdf', safeName: sanitizeName(input.fileName, 'pdf') };
  }

  if (input.mimeType === DOCX_MIME || declaredExtension === 'docx') {
    if (input.mimeType !== DOCX_MIME || declaredExtension !== 'docx') {
      invalid('Le type de fichier déclaré ne correspond pas à son extension.');
    }
    if (!input.buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
      invalid("Ce fichier n'est pas un document Word (.docx) valide.");
    }
    return { mimeType: DOCX_MIME, extension: 'docx', safeName: sanitizeName(input.fileName, 'docx') };
  }

  invalid('Seuls les fichiers PDF ou Word (.docx) sont acceptés.');
}
