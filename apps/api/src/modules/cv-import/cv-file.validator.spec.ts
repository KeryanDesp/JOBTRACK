import { describe, expect, it } from 'vitest';
import { InvalidCvFileError, validateCvFile } from './cv-file.validator';
import { buildDocx, buildZip } from './zip-test-fixtures';

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function pdfBuffer(size = 32): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(Math.max(0, size - 9), 0x20)]);
}

/** DOCX minimal mais structurellement valide (répertoire central + `word/document.xml`). */
function docxBuffer(): Buffer {
  return buildDocx(['Contenu de test']);
}

/** ZIP dont la signature locale passe, mais dont le répertoire central ne contient pas `word/document.xml`. */
function zipWithoutDocumentEntry(): Buffer {
  return buildZip([{ name: 'autre.xml', content: Buffer.from('<x/>', 'utf8') }]);
}

describe('validateCvFile', () => {
  it('accepte un pdf coherent (mime, extension, signature)', () => {
    const result = validateCvFile({ buffer: pdfBuffer(), mimeType: PDF_MIME, fileName: 'cv.pdf' });

    expect(result).toEqual({ mimeType: PDF_MIME, extension: 'pdf', safeName: 'cv.pdf' });
  });

  it('accepte un docx coherent (mime, extension, signature)', () => {
    const result = validateCvFile({ buffer: docxBuffer(), mimeType: DOCX_MIME, fileName: 'mon-cv.docx' });

    expect(result).toEqual({ mimeType: DOCX_MIME, extension: 'docx', safeName: 'mon-cv.docx' });
  });

  it('rejette un fichier depassant 10 Mo', () => {
    const oversized = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]);

    expect(() => validateCvFile({ buffer: oversized, mimeType: PDF_MIME, fileName: 'cv.pdf' })).toThrow(
      InvalidCvFileError,
    );
  });

  it('rejette un fichier vide', () => {
    expect(() => validateCvFile({ buffer: Buffer.alloc(0), mimeType: PDF_MIME, fileName: 'cv.pdf' })).toThrow(
      InvalidCvFileError,
    );
  });

  it('rejette une incoherence entre le mime declare et l_extension', () => {
    expect(() => validateCvFile({ buffer: pdfBuffer(), mimeType: PDF_MIME, fileName: 'cv.docx' })).toThrow(
      InvalidCvFileError,
    );
    expect(() => validateCvFile({ buffer: docxBuffer(), mimeType: DOCX_MIME, fileName: 'cv.pdf' })).toThrow(
      InvalidCvFileError,
    );
  });

  it('rejette une signature binaire qui ne correspond pas au type declare', () => {
    const fakeContent = Buffer.from('ceci nest pas un pdf du tout');

    expect(() => validateCvFile({ buffer: fakeContent, mimeType: PDF_MIME, fileName: 'cv.pdf' })).toThrow(
      InvalidCvFileError,
    );
  });

  it('rejette un docx dont le repertoire central ne contient pas word/document.xml', () => {
    expect(() =>
      validateCvFile({ buffer: zipWithoutDocumentEntry(), mimeType: DOCX_MIME, fileName: 'cv.docx' }),
    ).toThrow(InvalidCvFileError);
  });

  it('rejette un type de fichier non pris en charge', () => {
    expect(() =>
      validateCvFile({ buffer: Buffer.from('bonjour'), mimeType: 'text/plain', fileName: 'notes.txt' }),
    ).toThrow(InvalidCvFileError);
  });

  it('assainit un nom de fichier avec chemin et caracteres de controle', () => {
    const result = validateCvFile({
      buffer: pdfBuffer(),
      mimeType: PDF_MIME,
      fileName: '../../etc/passwd-cv.pdf',
    });

    expect(result.safeName).toBe('passwd-cv.pdf');
    expect(result.safeName).not.toContain('/');
  });

  it('tronque un nom de fichier trop long a 200 caracteres', () => {
    const longName = `${'a'.repeat(250)}.pdf`;
    const result = validateCvFile({ buffer: pdfBuffer(), mimeType: PDF_MIME, fileName: longName });

    expect(result.safeName.length).toBe(200);
  });

  it('retire les caracteres de controle du nom sans jamais les laisser passer', () => {
    const result = validateCvFile({ buffer: pdfBuffer(), mimeType: PDF_MIME, fileName: '.pdf' });

    expect(result.safeName).toBe('.pdf');
  });

  it('retire les controles bidi utilises pour deguiser une extension', () => {
    // U+202E (RTL override) suivi de « fdp.exe » donne l_impression d_un « .pdf » a l_ecran.
    const disguised = `cv\u202Efdp.exe`;
    const result = validateCvFile({ buffer: pdfBuffer(), mimeType: PDF_MIME, fileName: `${disguised}.pdf` });

    expect(result.safeName).not.toContain('\u202E');
  });
});
