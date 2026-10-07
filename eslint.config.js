import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-prof/**', '.vite-cache/**', 'node_modules/**', 'coverage/**', '.tmp/**',
    // Snippets evaluated inside a page by the knob driver (expressions, not modules).
    'scripts/bench/knobs/*.js', 'scripts/bench/perfgpu/*.js'] },
  js.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'requestAnimationFrame', 'localStorage', 'sessionStorage'],
      'no-restricted-imports': ['error', { patterns: [{ group: ['three', 'three/**', 'react', 'react/**', 'react-dom', 'react-dom/**', '**/game/**', '**/render/**', '**/flight/**', '**/ui/**', '**/editor/**', '**/net/**', '**/tutorial/**', '**/input/**', '**/audio/**'], message: 'Simulation must remain headless; pass application state through explicit inputs.' }] }],
    },
  },
);
