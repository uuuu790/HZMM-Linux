import js from '@eslint/js'
import globals from 'globals'
import n from 'eslint-plugin-n'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

const mainProcessFiles = ['src/main/**/*.js', 'src/preload/**/*.js']
const rendererFiles = ['src/renderer/src/**/*.{js,jsx}']

export default [
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'resources/**',
      'docs/**',
      'tests/fixtures/**',
      'coverage/**',
    ],
  },

  js.configs.recommended,

  // Main process + preload — Node/Electron environment
  {
    files: mainProcessFiles,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: { n },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'warn',
      'require-await': 'warn',
      'no-throw-literal': 'error',
      'no-return-await': 'warn',
      'prefer-promise-reject-errors': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      // Electron/Node hygiene
      'n/no-deprecated-api': 'warn',
      'n/no-process-exit': 'warn',
      // Security-ish — ban child_process string exec with template literals
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='child_process'][callee.property.name='exec'] > TemplateLiteral",
          message:
            'child_process.exec with template literal is injection-prone — use spawn with argv array instead',
        },
        {
          selector:
            "CallExpression[callee.property.name='exec'][arguments.0.type='TemplateLiteral']",
          message:
            'exec with template literal is injection-prone — use spawn with argv array instead',
        },
      ],
    },
  },

  // Renderer — React + browser environment
  {
    files: rendererFiles,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  // Config files — allow require/module
  {
    files: ['*.config.js', '*.config.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
