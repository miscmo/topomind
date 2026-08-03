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

const createSmartDocumentHighlighter = createBundledHighlighter({
  themes: {
    'github-light': () => import('shiki/themes/github-light.mjs'),
    'github-dark': () => import('shiki/themes/github-dark.mjs'),
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

let highlighterPromise: ReturnType<typeof createSmartDocumentHighlighter> | null = null

function getSmartDocumentHighlighter() {
  highlighterPromise ??= createSmartDocumentHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [],
  })
  return highlighterPromise
}

// Keep the language list intentionally bounded and defer grammars until the first code block is highlighted.
export const customCodeBlockOptions = {
  defaultLanguage: 'javascript',
  supportedLanguages,
  createHighlighter: getSmartDocumentHighlighter,
}
