/** Jeton d'injection : découple les consommateurs de l'implémentation disque. */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Stockage de fichiers binaires (CV importés). Une seule implémentation aujourd'hui
 * (disque), mais l'interface permet de la remplacer (S3, etc.) sans toucher les
 * consommateurs.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
