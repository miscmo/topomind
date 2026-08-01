import { createHighlighterCore } from 'shiki/core'
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

async function createSmartDocumentHighlighter() {
  const [
    githubLight,
    githubDark,
    langJs,
    langTs,
    langTsx,
    langJsx,
    langJson,
    langHtml,
    langCss,
    langMarkdown,
    langPython,
    langJava,
    langC,
    langCpp,
    langRust,
    langGo,
    langShell,
    langSql,
    langYaml,
  ] = await Promise.all([
    import('shiki/themes/github-light.mjs').then((module) => module.default),
    import('shiki/themes/github-dark.mjs').then((module) => module.default),
    import('shiki/langs/javascript.mjs').then((module) => module.default),
    import('shiki/langs/typescript.mjs').then((module) => module.default),
    import('shiki/langs/tsx.mjs').then((module) => module.default),
    import('shiki/langs/jsx.mjs').then((module) => module.default),
    import('shiki/langs/json.mjs').then((module) => module.default),
    import('shiki/langs/html.mjs').then((module) => module.default),
    import('shiki/langs/css.mjs').then((module) => module.default),
    import('shiki/langs/markdown.mjs').then((module) => module.default),
    import('shiki/langs/python.mjs').then((module) => module.default),
    import('shiki/langs/java.mjs').then((module) => module.default),
    import('shiki/langs/c.mjs').then((module) => module.default),
    import('shiki/langs/cpp.mjs').then((module) => module.default),
    import('shiki/langs/rust.mjs').then((module) => module.default),
    import('shiki/langs/go.mjs').then((module) => module.default),
    import('shiki/langs/shellscript.mjs').then((module) => module.default),
    import('shiki/langs/sql.mjs').then((module) => module.default),
    import('shiki/langs/yaml.mjs').then((module) => module.default),
  ])

  return createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [
      langJs, langTs, langTsx, langJsx, langJson, langHtml, langCss,
      langMarkdown, langPython, langJava, langC, langCpp, langRust, langGo, langShell, langSql, langYaml,
    ],
    engine: createJavaScriptRegexEngine(),
  })
}

// Keep the language list intentionally bounded and defer grammars until the first code block is highlighted.
export const customCodeBlockOptions = {
  defaultLanguage: 'javascript',
  supportedLanguages,
  createHighlighter: createSmartDocumentHighlighter,
}
