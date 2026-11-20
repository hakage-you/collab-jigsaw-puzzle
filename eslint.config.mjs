// ESLint configuration.
// Layer import boundaries are enforced by dependency-cruiser (.dependency-cruiser.cjs) only.
// This file enforces code quality, size limits, and the "no screen DOM access" rule per layer.
// Plan: _plan/20261120_2255_lint_hardening_plan.md
import js from '@eslint/js';
import globals from 'globals';

const SIZE_RULES = {
  'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
  complexity: ['error', 15],
  'max-depth': ['error', 4],
  'max-params': ['error', 5],
  'max-nested-callbacks': ['error', 3],
};

const QUALITY_RULES = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
  'no-var': 'error',
  curly: ['error', 'multi-line'],
  'no-implicit-coercion': 'error',
  'no-param-reassign': 'error',
  'no-shadow': 'error',
  'consistent-return': 'error',
  'require-await': 'error',
  'no-promise-executor-return': 'error',
  'no-await-in-loop': 'error',
  'object-shorthand': 'error',
  'prefer-template': 'error',
  'no-else-return': 'error',
  'default-case-last': 'error',
  'no-unused-private-class-members': 'error',
};

// Screen DOM queries, including access through window / globalThis / self.
const DOM_QUERY_PROPS = ['getElementById', 'querySelector', 'querySelectorAll'];
const DOM_ALIASES = ['window', 'globalThis', 'self'];

function noScreenDom(layer, { allowDocumentGlobal = false } = {}) {
  const message = `${layer} must not access the screen DOM.`;
  return {
    'no-restricted-globals': [
      'error',
      ...(allowDocumentGlobal ? [] : [{ name: 'document', message }]),
      ...(layer === 'src/core' || layer === 'src/app' || layer === 'src/config'
        ? [{ name: 'window', message }]
        : []),
    ],
    'no-restricted-properties': [
      'error',
      ...DOM_QUERY_PROPS.map((property) => ({ object: 'document', property, message })),
      ...DOM_ALIASES.map((object) => ({ object, property: 'document', message })),
    ],
  };
}

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...QUALITY_RULES,
      ...SIZE_RULES,
      'no-console': 'error',
    },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', '*.config.mjs', '.dependency-cruiser.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...QUALITY_RULES,
      ...SIZE_RULES,
    },
  },
  {
    // Vitest tests run in headless Chromium (vitest.config.mjs).
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...QUALITY_RULES,
      ...SIZE_RULES,
      // describe/it callbacks are long and nested by nature.
      'max-lines-per-function': 'off',
      'max-nested-callbacks': ['error', 5],
    },
  },
  {
    files: ['.dependency-cruiser.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },

  // Per-layer DOM restrictions (import boundaries live in dependency-cruiser).
  // core / services may create offscreen canvases via document.createElement, so `document` itself is allowed.
  { files: ['src/config/**/*.js'], rules: noScreenDom('src/config') },
  { files: ['src/core/**/*.js'], rules: noScreenDom('src/core', { allowDocumentGlobal: true }) },
  {
    files: ['src/services/**/*.js'],
    rules: noScreenDom('src/services', { allowDocumentGlobal: true }),
  },
  { files: ['src/net/**/*.js'], rules: noScreenDom('src/net', { allowDocumentGlobal: true }) },
  { files: ['src/app/**/*.js'], rules: noScreenDom('src/app') },
  {
    files: ['src/ui/main.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...DOM_QUERY_PROPS.map((property) => ({
          object: 'document',
          property,
          message: 'src/ui/main.js must delegate DOM queries to individual View components.',
        })),
      ],
    },
  },

  // TEMPORARY EXCEPTIONS: size/complexity rules are off for these high-risk files until
  // tests exist (test plan P1/P2). Remove a file from this list as soon as it is split.
  // See phase 2 in _plan/20261120_2255_lint_hardening_plan.md
  {
    files: ['src/net/guestSession.js', 'src/net/hostSession.js', 'src/app/gameSession.js'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'max-depth': 'off',
      'max-params': 'off',
    },
  },
];
