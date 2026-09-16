import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Construit la configuration ESLint partagée.
 *
 * `tsconfigRootDir` DOIT être la racine du paquet consommateur : typescript-eslint
 * résout `allowDefaultProject` en chemin relatif à cette racine, avec un minimatch
 * sans `matchBase`. Une racine partagée ferait échouer la correspondance pour tout
 * fichier situé dans un autre paquet, et le lint planterait fatalement.
 *
 * Usage dans un paquet consommateur :
 *   import { createEslintConfig } from '@jobtrack/config/eslint';
 *   export default createEslintConfig(import.meta.dirname);
 */
export function createEslintConfig(tsconfigRootDir) {
  return tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          // `prisma/*.ts` couvre le script de seed, `scripts/*.ts` les autres scripts
          // ponctuels (ex. nettoyage e2e), `e2e/*.ts` les specs e2e : toutes hors du
          // `include` de src. `**` est refusé par typescript-eslint : n'utilise que
          // des motifs simples.
          projectService: {
            allowDefaultProject: ['*.js', '*.config.*', 'prisma/*.ts', 'scripts/*.ts'],
          },
          tsconfigRootDir,
        },
      },
      rules: {
        // Le cahier des charges interdit `any` sauf exception commentée.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': 'error',
      },
    },
    { ignores: ['dist/**', 'build/**', '.turbo/**', 'coverage/**'] },
  );
}
