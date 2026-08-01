import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const { window } = dom
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
define('NodeFilter', window.NodeFilter)
define('getComputedStyle', window.getComputedStyle.bind(window))

const { convertMarkdownWithMathToHtml, convertMixedHtmlToHtml } = await import(
  '../src/features/documents/SmartDocumentEditor/mathPaste.ts'
)
const { BlockNoteEditor, BlockNoteSchema, createCodeBlockSpec } = await import('@blocknote/core')

// 模拟 pasteHTML 的 DOM 解析（BlockNote 内部 htmlToBlocks 的第一步）
function simulatePasteHtmlParse(html: string): string {
  const doc = new window.DOMParser().parseFromString(html, 'text/html')
  return doc.body?.textContent ?? ''
}

console.log('=== A. convertMarkdownWithMathToHtml NO fence, then DOM parse (pasteHTML) ===')
const mdOut = convertMarkdownWithMathToHtml('#include<iostream>\nusing namespace std;\nif( s&(1<<i) )')
console.log('md output:', mdOut)
const parsed = simulatePasteHtmlParse(mdOut)
console.log('after DOM parse:', JSON.stringify(parsed))
console.log('preserves <iostream>:', parsed.includes('<iostream>'))
console.log('preserves 1<<i:', parsed.includes('1<<i'))

console.log('\n=== B. convertMarkdownWithMathToHtml **bold**+<xxx>, then DOM parse ===')
const mdOut2 = convertMarkdownWithMathToHtml('some **bold** text <xxx> and 1<<i')
const parsed2 = simulatePasteHtmlParse(mdOut2)
console.log('after DOM parse:', JSON.stringify(parsed2))
console.log('preserves <xxx>:', parsed2.includes('<xxx>'))

console.log('\n=== C. convertMixedHtmlToHtml unescaped <div><iostream> ===')
const mixedOut = convertMixedHtmlToHtml('<div>#include<iostream>\nusing namespace std;\nif( s&(1<<i) )</div>')
console.log('mixed output:', mixedOut)
const parsed3 = simulatePasteHtmlParse(mixedOut)
console.log('after DOM parse:', JSON.stringify(parsed3))
console.log('preserves <iostream>:', parsed3.includes('<iostream>'))

console.log('\n=== D. convertMixedHtmlToHtml escaped <div>&lt;iostream&gt; ===')
const mixedOut2 = convertMixedHtmlToHtml('<div>#include&lt;iostream&gt;\nusing namespace std;</div>')
console.log('mixed output:', mixedOut2)
const parsed4 = simulatePasteHtmlParse(mixedOut2)
console.log('after DOM parse:', JSON.stringify(parsed4))
console.log('preserves <iostream>:', parsed4.includes('<iostream>'))
