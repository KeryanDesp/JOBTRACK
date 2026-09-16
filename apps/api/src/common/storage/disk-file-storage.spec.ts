import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskFileStorage, FileNotFoundError } from './disk-file-storage';

let rootDir: string;
let storage: DiskFileStorage;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'jobtrack-storage-'));
  storage = new DiskFileStorage(rootDir);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('DiskFileStorage', () => {
  it('ecrit puis relit le meme contenu', async () => {
    const key = 'cv/user1/abc123.pdf';
    const data = Buffer.from('contenu-de-test');

    await storage.put(key, data);

    expect(await storage.get(key)).toEqual(data);
  });

  it('supprime un fichier puis leve FileNotFoundError a la lecture', async () => {
    const key = 'cv/user1/abc123.docx';
    await storage.put(key, Buffer.from('donnees'));

    await storage.delete(key);

    await expect(storage.get(key)).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('leve FileNotFoundError pour une cle jamais ecrite', async () => {
    await expect(storage.get('cv/user1/inexistant.pdf')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('rejette toute cle hors du format attendu, notamment une traversee de chemin', async () => {
    const invalidKeys = [
      '../../etc/passwd.pdf',
      '/etc/passwd.pdf',
      'cv/user1/../../../etc/passwd.pdf',
      'cv/User1/abc.pdf',
      'cv/user1/abc.exe',
      'sans-extension',
    ];

    for (const key of invalidKeys) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrowError();
      await expect(storage.get(key)).rejects.toThrowError();
    }
  });
});
