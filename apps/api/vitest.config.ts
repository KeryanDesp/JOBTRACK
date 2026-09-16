import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/*.e2e.spec.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
