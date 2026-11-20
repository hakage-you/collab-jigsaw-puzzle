import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/config/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['../core/*', '../services/*', '../net/*', '../app/*', '../ui/*'] },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/config must stay pure.' },
        { name: 'document', message: 'src/config must stay pure.' },
      ],
    },
  },
  {
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../services/*',
            '../net/*',
            '../app/*',
            '../ui/*',
            '**/services/*',
            '**/net/*',
            '**/app/*',
            '**/ui/*',
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'src/core modules must stay pure and must not reference window.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'getElementById',
          message: 'src/core modules must not query DOM elements.',
        },
        {
          object: 'document',
          property: 'querySelector',
          message: 'src/core modules must not query DOM elements.',
        },
        {
          object: 'document',
          property: 'querySelectorAll',
          message: 'src/core modules must not query DOM elements.',
        },
      ],
    },
  },
  {
    files: ['src/services/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['../net/*', '../app/*', '../ui/*', '**/net/*', '**/app/*', '**/ui/*'] },
      ],
    },
  },
  {
    files: ['src/net/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['../app/*', '../ui/*', '**/app/*', '**/ui/*'] },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'getElementById',
          message: 'src/net modules must not query DOM elements.',
        },
        {
          object: 'document',
          property: 'querySelector',
          message: 'src/net modules must not query DOM elements.',
        },
        {
          object: 'document',
          property: 'querySelectorAll',
          message: 'src/net modules must not query DOM elements.',
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['../ui/*', '**/ui/*'] }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/app must not reference window directly.' },
        { name: 'document', message: 'src/app must not reference document directly.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'getElementById',
          message: 'src/app modules must not query DOM elements.',
        },
        {
          object: 'document',
          property: 'querySelector',
          message: 'src/app modules must not query DOM elements.',
        },
        {
          object: 'document',
          property: 'querySelectorAll',
          message: 'src/app modules must not query DOM elements.',
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['../core/*', '../net/*', '**/core/*', '**/net/*'] },
      ],
    },
  },
  {
    files: ['src/ui/main.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../core/*',
            '../net/*',
            '../services/*',
            '../config/*',
            '**/core/*',
            '**/net/*',
            '**/services/*',
            '**/config/*',
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'getElementById',
          message: 'src/ui/main.js must delegate DOM queries to individual View components.',
        },
        {
          object: 'document',
          property: 'querySelector',
          message: 'src/ui/main.js must delegate DOM queries to individual View components.',
        },
        {
          object: 'document',
          property: 'querySelectorAll',
          message: 'src/ui/main.js must delegate DOM queries to individual View components.',
        },
      ],
    },
  },
];
