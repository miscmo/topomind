import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
})
const { window } = dom as any

const emptyRectList = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })

// Register the globals BlockNote/ProseMirror rely on.
const define = (key: string, value: any) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })

define('window', window)
define('document', window.document)
define('navigator', window.navigator)
define('HTMLElement', window.HTMLElement)
define('Element', window.Element)
define('Node', window.Node)
define('Text', window.Text)
define('DocumentFragment', window.DocumentFragment)
define('DOMParser', window.DOMParser)
define('Range', window.Range)
define('ClipboardEvent', class ClipboardEvent extends window.Event {
  clipboardData: any
  constructor(type: string, init?: any) {
    super(type, init)
    this.clipboardData = init?.clipboardData ?? null
  }
})
define('KeyboardEvent', window.KeyboardEvent)
define('MouseEvent', window.MouseEvent)
define('getComputedStyle', window.getComputedStyle.bind(window))
define('requestAnimationFrame', (cb: any) => setTimeout(cb, 0))
define('cancelAnimationFrame', (id: any) => clearTimeout(id))

window.Element.prototype.getClientRects = emptyRectList as any
window.Element.prototype.getBoundingClientRect = (() => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })) as any
window.Range.prototype.getClientRects = emptyRectList as any
window.Range.prototype.getBoundingClientRect = (() => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })) as any

const { BlockNoteEditor, BlockNoteSchema, createCodeBlockSpec } = await import('@blocknote/core')

const editor = BlockNoteEditor.create({
  schema: BlockNoteSchema.create().extend({
    blockSpecs: { codeBlock: createCodeBlockSpec() },
  }),
})

// Mount so the ProseMirror view exists (pasteText needs the view).
const mountEl = window.document.createElement('div')
window.document.body.appendChild(mountEl)
;(editor as any).mount(mountEl)

const first = editor.document[0]
editor.insertBlocks([{ type: 'codeBlock', content: 'const x = 1' }], first, 'after')
const codeBlock = editor.document[editor.document.length - 1]
console.log('codeBlock.type =', codeBlock.type)

editor.setTextCursorPosition(codeBlock.id, 'end')

// Replicate our handler's code-block detection.
const detected = editor.transact((tr: any) => {
  const sel = tr.selection
  if (sel.node && sel.node.type.spec.code === true) return true
  return sel.$from.parent.type.spec.code === true && sel.$to.parent.type.spec.code === true
}) || editor.getTextCursorPosition().block.type === 'codeBlock'
console.log('isSelectionInCodeBlock =', detected)
console.log('cursorBlock.type =', editor.getTextCursorPosition().block.type)
console.log('$from.parent.type.name =', editor.transact((tr: any) => tr.selection.$from.parent.type.name))
console.log('$from.parent.type.spec.code =', editor.transact((tr: any) => tr.selection.$from.parent.type.spec.code))

// Replicate the exact pasteHandler branch logic from useSmartDocumentEditorModel.
function detectCodeBlock() {
  return editor.transact((tr: any) => {
    const sel = tr.selection
    if (sel.node && sel.node.type.spec.code === true) return true
    return sel.$from.parent.type.spec.code === true && sel.$to.parent.type.spec.code === true
  }) || editor.getTextCursorPosition().block.type === 'codeBlock'
}

function getCodeBlockPlainTextPaste(isCode: boolean, plainText: string) {
  return isCode && plainText.length > 0 ? plainText : undefined
}

