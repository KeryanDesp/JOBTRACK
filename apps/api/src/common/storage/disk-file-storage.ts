import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';

/**
 * Une clé ne respectant pas ce format n'atteint jamais `path.join` : c'est ce qui
 * interdit toute traversée (`..`, chemin absolu, espaces, majuscules) plutôt que de
 * la neutraliser après coup. Un premier segment sans caractères spéciaux (`userId`
 * ou racine de type), puis d'éventuels sous-segments `[a-z0-9_-]`, puis l'extension.
 */
const KEY_PATTERN = /^[a-z0-9]+(?:\/[a-z0-9_-]+)*\.(pdf|docx)$/;

/** Levée par `get`/`delete` quand la clé n'existe pas sur disque. */
export class FileNotFoundError extends Error {
  constructor(key: string) {
    super(`Fichier introuvable : ${key}`);
    this.name = 'FileNotFoundError';
  }
}

function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Clé de stockage invalide : ${key}`);
  }
}

/**
 * Implémentation disque de `FileStorage`, racine dans `STORAGE_DIR` (par défaut
 * `./storage`, résolue en chemin absolu et créée à la volée — jamais au démarrage,
 * pour ne pas exiger un dossier existant dans les environnements qui ne l'utilisent
 * pas encore).
 */
@Injectable()
export class DiskFileStorage {
  private readonly rootDir: string;

  constructor(rootDir: string = env.STORAGE_DIR) {
    this.rootDir = isAbsolute(rootDir) ? rootDir : resolve(rootDir);
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertValidKey(key);
    const destination = join(this.rootDir, key);
    await mkdir(dirname(destination), { recursive: true });

    // Écriture atomique : fichier temporaire puis renommage, pour qu'un crash ou une
    // lecture concurrente ne voie jamais un fichier partiellement écrit sous la vraie clé.
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, destination);
  }

  async get(key: string): Promise<Buffer> {
    assertValidKey(key);
    const source = join(this.rootDir, key);
    try {
      return await readFile(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    const target = join(this.rootDir, key);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(key);
      }
      throw error;
    }
  }
}
