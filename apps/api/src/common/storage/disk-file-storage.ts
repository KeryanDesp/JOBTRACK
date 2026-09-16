import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { type FileStorage } from './file-storage';

/**
 * Une clé ne respectant pas ce format n'atteint jamais `path.join` : c'est ce qui
 * interdit toute traversée (`..`, chemin absolu, espaces, majuscules) plutôt que de
 * la neutraliser après coup. Chaque segment est en `[a-z0-9_-]` (un `userId` Prisma
 * `cuid()` aujourd'hui, un `uuid()` demain sans changer ce motif), puis l'extension.
 */
const KEY_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.(pdf|docx)$/;

/** Levée par `get` quand la clé n'existe pas sur disque. */
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
 * Remonte l'arborescence depuis `startDir` jusqu'au dossier contenant `pnpm-workspace.yaml`
 * (racine du monorepo). Sans ce repère, `STORAGE_DIR` relatif serait résolu contre
 * `process.cwd()` — qui vaut `apps/api` sous `nest --watch` lancé avec ce filtre, pas la
 * racine du dépôt — et les fichiers atterriraient hors de tout `.gitignore` prévu pour eux.
 */
function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      // Aucun pnpm-workspace.yaml trouvé en remontant : on retombe sur le point de
      // départ plutôt que d'échouer silencieusement sur une racine arbitraire.
      return startDir;
    }
    dir = parent;
  }
  return dir;
}

/** Un chemin absolu est renvoyé tel quel ; un chemin relatif est résolu depuis la racine du monorepo. */
export function resolveStorageRoot(rootDir: string): string {
  return isAbsolute(rootDir) ? rootDir : resolve(findMonorepoRoot(process.cwd()), rootDir);
}

/**
 * Implémentation disque de `FileStorage`, racine dans `STORAGE_DIR` (par défaut
 * `./storage`, résolue en chemin absolu et créée à la volée — jamais au démarrage,
 * pour ne pas exiger un dossier existant dans les environnements qui ne l'utilisent
 * pas encore).
 */
@Injectable()
export class DiskFileStorage implements FileStorage {
  private readonly rootDir: string;

  constructor(rootDir: string = env.STORAGE_DIR) {
    this.rootDir = resolveStorageRoot(rootDir);
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertValidKey(key);
    const destination = join(this.rootDir, key);
    await mkdir(dirname(destination), { recursive: true });

    // Écriture atomique : fichier temporaire puis renommage, pour qu'un crash ou une
    // lecture concurrente ne voie jamais un fichier partiellement écrit sous la vraie clé.
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, data);
    try {
      await rename(temporary, destination);
    } finally {
      // Best effort : si le renommage a échoué, ne pas laisser le temporaire traîner.
      // S'il a réussi, le fichier n'existe plus à ce chemin — l'erreur ENOENT est ignorée.
      await unlink(temporary).catch(() => undefined);
    }
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
      // Idempotent : supprimer une clé déjà absente (double appel, ou brouillon déjà
      // nettoyé) n'est pas une erreur pour un appelant qui veut juste « qu'il n'y soit plus ».
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}
