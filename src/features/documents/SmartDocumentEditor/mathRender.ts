import katex from 'katex'

/**
 * KaTeX 的 math mode 只接受 ASCII + 少量 Unicode 数学符号。中文汉字、全角标点等
 * 「Unicode 文本字符」直接写进公式时，默认的 strict='warn' 会**逐字**打印
 * `unicodeTextInMathMode` 警告 —— 一篇含 13 个汉字的公式就刷 13 行 console.warn。
 *
 * 历史笔记里这类公式有两来源：合法写法（如 2^{树深度 - 1}，中文当变量下标）、
 * 以及粘贴时把中文正文误判成 $...$ 公式的产物。它们都已落盘，靠改写入口救不回来，
 * 所以必须在渲染前把公式源码规范化：既消掉警告，也让汉字从 math italic 的缺字
 * 方框变成 text mode 的正常字形。
 *
 * 只做三件事，绝不改写数学语义：
 *   1. 全角 ASCII（＝／（）／，…）→ 半角，LaTeX 特殊字符做转义；
 *   2. 裸的 Unicode 文本字符（CJK / 假名 / 带重音拉丁字母…）→ 连续段包 \text{}；
 *   3. 已有的 text-mode 命令（\text / \textbf / \mbox …）整组原样保留，保证幂等。
 * KaTeX 原生支持的 Unicode 数学符号（α ∑ ≤ ≠ ∈ → ℝ …）原样保留，
 * 不塞进 \text{}，否则公式语义会被破坏。
 *
 * 本模块不依赖 React / DOM，回归脚本可以直接 import 并真跑 KaTeX 渲染。
 */

/** 这些命令的参数已经是 text mode，内部的中文不能再包一层 \text{}。 */
const TEXT_MODE_COMMANDS = new Set([
  'text', 'textrm', 'textbf', 'textit', 'texttt', 'textsf', 'mbox', 'hbox',
  'operatorname', 'operatorname*',
])

/** 全角 ASCII 里的 LaTeX 特殊字符，转成半角前必须先转义。 */
const FULLWIDTH_LATEX_ESCAPE: Record<string, string> = {
  '\\': '\\backslash ',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  '_': '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\sim ',
}

/** KaTeX 原生支持、放进 math mode 不会触发 unicodeTextInMathMode 的符号。 */
const MATH_UNICODE_SYMBOLS = new Set(
  '±·×÷∞≠≤≥≈≡∝∈∉⊂⊃⊆⊇∪∩∅∀∃∑∏√∫∂∇→←↔⇒⇔↑↓⟶⟵' +
  '∘∙∓⊕⊗⊙⊥∥∠°′″≪≫≃≅∼≲≳⋆⋯⋮⋱⌈⌉⌊⌋⟨⟩⟪⟫□■△▲▽▼' +
  'αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ' +
  'ℓℕℤℚℝℂℵℏ',
)

const COMMAND_PATTERN = /\\([a-zA-Z]+|[\s\S])/y

/**
 * 找到从 `open`（必须是 '{'）开始的完整分组，返回 '}' 之后的下标。
 * 未闭合返回 -1；`\{` / `\}` 是转义字符，不参与配平。
 */
function findGroupEnd(source: string, open: number): number {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

/** \text{} 内容理论上只含非 ASCII 文本，这里仍兜底转义 LaTeX 特殊字符。 */
const TEXT_ESCAPE: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  '_': '\\_',
  '^': '\\textasciicircum{}',
}

function escapeTextContent(text: string): string {
  return text.replace(/[\\{}%$&#_^]/g, (char) => TEXT_ESCAPE[char] ?? char)
}

function isFullwidthAscii(code: number): boolean {
  return code >= 0xff01 && code <= 0xff5e
}

function isMathUnicode(char: string, code: number): boolean {
  if (code <= 0x7f || isFullwidthAscii(code)) return false
  return MATH_UNICODE_SYMBOLS.has(char)
}

/** 把一段公式源码改写成 KaTeX 不告警、显示也更正确的等价形式。幂等。 */
export function normalizeMathSource(source: string): string {
  if (!source) return source
  let output = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const code = char.codePointAt(0) ?? 0

    // 1) LaTeX 命令：命令名原样搬；text-mode 命令连带整个 {...} 组原样搬。
    if (char === '\\') {
      COMMAND_PATTERN.lastIndex = index
      const command = COMMAND_PATTERN.exec(source)
      if (!command) {
        output += char
        index += 1
        continue
      }
      output += command[0]
      index += command[0].length
      if (TEXT_MODE_COMMANDS.has(command[1])) {
        let cursor = index
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
        if (source[cursor] === '{') {
          const end = findGroupEnd(source, cursor)
          if (end > 0) {
            output += source.slice(index, end)
            index = end
          }
        }
      }
      continue
    }

    // 2) 全角 ASCII → 半角（＝→=、／→/、（→( …），保留公式结构。
    if (isFullwidthAscii(code)) {
      const ascii = String.fromCharCode(code - 0xfee0)
      output += FULLWIDTH_LATEX_ESCAPE[ascii] ?? ascii
      index += 1
      continue
    }

    // 全角空格（U+3000）是排版字符，不该被包进 text 分组，直接当普通空格。
    if (char === '\u3000') {
      output += ' '
      index += 1
      continue
    }

    // 3) 裸的 Unicode 文本字符：连续段整体包 \text{}，避免每个汉字各包一层。
    if (code > 0x7f && !isMathUnicode(char, code)) {
      let cursor = index
      let text = ''
      while (cursor < source.length) {
        const current = source[cursor]
        const currentCode = current.codePointAt(0) ?? 0
        if (
          currentCode <= 0x7f ||
          isFullwidthAscii(currentCode) ||
          current === '\u3000' ||
          isMathUnicode(current, currentCode)
        ) break
        text += current
        cursor += 1
      }
      output += `\\text{${escapeTextContent(text)}}`
      index = cursor
      continue
    }

    output += char
    index += 1
  }

  return output
}

/**
 * 行内 / 块级公式共用的唯一渲染入口。
 *
 * 刻意不把 strict 设成忽略档：一刀切会把 unknownSymbol / htmlExtension 等
 * 真正的问题一起藏起来，也会让回归里的「零警告」断言失去意义（去掉规范化后
 * 仍然通过）。警告必须由 normalizeMathSource 从源头消除。
 */
export function renderMathToHtml(latex: string, displayMode: boolean): string {
  return katex.renderToString(normalizeMathSource(latex) || ' ', {
    displayMode,
    throwOnError: false,
  })
}
