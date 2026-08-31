import { createBundledHighlighter } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const supportedLanguages: Record<string, { name: string; aliases: string[] }> = {
  text: { name: 'Plain Text', aliases: ['text', 'txt', 'plaintext'] },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  tsx: { name: 'TSX', aliases: [] },
  jsx: { name: 'JSX', aliases: [] },
  json: { name: 'JSON', aliases: [] },
  html: { name: 'HTML', aliases: [] },
  css: { name: 'CSS', aliases: [] },
  markdown: { name: 'Markdown', aliases: ['md'] },
  python: { name: 'Python', aliases: ['py'] },
  java: { name: 'Java', aliases: [] },
  c: { name: 'C', aliases: [] },
  cpp: { name: 'C++', aliases: ['c++'] },
  rust: { name: 'Rust', aliases: ['rs'] },
  go: { name: 'Go', aliases: [] },
  shellscript: { name: 'Shell', aliases: ['shell', 'bash', 'sh'] },
  sql: { name: 'SQL', aliases: [] },
  yaml: { name: 'YAML', aliases: ['yml'] },
}

const CODE_THEME_LIGHT = 'github-light'
// 深色用 high-contrast 变体：普通 github-dark 的注释色 #6A737D 在本项目代码块底色
// （--color-bg-muted: #202a37）上只有约 3:1，很多符号发灰看不清；high-contrast 变体
// 全部 token 对比度都在 6.8:1 以上。
const CODE_THEME_DARK = 'github-dark-high-contrast'

const createSmartDocumentHighlighter = createBundledHighlighter({
  themes: {
    'github-light': () => import('shiki/themes/github-light.mjs'),
    'github-dark-high-contrast': () => import('shiki/themes/github-dark-high-contrast.mjs'),
  },
  langs: {
    javascript: () => import('shiki/langs/javascript.mjs'),
    typescript: () => import('shiki/langs/typescript.mjs'),
    tsx: () => import('shiki/langs/tsx.mjs'),
    jsx: () => import('shiki/langs/jsx.mjs'),
    json: () => import('shiki/langs/json.mjs'),
    html: () => import('shiki/langs/html.mjs'),
    css: () => import('shiki/langs/css.mjs'),
    markdown: () => import('shiki/langs/markdown.mjs'),
    python: () => import('shiki/langs/python.mjs'),
    java: () => import('shiki/langs/java.mjs'),
    c: () => import('shiki/langs/c.mjs'),
    cpp: () => import('shiki/langs/cpp.mjs'),
    rust: () => import('shiki/langs/rust.mjs'),
    go: () => import('shiki/langs/go.mjs'),
    shellscript: () => import('shiki/langs/shellscript.mjs'),
    sql: () => import('shiki/langs/sql.mjs'),
    yaml: () => import('shiki/langs/yaml.mjs'),
  },
  engine: createJavaScriptRegexEngine,
})

type SmartDocumentHighlighter = Awaited<ReturnType<typeof createSmartDocumentHighlighter>>

/** BlockNote 用 Symbol.for 把 shiki 的 highlighter / parser 缓存在 globalThis，且先到先得 */
const BLOCKNOTE_HIGHLIGHTER_KEY = Symbol.for('blocknote.shikiHighlighterPromise')
const BLOCKNOTE_PARSER_KEY = Symbol.for('blocknote.shikiParser')
const blockNoteShikiCache = globalThis as unknown as Record<symbol, unknown>

/**
 * 把单主题调用改写成 shiki 的「双主题（dual themes）」调用：
 * `defaultColor: false` 时 token 行内样式只写 CSS 变量 `--shiki-light` / `--shiki-dark`
 * （以及对应的 font-* 变体），不写死 `color`。真正取哪一组交给 SmartDocumentEditor.css
 * 按 `html.dark` 选择 —— 主题切换不需要重新解析代码，天然跟随。
 *
 * 这里**就地改写实例上的 codeToTokens**（而不是返回 Proxy）：BlockNote 的 parser 持的是
 * 实例引用而非 Proxy，只有就地改写才能同时修好「已经挂载的编辑器」。
 */
function applyDualTheme(base: SmartDocumentHighlighter): SmartDocumentHighlighter {
  try {
    const original = base.codeToTokens.bind(base)
    Object.defineProperty(base, 'codeToTokens', {
      configurable: true,
      writable: true,
      value: (code: string, options: Record<string, unknown> = {}) => {
        // parser 会传 theme（取 getLoadedThemes()[0]，即浅色主题），这里丢掉换成双主题
        const { theme: _ignoredSingleTheme, ...rest } = options
        return original(code, {
          ...rest,
          themes: { light: CODE_THEME_LIGHT, dark: CODE_THEME_DARK },
          defaultColor: false,
        })
      },
    })
  } catch {
    // 无法改写时保持原样，SmartDocumentEditor.css 里带 fallback 的规则仍能保证可读
  }
  return base
}

let highlighterPromise: ReturnType<typeof createSmartDocumentHighlighter> | null = null

function getSmartDocumentHighlighter() {
  highlighterPromise ??= resolveOrCreateHighlighter()
  return highlighterPromise
}

function resolveOrCreateHighlighter() {
  // 优先复用 globalThis 上已有的实例：HMR 后旧模块创建的实例也会被 BlockNote 的
  // parser 一直持有，复用并就地改写它，才能让已经挂载的编辑器立刻用上双主题。
  const cached = blockNoteShikiCache[BLOCKNOTE_HIGHLIGHTER_KEY]
  const pending =
    cached instanceof Promise
      ? (cached as ReturnType<typeof createSmartDocumentHighlighter>)
      : createSmartDocumentHighlighter({
          themes: [CODE_THEME_LIGHT, CODE_THEME_DARK],
          langs: [],
        })

  return pending.then(applyDualTheme).catch((error: unknown) => {
    // 创建失败时清掉缓存，避免 BlockNote 一直复用这个坏的 promise
    delete blockNoteShikiCache[BLOCKNOTE_HIGHLIGHTER_KEY]
    delete blockNoteShikiCache[BLOCKNOTE_PARSER_KEY]
    throw error
  })
}

// Keep the language list intentionally bounded and defer grammars until the first code block is highlighted.
export const customCodeBlockOptions = {
  defaultLanguage: 'javascript',
  supportedLanguages,
  createHighlighter: getSmartDocumentHighlighter,
}
