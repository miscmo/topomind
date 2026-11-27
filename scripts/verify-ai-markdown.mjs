/**
 * AI 回答 Markdown 渲染契约：表格必须渲染成 DOM，而不是把 md 源码吐给用户。
 *
 * 与 verify-ai-agent-contracts 同口径：用 esbuild 把组件 + react-dom/server 打成
 * 自包含 data URL 后真跑 renderToStaticMarkup，断言输出结构（不是文本匹配源码）。
 * 入口走 stdin，避免为了测试在 src 里留一个只给脚本用的文件。
 *
 * 手动运行：node scripts/verify-ai-markdown.mjs
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const result = await build({
  stdin: {
    contents: [
      "import { createElement } from 'react'",
      "import { renderToStaticMarkup } from 'react-dom/server'",
      "import AiMarkdown from './src/features/ai-agent/AiMarkdown.tsx'",
      'export function render(props) {',
      '  return renderToStaticMarkup(createElement(AiMarkdown, props))',
      '}',
    ].join('\n'),
    resolveDir: ROOT,
    sourcefile: 'verify-ai-markdown-entry.js',
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  // react-dom/server 的 CJS 依赖里有 require('util')：给 ESM data URL 一个真实
  // 的项目内 require 基准，否则 esbuild 的 __require 会抛「Dynamic require」。
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
  },
})
const { render } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
)

let checks = 0
const check = (label, fn) => {
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

check('标准 GFM 表格渲染成 table / thead / tbody，且不留 md 源码', () => {
  const html = render({ content: TABLE })
  assert.ok(html.includes('data-tm-ai-table=""'), '缺少表格容器标记')
  assert.ok(html.includes('class="tm-ai-table"'), '缺少统一视觉类 tm-ai-table')
  assert.ok(html.includes('<thead>') && html.includes('<tbody>'))
  assert.equal((html.match(/<th /g) ?? []).length, 3)
  assert.equal((html.match(/<td /g) ?? []).length, 6)
  assert.ok(!html.includes('---:') && !html.includes(':---'), '分隔行源码泄漏到正文')
  assert.ok(!html.includes('| **名称**'), '表头源码泄漏到正文')
  assert.ok(html.includes('>名称</strong>') && html.includes('>加粗</strong>'))
  assert.ok(html.includes('>拓扑</code>'))
})

check('对齐标记 :--- / :---: / ---: 逐列生效', () => {
  const html = render({ content: TABLE })
  assert.ok(html.includes('<th data-tm-align="left">'))
  assert.ok(html.includes('<th data-tm-align="center">'))
  assert.ok(html.includes('<th data-tm-align="right">'))
  assert.ok(html.includes('<td data-tm-align="right">42</td>'))
})

check('单元格里的引用按钮 / 行内链接仍由 InlineContext 决定', () => {
  const content = '| 来源 | 链接 |\n| --- | --- |\n| [ref:1] | [文档](https://example.com/a) |'
  const references = [{ ref: 1, docId: 'doc_a', cardPath: 'A', title: '甲', breadcrumb: 'A', charRange: [0, 1], text: 'x', score: 1 }]
  const hit = render({ content, references, onOpenRef: () => {} })
  assert.ok(hit.includes('data-tm-ai-ref="1"'))
  assert.ok(hit.includes('href="https://example.com/a"'))
  const miss = render({ content })
  assert.ok(!miss.includes('data-tm-ai-ref'), '没有引用映射时不得造死链')
})

check('转义竖线是字面量、缺列补空，宽表可横向滚动', () => {
  const html = render({ content: '| 项 | 备注 |\n| --- | --- |\n| A\\|B | 只有一列 |' })
  assert.ok(html.includes('A|B'), '\\| 应渲染成字面竖线')
  const partial = render({ content: '| 甲 | 乙 |\n| --- | --- |\n| 丙 |' })
  assert.equal((partial.match(/<td /g) ?? []).length, 2, '短行应补齐空单元格')
  assert.ok(render({ content: TABLE }).includes('overflow-x-auto'))
})

check('无外框竖线写法与「段落紧挨表格 / 表格后接段落」都正确切块', () => {
  const html = render({ content: '项目 | 状态\n--- | ---\n甲 | 完成\n\n以上是总结。' })
  assert.ok(html.includes('<table'))
  assert.ok(html.includes('<p') && html.includes('以上是总结。'))
  const adjacent = render({ content: '下面是对比：\n| 项 | 值 |\n| --- | --- |\n| 甲 | 1 |' })
  assert.ok(adjacent.includes('下面是对比：') && adjacent.includes('<table'), '表格不能被上一段落吞掉')
})

check('流式未吐完分隔行时保持纯文本，补齐后整块变表格', () => {
  const pending = render({ content: '| 名称 | 说明 |\n| ---' })
  assert.ok(!pending.includes('<table'), '分隔行不完整时不应抢先渲染空表')
  assert.ok(pending.includes('| ---'))
  const done = render({ content: '| 名称 | 说明 |\n| --- | --- |\n| 甲 | 乙 |' })
  assert.ok(done.includes('<table'))
  assert.ok(done.includes('甲') && done.includes('乙'))
})

check('代码块内的表格保持源码；普通含竖线文本不被误判；HTML 一律转义', () => {
  const fenced = render({ content: '```md\n| a | b |\n| --- | --- |\n```' })
  assert.ok(fenced.includes('<pre') && !fenced.includes('<table'))
  const prose = render({ content: 'A | B 是普通文本，后面没有分隔行。' })
  assert.ok(!prose.includes('<table'))
  const unsafe = render({ content: '| 内容 |\n| --- |\n| <img src=x onerror=alert(1)> |' })
  assert.ok(unsafe.includes('&lt;img') && !unsafe.includes('<img'))
})

const REF_SOURCE = {
  ref: 1,
  docId: 'doc_a',
  cardPath: 'KB/room/card-a',
  title: '量子纠缠检索笔记',
  breadcrumb: 'KB / room / 节点甲',
  nodeName: '节点甲',
  blockLabel: '段落「量子纠缠是本地知识检索的关键概念」',
  snippet: '量子纠缠是本地知识检索的关键概念……',
  charRange: [0, 120],
}

check('[ref:i] 直接显示文档名 + 编号，正文不再吐 md 风格的编号源码', () => {
  const html = render({ content: '根据 [ref:1] 可以得到结论。', references: [REF_SOURCE], onOpenRef: () => {} })
  assert.ok(html.includes('data-tm-ai-ref="1"'), '可点引用契约必须保留')
  assert.ok(html.includes('data-tm-ai-ref-label="量子纠缠检索笔记"'))
  assert.ok(html.includes('class="tm-ai-ref-chip') && html.includes('tm-ai-ref-index'))
  assert.ok(html.includes('量子纠缠检索笔记'))
  assert.ok(!html.includes('[ref:1]'), '编号源码不应再暴露给用户')
  assert.ok(html.includes('title="打开引用 · 文档：量子纠缠检索笔记｜节点：节点甲｜块：段落'),
    '悬停提示应给全文档 / 节点 / 块三层名字')
})

check('回答末尾来源清单展开文档 / 节点 / 块名字，重复引用去重', () => {
  const html = render({
    content: '甲见 [ref:1]，乙也见 [ref:1]，另见 [ref:2]。',
    references: [REF_SOURCE, { ...REF_SOURCE, ref: 2, title: '第二篇笔记' }],
    onOpenRef: () => {},
  })
  assert.ok(html.includes('data-tm-ai-ref-sources=""') && html.includes('参考来源'))
  assert.ok(html.includes('节点甲') && html.includes('段落「量子纠缠是本地知识检索的关键概念」'))
  assert.ok(html.includes('第二篇笔记'))
  assert.equal((html.match(/data-tm-ai-ref-source=/g) ?? []).length, 2, '同一编号只列一次')
})

check('未命中 / 伪造编号保持纯文本且不进来源清单，无映射时不渲染清单', () => {
  const html = render({ content: '伪造 [ref:9] 和真实 [ref:1]。', references: [REF_SOURCE], onOpenRef: () => {} })
  assert.ok(html.includes('[ref:9]') && !html.includes('data-tm-ai-ref="9"'))
  assert.equal((html.match(/data-tm-ai-ref-source=/g) ?? []).length, 1)
  const none = render({ content: '只有 [ref:1] 但没有映射。' })
  assert.ok(none.includes('[ref:1]') && !none.includes('data-tm-ai-ref'))
  assert.ok(!none.includes('data-tm-ai-ref-sources'))
  const fallback = render({
    content: '见 [ref:1]。',
    references: [{ ref: 1, docId: 'd', cardPath: 'A', title: '甲', breadcrumb: 'KB / 节点乙', charRange: [0, 1] }],
    onOpenRef: () => {},
  })
  assert.ok(fallback.includes('节点：KB / 节点乙'), '缺 nodeName 时降级到可读面包屑，不露 docId')
})

check('引用名字来自外部数据，HTML 一律转义', () => {
  const unsafe = {
    ...REF_SOURCE,
    title: '<img src=x onerror=alert(1)>',
    nodeName: '<b>节点</b>',
    blockLabel: '<script>alert(1)</script>',
  }
  const html = render({ content: '见 [ref:1]。', references: [unsafe], onOpenRef: () => {} })
  assert.ok(html.includes('&lt;img') && !html.includes('<img'))
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script'))
  assert.ok(html.includes('&lt;b&gt;节点&lt;/b&gt;') && !html.includes('<b>节点</b>'))
})

console.log(`AI Markdown 渲染契约通过：${checks} 项`)
