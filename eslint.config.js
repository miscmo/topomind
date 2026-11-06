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
      // gitignore 的临时测试产物（.graph-store-test-*）：不是产品代码，
      // 且每次跑回归可能换目录名，混进 lint 基线会让它不稳定。
      '.graph-store-test-*',
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
      // React 19 新增规则：在本项目交互密集的编辑器里主要命中两类既有模式——
      //   · `react-hooks/refs`     渲染期写 ref 缓存最新值（React 官方推荐的 latest-value 模式）
      //   · `set-state-in-effect`  effect 内根据外部 store/localStorage 派生 setState
      // 二者均为 React 19 插件的主观风格意见，逐文件重构 57 处易引发交互回归。
      // 降级为 warning 保留可见性，但不再计入「防新增」门禁（门禁只统计 error）。
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // simple-mind-map 的 MindMap.usePlugin 是模块级插件注册 API（名字带 use 但不是 React Hook）。
  // 该文件顶部 11 次调用被 react-hooks/rules-of-hooks 误报，因此只对该文件关闭这一条规则。
  {
    files: ['src/features/documents/MindMapDocumentEditor/MindMapDocumentEditor.tsx'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
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
