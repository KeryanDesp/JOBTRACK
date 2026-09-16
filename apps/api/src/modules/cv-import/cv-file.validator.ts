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
// Signature ZIP locale : un DOCX est un ZIP OOXML.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// Fin de répertoire central (« End Of Central Directory ») et en-tête d'entrée du répertoire
// central : signatures fixes du format ZIP, indépendantes du contenu des entrées.
const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_DIRECTORY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const EOCD_MIN_LENGTH = 22;
const CENTRAL_HEADER_MIN_LENGTH = 46;
const REQUIRED_DOCX_ENTRY = 'word/document.xml';

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
 * Contrôles de direction de texte (« bidi override », U+202A-U+202E et U+2066-U+2069) :
 * détournés pour déguiser une extension (ex. faire lire « exe.gpj » comme « cv.jpg » à
 * l'écran). Un nom de fichier affiché tel quel ne doit jamais en contenir.
 */
function isBidiOverride(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/**
 * Retire les caractères de contrôle (0x00-0x1F, 0x7F) et les contrôles bidi d'une chaîne.
 * Écrit caractère par caractère plutôt qu'avec une classe de caractères de contrôle en
 * regex (bannie par `no-control-regex`, et de toute façon moins lisible qu'une comparaison
 * de code point).
 */
function stripControlChars(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isAsciiControl = code < 0x20 || code === 0x7f;
    if (!isAsciiControl && !isBidiOverride(code)) result += char;
  }
  return result;
}

/**
 * Confirme la présence de `word/document.xml` dans le **répertoire central** du ZIP (pas
 * seulement la signature locale déjà vérifiée par `ZIP_MAGIC`) : un DOCX authentique la
 * porte toujours, un ZIP quelconque renommé en `.docx` ne l'a en général pas. Lit la fin de
 * répertoire central (EOCD) pour localiser le répertoire central, puis parcourt ses entrées
 * à la recherche du nom exact. Toute incohérence de structure (EOCD absente, décalages hors
 * limites, entrée tronquée) fait renvoyer `false` plutôt que de lever — un DOCX corrompu est
 * simplement invalide, jamais une exception qui ferait planter la requête.
 *
 * ZIP64 (tailles/décalages étendus au-delà de 4 Go, valeurs 32 bits à `0xFFFFFFFF` complétées
 * par un champ extra) n'est délibérément pas géré : sans objet sous la limite de 10 Mo
 * (`MAX_SIZE_BYTES`, vérifiée avant d'atteindre cette fonction) — un DOCX qui en porterait
 * quand même échoue simplement cette lecture (repli sur `false`), jamais une lecture erronée.
 */
function hasDocxDocumentEntry(buffer: Buffer): boolean {
  if (buffer.length < EOCD_MIN_LENGTH) return false;
  const eocdOffset = buffer.lastIndexOf(EOCD_SIGNATURE, buffer.length - EOCD_MIN_LENGTH);
  if (eocdOffset === -1) return false;

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) return false;

  let cursor = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (cursor + CENTRAL_HEADER_MIN_LENGTH <= end) {
    if (!buffer.subarray(cursor, cursor + 4).equals(CENTRAL_DIRECTORY_SIGNATURE)) return false;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const nameStart = cursor + CENTRAL_HEADER_MIN_LENGTH;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) return false;
    if (buffer.toString('utf8', nameStart, nameEnd) === REQUIRED_DOCX_ENTRY) return true;
    cursor = nameEnd + extraLength + commentLength;
  }
  return false;
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
    if (!hasDocxDocumentEntry(input.buffer)) {
      invalid('Ce fichier DOCX est invalide.');
    }
    return { mimeType: DOCX_MIME, extension: 'docx', safeName: sanitizeName(input.fileName, 'docx') };
  }

  invalid('Seuls les fichiers PDF ou Word (.docx) sont acceptés.');
}
