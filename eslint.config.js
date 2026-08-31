import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// ESLint flat config — recommended baseline, report-only (not wired into the
// build, so it never blocks `npm run build`). Run with `npm run lint`.
export default tseslint.config(
  {
    // Build output, stale artifacts, and dev tooling are out of scope.
    ignores: [
      'dist',
      'dist-electron',
      'node_modules',
      '.workbuddy',
      'scripts',
      'build-*',
      'release',
      'outputs',
      '.verify-build-tmp',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
      'postcss.config.js',
    ],
  },

  // Base JS recommended rules.
  js.configs.recommended,

  // TypeScript recommended rules (scoped to TS/TSX by the config itself).
  ...tseslint.configs.recommended,

  // Application + renderer sources.
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      // React 19 uses the automatic JSX runtime, so React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // Project is TypeScript-first; prop-types are redundant with typed props.
      'react/prop-types': 'off',
      // Report-only: keep unused vars as a warning, not a build-blocking error.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Electron main/preload are CommonJS running in Node.
  {
    files: ['electron/**/*.{js,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.commonjs },
      sourceType: 'commonjs',
    },
  },
)
