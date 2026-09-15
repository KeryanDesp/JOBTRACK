import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.config.*'] },
        tsconfigRootDir: import.meta.dirname,
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
