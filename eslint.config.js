import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import tsdocPlugin from 'eslint-plugin-tsdoc'

export default tseslint.config(
  {
    ignores: ['dist/**', 'docs/**', 'node_modules/**'],
  },
  tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      tsdoc: tsdocPlugin,
    },
    rules: {
      'tsdoc/syntax': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
