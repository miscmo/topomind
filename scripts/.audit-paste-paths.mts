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
define('getComputedStyle', window.getComputedStyle.bind(window))

const { convertMarkdownWithMathToHtml, convertMixedHtmlToHtml } = await import(
  '../src/features/documents/SmartDocumentEditor/mathPaste.ts'
)

console.log('=== 1. convertMarkdownWithMathToHtml: NO fence, has <iostream> ===')
const r1 = convertMarkdownWithMathToHtml('#include<iostream>\nusing namespace std;')
console.log(r1)
console.log('preserves <iostream>:', r1.includes('<iostream>') || r1.includes('&lt;iostream&gt;'))

console.log('\n=== 2. convertMarkdownWithMathToHtml: **bold** + <xxx> ===')
const r2 = convertMarkdownWithMathToHtml('some **bold** text <xxx> and 1<<i here')
console.log(r2)
console.log('preserves <xxx>:', r2.includes('<xxx>') || r2.includes('&lt;xxx&gt;'))
console.log('preserves 1<<i:', r2.includes('1<<i') || r2.includes('1&lt;&lt;i'))

console.log('\n=== 3. convertMarkdownWithMathToHtml: fenced code (control) ===')
const r3 = convertMarkdownWithMathToHtml('```cpp\n#include<iostream>\nif( s&(1<<i) )\n```')
console.log(r3)
console.log('preserves <iostream>:', r3.includes('&lt;iostream&gt;'))

console.log('\n=== 4. convertMixedHtmlToHtml: unescaped <div><iostream> ===')
const r4 = convertMixedHtmlToHtml('<div>#include<iostream>\nusing namespace std;\nif( s&(1<<i) )</div>')
console.log(r4)
console.log('preserves <iostream>:', r4.includes('<iostream>') || r4.includes('&lt;iostream&gt;'))
console.log('preserves 1<<i:', r4.includes('1<<i') || r4.includes('1&lt;&lt;i'))

console.log('\n=== 5. convertMixedHtmlToHtml: escaped <div>&lt;iostream&gt; ===')
const r5 = convertMixedHtmlToHtml('<div>#include&lt;iostream&gt;\nusing namespace std;</div>')
console.log(r5)
console.log('preserves <iostream>:', r5.includes('<iostream>') || r5.includes('&lt;iostream&gt;'))
