import { codeBlockOptions } from '@blocknote/code-block'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import githubLight from 'shiki/themes/github-light.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import langJs from 'shiki/langs/javascript.mjs'
import langTs from 'shiki/langs/typescript.mjs'
import langTsx from 'shiki/langs/tsx.mjs'
import langJsx from 'shiki/langs/jsx.mjs'
import langJson from 'shiki/langs/json.mjs'
import langHtml from 'shiki/langs/html.mjs'
import langCss from 'shiki/langs/css.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'
import langPython from 'shiki/langs/python.mjs'
import langJava from 'shiki/langs/java.mjs'
import langC from 'shiki/langs/c.mjs'
import langCpp from 'shiki/langs/cpp.mjs'
import langRust from 'shiki/langs/rust.mjs'
import langGo from 'shiki/langs/go.mjs'
import langShell from 'shiki/langs/shellscript.mjs'
import langSql from 'shiki/langs/sql.mjs'
import langYaml from 'shiki/langs/yaml.mjs'

// 定制代码块高亮引擎 (使用纯 JS 引擎替代 WASM 以兼容 Electron CSP)
export const customCodeBlockOptions = {
  ...codeBlockOptions,
  createHighlighter: () =>
    createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [
        langJs, langTs, langTsx, langJsx, langJson, langHtml, langCss,
        langMarkdown, langPython, langJava, langC, langCpp, langRust, langGo, langShell, langSql, langYaml
      ],
      engine: createJavaScriptRegexEngine(),
    }) as any,
}
