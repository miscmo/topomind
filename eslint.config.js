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
      // 同属 7.1.x 推荐集里的主观风格意见：递归 useCallback 自引用、渲染期
      // 复用 gesture 对象等既有交互写法会被判为「不可修改 hook 参数」，
      // 逐处重构风险高于收益，沿用上面的降级策略。
      'react-hooks/immutability': 'warn',
      // 日志规范 §3.5：业务代码一律走统一日志入口，裸 console 只作为历史债。
      // 先 warn 不阻塞构建（本项目 lint 为 report-only），由 verify-logging.mts
      // 冻结当前数量，防止新增；存量逐步迁移到 logger / mainLog。
      'no-console': 'warn',
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
    rules: {
      'no-console': 'warn',
    },
  },

  // 依赖树对齐到 lock 后，新版 @eslint/js recommended 新增的两条 error 规则
  // 会命中既存的「控制字符白名单正则」与局部赋值写法（与本次需求无关，属于
  // 历史代码风格）。与 React 19 规则一样降级为 warning：保留可见性，但不让
  // 「防新增」基线因环境升级而整体失绿。
  {
    rules: {
      'no-control-regex': 'warn',
      'no-useless-assignment': 'warn',
    },
  },

  // no-console 的三处白名单：日志通道自身的最后兜底与开发期镜像。
  // 这些位置若再写日志会自我放大（写失败 → console → 又一条日志），
  // 只能保留 console；其余文件一律走 logger.ts / main-log.js。
  {
    files: [
      'src/core/logger.ts',
      'src/core/log-backend.ts',
      'electron/log-service.js',
    ],
    rules: { 'no-console': 'off' },
  },
)
