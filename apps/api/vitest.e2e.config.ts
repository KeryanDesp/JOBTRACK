import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.e2e.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    // Le démarrage de l'application Nest (Prisma, Redis) peut dépasser 10 s sur une machine
    // chargée ou un exécuteur CI lent : sans cela, tout le fichier est ignoré sur un timeout de hook.
    hookTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
