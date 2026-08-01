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

const { convertMarkdownWithMathToHtml, convertMixedHtmlToHtml, escapeUnknownHtmlTags } = await import(
  '../src/features/documents/SmartDocumentEditor/mathPaste.ts'
)

function simulatePasteHtmlParse(html: string): string {
  const doc = new window.DOMParser().parseFromString(html, 'text/html')
  return doc.body?.textContent ?? ''
}

console.log('=== A. markdown NO fence <iostream>, then DOM parse ===')
const a = simulatePasteHtmlParse(convertMarkdownWithMathToHtml('#include<iostream>\nusing namespace std;\nif( s&(1<<i) )'))
console.log(JSON.stringify(a))
console.log('preserves <iostream>:', a.includes('<iostream>'), '| preserves 1<<i:', a.includes('1<<i'))

console.log('\n=== B. markdown **bold** + <xxx>, then DOM parse ===')
const b = simulatePasteHtmlParse(convertMarkdownWithMathToHtml('some **bold** text <xxx> here'))
console.log(JSON.stringify(b))
console.log('preserves <xxx>:', b.includes('<xxx>'), '| bold preserved:', b.includes('bold'))

console.log('\n=== C. mixedHtml unescaped <div><iostream>, then DOM parse ===')
const c = simulatePasteHtmlParse(convertMixedHtmlToHtml('<div>#include<iostream>\nusing namespace std;\nif( s&(1<<i) )</div>'))
console.log(JSON.stringify(c))
console.log('preserves <iostream>:', c.includes('<iostream>'), '| preserves 1<<i:', c.includes('1<<i'))

console.log('\n=== D. mixedHtml real rich text (should keep tags) ===')
const d = convertMixedHtmlToHtml('<div><p>Hello <strong>world</strong> & <em>formatting</em></p><table><tr><td>cell</td></tr></table></div>')
console.log(d)
console.log('keeps <strong>:', d.includes('<strong>'), '| keeps <table>:', d.includes('<table>'))

console.log('\n=== E. escapeUnknownHtmlTags edge cases ===')
console.log('known tag <b>:', escapeUnknownHtmlTags('<b>bold</b>'))
console.log('unknown <iostream>:', escapeUnknownHtmlTags('#include<iostream>'))
console.log('unknown <Component>:', escapeUnknownHtmlTags('const el = <Component>'))
console.log('1<<i (no >):', escapeUnknownHtmlTags('if( s&(1<<i) )'))
console.log('mixed real html:', escapeUnknownHtmlTags('<div class="x">code <xxx> here</div>'))
