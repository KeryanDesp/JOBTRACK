/**
 * Constructeur de ZIP minimal (méthode « stored », sans compression) réservé aux tests
 * unitaires et e2e de ce module : seule la structure (en-têtes locaux, répertoire central,
 * fin de répertoire central) compte pour ces tests, jamais le contenu binaire exact — le
 * CRC32 n'est pas calculé (ni `hasDocxDocumentEntry` ni `mammoth` ne le vérifient).
 */

export interface ZipEntryInput {
  name: string;
  content: Buffer;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
// 1980-01-01, encodage date DOS (valeur arbitraire mais valide — la plus ancienne permise par le format).
const DOS_DATE_1980_01_01 = 0x21;

function localHeader(entry: ZipEntryInput): Buffer {
  const nameBuf = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // version necessaire a l'extraction
  header.writeUInt16LE(0, 6); // indicateurs generaux
  header.writeUInt16LE(0, 8); // methode de compression : stored
  header.writeUInt16LE(0, 10); // heure de derniere modification
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(0, 14); // crc32
  header.writeUInt32LE(entry.content.length, 18); // taille compressee = taille reelle (stored)
  header.writeUInt32LE(entry.content.length, 22); // taille non compressee
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28); // longueur du champ extra
  return Buffer.concat([header, nameBuf, entry.content]);
}

function centralHeader(entry: ZipEntryInput, localOffset: number): Buffer {
  const nameBuf = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // version d'origine
  header.writeUInt16LE(20, 6); // version necessaire a l'extraction
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(0, 16); // crc32
  header.writeUInt32LE(entry.content.length, 20);
  header.writeUInt32LE(entry.content.length, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // commentaire
  header.writeUInt16LE(0, 34); // numero de disque de depart
  header.writeUInt16LE(0, 36); // attributs internes
  header.writeUInt32LE(0, 38); // attributs externes
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, nameBuf]);
}

/** Construit un ZIP minimal valide (méthode stored, une ou plusieurs entrées). */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  for (const entry of entries) {
    offsets.push(cursor);
    const part = localHeader(entry);
    localParts.push(part);
    cursor += part.length;
  }
  const localSection = Buffer.concat(localParts);

  const centralParts = entries.map((entry, index) => centralHeader(entry, offsets[index] ?? 0));
  const centralDirectory = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // numero de ce disque
  eocd.writeUInt16LE(0, 6); // disque du repertoire central
  eocd.writeUInt16LE(entries.length, 8); // entrees sur ce disque
  eocd.writeUInt16LE(entries.length, 10); // entrees totales
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20); // longueur du commentaire

  return Buffer.concat([localSection, centralDirectory, eocd]);
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** DOCX minimal valide (structure ZIP + `word/document.xml`) ; `paragraphs` vide → aucun texte exploitable. */
export function buildDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((text) => `    <w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('\n');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${body}
    <w:sectPr/>
  </w:body>
</w:document>`;

  return buildZip([
    { name: '[Content_Types].xml', content: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(RELS_XML, 'utf8') },
    { name: 'word/document.xml', content: Buffer.from(document, 'utf8') },
  ]);
}
