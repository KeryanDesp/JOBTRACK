import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CvImport } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { cvExtractionSchema, type CvCapabilities, type CvExtraction, type CvImportDto } from '@jobtrack/shared';
import { ANTHROPIC_CLIENT, type AnthropicClient } from '../../common/anthropic.provider';
import { PrismaService } from '../../common/prisma.service';
import { FileNotFoundError } from '../../common/storage/disk-file-storage';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage';
import { AiNotConfiguredError, AiUnavailableError, CvTooLongError, CvUnreadableError } from './cv-extraction.errors';
import { CvExtractionService, type CvExtractionInput } from './cv-extraction.service';
import {
  ACCEPTED_MIME_TYPES,
  InvalidCvFileError,
  MAX_SIZE_BYTES,
  validateCvFile,
  type CvFileInput,
  type ValidatedCvFile,
} from './cv-file.validator';

/** Entree brute du controleur : fichier tel que reçu du multipart, avant toute validation. */
export type CvUploadInput = CvFileInput;

/**
 * Au-delà de cette durée, un import `PENDING` n'est plus considéré « en cours » : l'extraction
 * est synchrone (quelques secondes à ~30s en pratique), un `PENDING` plus vieux ne peut venir
 * que d'une requête interrompue (crash, redémarrage) — jamais d'un traitement toujours actif.
 * Le laisser bloquer indéfiniment le prochain upload de l'utilisateur serait un verrou permanent.
 */
const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * Orchestre le cycle de vie d'un import de CV : validation du fichier, stockage disque,
 * extraction (synchrone) via Claude, brouillon persiste. `apply` (transaction profil/collections)
 * vit dans `CvApplyService`, ce service ne s'occupe que du cycle upload → brouillon → suppression.
 */
@Injectable()
export class CvImportService {
  private readonly logger = new Logger(CvImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: CvExtractionService,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClient,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /** `ai: false` quand aucune clé Anthropic n'est configurée : seule information exposée côté client. */
  capabilities(): CvCapabilities {
    return { ai: this.client !== null, maxSizeBytes: MAX_SIZE_BYTES, acceptedTypes: [...ACCEPTED_MIME_TYPES] };
  }

  /**
   * Valide, stocke puis extrait de façon synchrone. Sans client configuré : 503 avant tout
   * stockage (aucune trace du fichier envoyé). Une extraction qui échoue pour une raison
   * couverte (document trop long, illisible, service Anthropic indisponible) ne fait pas
   * échouer la requête : le brouillon passe à `FAILED` avec un message français, le fichier
   * est conservé pour un `retry`.
   */
  async create(userId: string, input: CvUploadInput): Promise<CvImportDto> {
    if (!this.client) throw this.aiNotConfigured();

    const validated = this.validate(input);
    await this.rejectIfInProgress(userId);

    // `randomUUID` (minuscules, chiffres, tirets) respecte le format de clé de `DiskFileStorage`
    // (`KEY_PATTERN`) sans dépendance supplémentaire — un identifiant unique suffit ici, la clé
    // n'a pas besoin d'être un `cuid` Prisma.
    const storageKey = `${userId}/${randomUUID()}.${validated.extension}`;
    await this.storage.put(storageKey, input.buffer);

    let row: CvImport;
    try {
      row = await this.prisma.cvImport.create({
        data: {
          userId,
          fileName: validated.safeName,
          mimeType: validated.mimeType,
          sizeBytes: input.buffer.length,
          storageKey,
          status: 'PENDING',
        },
      });
    } catch (error) {
      // Le fichier ne doit jamais survivre sans ligne qui le référence — la ligne n'existe
      // pas encore, il n'y a donc rien d'autre à défaire.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }

    return this.runExtraction(row, input.buffer, validated.mimeType);
  }

  async get(userId: string, importId: string): Promise<CvImportDto> {
    const row = await this.findOwned(userId, importId);
    return this.toDto(row);
  }

  /** Imports de l'utilisateur, du plus récent au plus ancien — lui permet de retrouver et
   * supprimer lui-même un `PENDING` qu'il jugerait bloqué, sans dépendre du délai de péremption. */
  async list(userId: string): Promise<CvImportDto[]> {
    const rows = await this.prisma.cvImport.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Un `PENDING` de moins de `STALE_PENDING_MS` bloque un nouvel upload (409) : l'extraction
   * synchrone en cours ne doit pas être doublée. Un `PENDING` plus vieux ne peut être qu'une
   * requête interrompue : il est basculé en `FAILED` (fichier conservé) plutôt que de bloquer
   * l'utilisateur indéfiniment.
   */
  private async rejectIfInProgress(userId: string): Promise<void> {
    const pending = await this.prisma.cvImport.findMany({
      where: { userId, status: 'PENDING' },
      select: { id: true, createdAt: true },
    });
    if (pending.length === 0) return;

    const cutoff = new Date(Date.now() - STALE_PENDING_MS);
    const stillRunning = pending.filter((row) => row.createdAt >= cutoff);
    const stale = pending.filter((row) => row.createdAt < cutoff);

    for (const row of stale) {
      await this.prisma.cvImport.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: 'Analyse interrompue. Réessayez.' },
      });
    }

    if (stillRunning.length > 0) {
      throw new ConflictException({
        code: 'IMPORT_IN_PROGRESS',
        message: "Un import est déjà en cours. Attendez qu'il se termine avant d'en démarrer un autre.",
      });
    }
  }