// Mirror the fixed helper: unescaped HTML -> string-level wrapper strip,
// escaped HTML -> DOMParser textContent.
function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
const WRAPPER_TAGS = [
  'pre', 'code', 'span', 'div', 'p', 'font',
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'section', 'article', 'header', 'footer',
  'nav', 'main', 'figure', 'figcaption', 'aside',
  'meta', 'style', 'script', 'title',
].join('|')
function stripHtmlWrapperTags(value: string) {
  let output = value
    .replace(new RegExp(`</(?:${WRAPPER_TAGS})>`, 'gi'), '\n')
    .replace(new RegExp(`<(?:${WRAPPER_TAGS})(?:\\s[^>]*)?>`, 'gi'), '')
    .replace(/<br\s*\/?>/gi, '\n')
  output = output.replace(/\n{3,}/g, '\n\n')
  return output.trim()
}
function getCodeBlockPlainTextFromHtml(html: string) {
  if (!html || html.length === 0) return ''
  const hasEntities = /&(?:lt|gt|amp|quot|#\d+|nbsp);/.test(html)
  if (!hasEntities) {
    return stripHtmlWrapperTags(decodeHtmlEntities(html))
  }
  const doc = new window.DOMParser().parseFromString(html, 'text/html')
  doc.body.querySelectorAll('br').forEach((br: any) => br.replaceWith('\n'))
  return doc.body?.textContent ?? ''
}

function runHandler(clip: { plain?: string; markdown?: string; html?: string }) {
  const plainText = clip.plain ?? ''
  const markdown = clip.markdown ?? ''
  const hasHtml = !!clip.html
  const isCode = detectCodeBlock()
  let codeText = getCodeBlockPlainTextPaste(isCode, plainText)
  if (codeText === undefined && isCode && markdown.length > 0) {
    codeText = markdown
  }
  if (codeText === undefined && isCode && hasHtml) {
    const htmlText = getCodeBlockPlainTextFromHtml(clip.html!)
    if (htmlText.length > 0) codeText = htmlText
  }
  if (codeText !== undefined) {
    editor.pasteText(codeText)
    return 'pasteText(literal)'
  }
  if (hasHtml) {
    // current behaviour: HTML branch -> pasteHTML(convertMixedHtmlToHtml(html))
    return 'pasteHTML(HTML branch)  <-- strips <xxx>'
  }
  return 'defaultPasteHandler'
}

function currentCodeText() {
  const cb = editor.document[editor.document.length - 1]
  return (cb.content as any[]).map((c: any) => (c.type === 'text' ? c.text : '')).join('')
}

const CODE = 'const el = <xxx>hello</xxx>; let ok = a < b && c > d; const g: Array<string> = []'

console.log('\n=== Scenario A: clipboard has text/plain (+text/html) ===')
editor.setTextCursorPosition(editor.document[editor.document.length - 1].id, 'end')
const branchA = runHandler({ plain: CODE, html: '<pre><code>&lt;xxx&gt;</code></pre>' })
console.log('branch:', branchA)
console.log('preserves <xxx>:', currentCodeText().includes('<xxx>'))

console.log('\n=== Scenario B1: clipboard has ONLY unescaped text/html (text/plain empty) ===')
editor.setTextCursorPosition(editor.document[editor.document.length - 1].id, 'end')
const rawHtml = '<pre><code>#include<iostream>\nusing namespace std;\nif( s&(1<<i) )\nprintf("%c",str[i]);</code></pre>'
const branchB1 = runHandler({ html: rawHtml })
console.log('branch:', branchB1)
const textAfterB1 = currentCodeText()
console.log('preserves #include<iostream>:', textAfterB1.includes('#include<iostream>'))
console.log('preserves 1<<i:', textAfterB1.includes('1<<i'))
console.log('FULL TEXT:', JSON.stringify(textAfterB1))

console.log('\n=== Scenario B2: clipboard has ONLY escaped text/html (text/plain empty) ===')
editor.setTextCursorPosition(editor.document[editor.document.length - 1].id, 'end')
const escapedHtml = '<pre><code>#include&lt;iostream&gt;\nusing namespace std;\nif( s&amp;(1&lt;&lt;i) )</code></pre>'
const branchB2 = runHandler({ html: escapedHtml })
console.log('branch:', branchB2)
const textAfterB2 = currentCodeText()
console.log('preserves #include<iostream>:', textAfterB2.includes('#include<iostream>'))
console.log('preserves 1<<i:', textAfterB2.includes('1<<i'))

console.log('\n=== Scenario B3: clipboard has ONLY text/markdown (text/plain empty) ===')
editor.setTextCursorPosition(editor.document[editor.document.length - 1].id, 'end')
const branchB3 = runHandler({ markdown: 'const el = <xxx>hello</xxx>; let ok = a < b && c > d;' })
console.log('branch:', branchB3)
const textAfterB3 = currentCodeText()
console.log('preserves <xxx>:', textAfterB3.includes('<xxx>'))
console.log('preserves a < b && c > d:', textAfterB3.includes('a < b && c > d'))

editor._tiptapEditor.destroy()
