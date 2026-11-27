/**
 * 外部粘贴 Markdown 表格源码的契约（真源：mathPaste.ts + useSmartDocumentEditorModel.ts）。
 *
 * 历史问题：containsMarkdownDelimiters 不认管道表格 → 纯文本粘贴落到
 * defaultPasteHandler；就算强制走 markdown 转换，splitPlainTextLinesIntoBlocks
 * 也会在表头 / 分隔行 / 数据行之间插空行，把表格拆成一段段源码。
 *
 * 手动运行：npm run verify:markdown:table:paste
 */
import assert from 'node:assert/strict'
import {
  containsMarkdownDelimiters,
  containsMarkdownTable,
  convertMarkdownWithMathToHtml,
  getMarkdownTablePasteSource,
  hasRenderedHtmlTable,
} from '../src/features/documents/SmartDocumentEditor/mathPaste.ts'

let checks = 0
const check = (label: string, fn: () => void) => {
  fn()
  checks += 1
  console.log(`  ok  ${label}`)
}

const TABLE = [
  '| **名称** | 说明 | 数值 |',
  '| :--- | :---: | ---: |',
  '| `拓扑` | **加粗** | 42 |',
  '| 乙 | 普通文本 | 7 |',
].join('\n')

check('管道表格被识别；普通含竖线文本 / 残缺表头不误判', () => {
  assert.equal(containsMarkdownTable(TABLE), true)
  assert.equal(containsMarkdownDelimiters(TABLE), true)
  assert.equal(containsMarkdownTable('项目 | 状态\n--- | ---\n甲 | 完成'), true)
  assert.equal(containsMarkdownTable('A | B 是普通文本，后面没有分隔行。'), false)
  assert.equal(containsMarkdownTable('| a | b |'), false)
  assert.equal(containsMarkdownTable(''), false)
  // 老契约：单个 * 不是 markdown 分隔符
  assert.equal(containsMarkdownDelimiters('100W * 50 B = 50 * 10^6 B = 50M'), false)
})

check('转换出真正的 table / thead / tbody，单元格富文本生效且不留源码', () => {
  const html = convertMarkdownWithMathToHtml(TABLE)
  assert.ok(html.startsWith('<table>'), html)
  assert.ok(html.includes('<thead>') && html.includes('<tbody>'))
  assert.equal((html.match(/<th /g) ?? []).length, 3)
  assert.equal((html.match(/<td /g) ?? []).length, 6)
  assert.ok(!html.includes(':---') && !html.includes('---:'), '分隔行源码泄漏到正文')
  assert.ok(!html.includes('| **名称**'), '表头源码泄漏到正文')
  assert.ok(html.includes('<strong>名称</strong>') && html.includes('<strong>加粗</strong>'))
  assert.ok(html.includes('<code>拓扑</code>'))
  assert.ok(
    html.includes('<th align="left">')
    && html.includes('<th align="center">')
    && html.includes('<th align="right">'),
    '对齐标记应逐列保留',
  )
})

check('表格前后段落各自独立；无外框写法也成表', () => {
  const withParagraphs = convertMarkdownWithMathToHtml(`下面是对比：\n${TABLE}\n\n以上是总结。`)
  assert.equal((withParagraphs.match(/<p>/g) ?? []).length, 2)
  assert.ok(withParagraphs.includes('<table>') && withParagraphs.includes('以上是总结。'))
  assert.ok(!withParagraphs.includes('| :---'), '分隔行源码泄漏到正文')
  const borderless = convertMarkdownWithMathToHtml('项目 | 状态\n--- | ---\n甲 | 完成')
  assert.ok(borderless.includes('<table>'), borderless)
  assert.ok(borderless.includes('<td>甲</td>') && borderless.includes('<td>完成</td>'))
})

check('代码围栏内的表格源码保持源码；连续纯文本仍逐行成段', () => {
  const fenced = convertMarkdownWithMathToHtml('```md\n| a | b |\n| --- | --- |\n```')
  assert.ok(fenced.startsWith('<pre>'), fenced)
  assert.ok(fenced.includes('| --- | --- |'))
  assert.ok(!fenced.includes('<table'))
  const plain = convertMarkdownWithMathToHtml('第一行\n第二行\n第三行')
  assert.equal((plain.match(/<p>/g) ?? []).length, 3)
})

check('粘贴源选择：HTML 只是源码外壳时接管，已有渲染表格时让路', () => {
  assert.equal(getMarkdownTablePasteSource('', TABLE, ''), TABLE)
  assert.equal(getMarkdownTablePasteSource(TABLE, '无关文本', ''), TABLE, '显式 text/markdown 优先')
  assert.equal(getMarkdownTablePasteSource('', TABLE, '<pre>| a | b |</pre>'), TABLE)
  assert.equal(getMarkdownTablePasteSource('', TABLE, '<p>| a | b |</p><p>| --- | --- |</p>'), TABLE)
  assert.equal(getMarkdownTablePasteSource('', TABLE, '<table><tr><td>渲染表</td></tr></table>'), null)
  assert.equal(getMarkdownTablePasteSource('', '普通文本', '<p>普通文本</p>'), null)
  assert.equal(hasRenderedHtmlTable('<html><body><table><tr><td>x</td></tr></table></body></html>'), true)
  assert.equal(hasRenderedHtmlTable('<p>| --- | --- |</p>'), false)
})

check('大段剪贴板文本的表格探测保持线性时间', () => {
  const sample = `${'**abc\n'.repeat(20000)}| a | b |\n| --- | --- |\n`
  const started = performance.now()
  assert.equal(containsMarkdownDelimiters(sample), true)
  assert.ok(performance.now() - started < 100, '探测耗时异常，疑似回退到跨行惰性正则')
})

console.log(`\n${checks} checks passed`)