  /** Relance l'extraction d'un import en échec, à partir du fichier déjà stocké. */
  async retry(userId: string, importId: string): Promise<CvImportDto> {
    const row = await this.findOwned(userId, importId);
    if (row.status !== 'FAILED') {
      throw new ConflictException({
        code: 'RETRY_NOT_ALLOWED',
        message: 'Seul un import en échec peut être relancé.',
      });
    }
    if (!this.client) throw this.aiNotConfigured();

    const buffer = await this.storage.get(row.storageKey);
    // La colonne ne contient jamais que l'une des deux valeurs validées à l'upload (voir `create`) :
    // seul cast documenté du fichier, la surface Prisma (`string`) ne porte pas ce raffinement.
    const mimeType = row.mimeType as CvExtractionInput['mimeType'];
    return this.runExtraction(row, buffer, mimeType);
  }

  async remove(userId: string, importId: string): Promise<void> {
    const row = await this.findOwned(userId, importId);
    try {
      await this.storage.delete(row.storageKey);
    } catch (error) {
      if (!(error instanceof FileNotFoundError)) throw error;
    }
    await this.prisma.cvImport.delete({ where: { id: row.id } });
  }

  private validate(input: CvUploadInput): ValidatedCvFile {
    try {
      return validateCvFile(input);
    } catch (error) {
      // Seule `InvalidCvFileError` porte un message français destiné au client ; toute autre
      // erreur (bug dans le validateur) doit remonter telle quelle, jamais être maquillée en 400.
      if (!(error instanceof InvalidCvFileError)) throw error;
      throw new BadRequestException({ code: 'INVALID_FILE', message: error.message });
    }
  }

  /**
   * Extrait puis persiste le résultat.
   * - `AiNotConfiguredError` (clé révoquée entre la garde initiale de `create`/`retry` et cet
   *   appel — rare, mais possible) et `AiUnavailableError` (panne transitoire côté Anthropic)
   *   annulent tout : rollback (ligne + fichier) puis 503, pour ne jamais consommer le quota de
   *   3 imports/heure sur un import qui n'a jamais pu tourner.
   * - `CvTooLongError`/`CvUnreadableError` (document illisible, refus du modèle) deviennent un
   *   brouillon `FAILED` : le fichier reste disponible pour un `retry`.
   * - Toute autre erreur (bug, panne non couverte) devient elle aussi un brouillon `FAILED` —
   *   jamais un 500 qui laisserait la ligne bloquée en `PENDING` — mais est journalisée en
   *   `error` (jamais le contenu du CV) pour rester diagnosticable.
   */
  private async runExtraction(
    row: CvImport,
    buffer: Buffer,
    mimeType: CvExtractionInput['mimeType'],
  ): Promise<CvImportDto> {
    try {
      const result = await this.extraction.extract({ buffer, mimeType });
      const updated = await this.prisma.cvImport.update({
        where: { id: row.id },
        data: {
          status: 'EXTRACTED',
          extracted: this.toJson(result.extraction),
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          extractedAt: new Date(),
          error: null,
        },
      });
      return this.toDto(updated);
    } catch (error) {
      if (error instanceof AiNotConfiguredError) {
        await this.rollback(row);
        throw this.aiNotConfigured();
      }
      if (error instanceof AiUnavailableError) {
        await this.rollback(row);
        throw this.aiUnavailable(error.message);
      }
      if (error instanceof CvTooLongError || error instanceof CvUnreadableError) {
        return this.markFailed(row, error.message);
      }

      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Extraction CV en échec inattendu pour l'import ${row.id}.`, stack);
      return this.markFailed(row, "L'analyse du document a échoué. Réessayez.");
    }
  }

  private async markFailed(row: CvImport, message: string): Promise<CvImportDto> {
    const updated = await this.prisma.cvImport.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: message },
    });
    return this.toDto(updated);
  }

  /** Efface la trace (fichier + ligne) d'un import qui n'a jamais pu être extrait — best effort. */
  private async rollback(row: CvImport): Promise<void> {
    await this.prisma.cvImport.delete({ where: { id: row.id } }).catch(() => undefined);
    await this.storage.delete(row.storageKey).catch(() => undefined);
  }

  private async findOwned(userId: string, importId: string): Promise<CvImport> {
    const row = await this.prisma.cvImport.findUnique({ where: { id: importId } });
    if (!row || row.userId !== userId) throw this.notFound();
    return row;
  }

  /** Sérialisation documentée pour un `Prisma.InputJsonValue` : l'extraction n'est que des
   * chaînes/nombres/booléens/tableaux/objets imbriqués, jamais de `Date` ni de fonction. */
  private toJson(extraction: CvExtraction): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(extraction)) as Prisma.InputJsonValue;
  }

  /** N'expose jamais `storageKey` ; un brouillon illisible (schéma changé, corruption) redevient `null`. */
  private toDto(row: CvImport): CvImportDto {
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      extracted: this.parseExtracted(row),
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseExtracted(row: CvImport): CvExtraction | null {
    if (row.extracted === null) return null;
    const result = cvExtractionSchema.safeParse(row.extracted);
    if (!result.success) {
      this.logger.warn(`Brouillon d'extraction illisible pour l'import ${row.id} (schéma incompatible).`);
      return null;
    }
    return result.data;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import de CV introuvable.' });
  }

  private aiNotConfigured(): HttpException {
    return new HttpException(
      { code: 'AI_NOT_CONFIGURED', message: "Le service d'analyse de CV n'est pas configuré." },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private aiUnavailable(message: string): HttpException {
    return new HttpException({ code: 'AI_UNAVAILABLE', message }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
