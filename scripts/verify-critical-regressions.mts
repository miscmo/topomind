import assert from 'node:assert/strict'

import { getRemoteImageRequestHeaders } from '../electron/services/attachment-service.js'
import { getImagePreviewScale } from '../src/features/documents/SmartDocumentEditor/imagePreview.ts'
import { quoteEnterPayload, shouldHandleQuoteEnter } from '../src/features/documents/SmartDocumentEditor/quoteEnter.ts'
import { containsMarkdownFence, normalizeFenceIndentation } from '../src/features/documents/SmartDocumentEditor/fenceNormalize.ts'
import { isValidHexColor, resolveDocumentIcon } from '../src/features/documents/components/documentMeta.ts'
import {
  getDocumentSidebarScrollStorageKey,
  getExpandedDocumentNodesStorageKey,
  loadDocumentSidebarScrollTop,
  loadExpandedDocumentNodeIds,
  parseExpandedDocumentNodeIds,
  saveDocumentSidebarScrollTop,
  saveExpandedDocumentNodeIds,
} from '../src/features/documents/model/documentSidebarState.ts'
import { planFlowchartCellSync } from '../src/features/documents/FlowchartDocumentEditor/flowchartCellSync.ts'
import {
  normalizeFlowchartDocumentContent,
  type FlowchartCell,
} from '../src/features/documents/FlowchartDocumentEditor/flowchartDocumentTypes.ts'
import {
  buildPastedImageHtml,
  cloneSmartDocumentBlockWithoutIds,
  decodeHtmlEntities,
  getClipboardMarkdownImage,
  getCodeBlockPlainTextFromHtml,
  getCodeBlockPlainTextPaste,
  getCodeBlockPasteHtml,
  getStandaloneCodeBlockPasteHtml,
  getSmartDocumentBlocksClipboardText,
  getSmartDocumentMenuTargetBlockIds,
  getSmartDocumentOutlineAndStats,
  getSmartDocumentSelectedTextState,
  getUploadedFileUrl,
  stripHtmlWrapperTags,
  writeClipboardBeforeMutation,
} from '../src/features/documents/SmartDocumentEditor/smartDocumentUtils.ts'
import {
  areDocumentContentsEqual,
  prepareStructuredDocumentContentForSave,
} from '../src/features/documents/model/documentContentSession.ts'
import { normalizeSmartDocumentContent } from '../src/features/documents/SmartDocumentEditor/smartDocumentTypes.ts'
import {
  containsMarkdownDelimiters,
  escapeUnknownHtmlTags,
  hasMeaningfulHtmlStructure,
  stripClipboardHtmlNoise,
  stripClipboardMetaTags,
  convertMarkdownWithMathToHtml,
} from '../src/features/documents/SmartDocumentEditor/mathPaste.ts'
import { SaveCoordinator } from '../src/domain/persistence/saveCoordinator.ts'
import {
  flushTabs,
  getDirtyState,
  registerTabSaver,
} from '../src/core/close-guard.ts'

const node = (id: string, overrides: Partial<FlowchartCell> = {}): FlowchartCell => ({
  id,
  shape: 'rect',
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  attrs: { label: { text: id } },
  data: {},
  ...overrides,
})

const edge = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<FlowchartCell> = {},
): FlowchartCell => ({
  id,
  shape: 'edge',
  source: { cell: source },
  target: { cell: target },
  attrs: {},
  data: {},
  labels: [],
  ...overrides,
})

{
  const cells = [node('a'), node('b'), edge('ab', 'a', 'b')]
  assert.deepEqual(planFlowchartCellSync(cells, cells), {
    removeEdgeIds: [],
    removeNodeIds: [],
    addNodes: [],
    updateNodes: [],
    addEdges: [],
    updateEdges: [],
  })
}

{
  const current = [node('a', { data: { obsolete: true }, zIndex: 1 })]
  const next = [node('a', { x: 80 })]
  const plan = planFlowchartCellSync(current, next)
  assert.deepEqual(plan.removeEdgeIds, [])
  assert.deepEqual(plan.removeNodeIds, [])
  assert.deepEqual(plan.addNodes, [])
  assert.equal(plan.updateNodes.length, 1)
  assert.deepEqual(plan.updateNodes[0].removeKeys, ['zIndex'])
  assert.equal(plan.updateNodes[0].cell.x, 80)
}

{
  const current = [node('a'), node('b'), edge('ab', 'a', 'b')]
  const next = [node('b')]
  const plan = planFlowchartCellSync(current, next)
  assert.deepEqual(plan.removeEdgeIds, ['ab'])
  assert.deepEqual(plan.removeNodeIds, ['a'])
}

{
  const current = [node('a'), node('b'), edge('ab', 'a', 'b')]
  const next = [node('a', { shape: 'polygon' }), node('b'), edge('ab', 'a', 'b')]
  const plan = planFlowchartCellSync(current, next)
  assert.deepEqual(plan.removeEdgeIds, ['ab'])
  assert.deepEqual(plan.removeNodeIds, ['a'])
  assert.deepEqual(plan.addNodes.map((cell) => cell.id), ['a'])
  assert.deepEqual(plan.addEdges.map((cell) => cell.id), ['ab'])
  assert.deepEqual(plan.updateNodes, [])
  assert.deepEqual(plan.updateEdges, [])
}

{
  const current = [node('a'), node('b'), edge('ab', 'a', 'b')]
  const next = [node('a'), node('b'), node('c'), edge('ab', 'a', 'c')]
  const plan = planFlowchartCellSync(current, next)
  assert.deepEqual(plan.addNodes.map((cell) => cell.id), ['c'])
  assert.equal(plan.updateEdges.length, 1)
  assert.deepEqual(plan.updateEdges[0].cell.target, { cell: 'c' })
}

{
  const normalized = normalizeFlowchartDocumentContent({
    version: 2,
    title: '兼容旧边类型',
    cells: [
      node('a'),
      node('b'),
      edge('ab', 'a', 'b', { shape: 'custom-edge' }),
      edge('invalid', 'a', 'missing'),
    ],
  }, '回退标题')

  assert.equal(normalized.cells.length, 3)
  assert.deepEqual(normalized.cells.map((cell) => cell.id), ['a', 'b', 'ab'])
  assert.equal(normalized.cells[2].shape, 'edge')
}

{
  const selectedBlocks = [
    { id: 'a', content: [{ type: 'text', text: '第一块' }] },
    { id: 'b', content: [{ type: 'text', text: '第二块' }] },
  ]
  assert.deepEqual(getSmartDocumentMenuTargetBlockIds('a', selectedBlocks), ['a', 'b'])
  assert.deepEqual(getSmartDocumentMenuTargetBlockIds('outside', selectedBlocks), ['outside'])
  assert.equal(getSmartDocumentBlocksClipboardText(selectedBlocks), '第一块\n第二块')
}

{
  const source = {
    id: 'root',
    type: 'paragraph',
    content: [{ type: 'text', text: '父块' }],
    children: [{
      id: 'child',
      type: 'paragraph',
      content: [{ type: 'text', text: '子块' }],
      children: [{ id: 'grandchild', type: 'paragraph', content: '孙块' }],
    }],
  }
  const clone = cloneSmartDocumentBlockWithoutIds(source)
  assert.equal('id' in clone, false)
  assert.equal('id' in clone.children[0], false)
  assert.equal('id' in clone.children[0].children[0], false)
  assert.equal(getSmartDocumentBlocksClipboardText([source]), '父块\n子块\n孙块')
}

{
  let mutationCount = 0
  const didMutate = await writeClipboardBeforeMutation(
    '内容',
    async () => undefined,
    () => { mutationCount += 1 },
  )
  assert.equal(didMutate, true)
  assert.equal(mutationCount, 1)

  const didMutateAfterFailure = await writeClipboardBeforeMutation(
    '内容',
    async () => { throw new Error('clipboard denied') },
    () => { mutationCount += 1 },
  )
  assert.equal(didMutateAfterFailure, false)
  assert.equal(mutationCount, 1)
}

{
  const codeSamples = [
    '<xxx>',
    '<div>value</div>',
    'a < b && c > d',
    'const values: Array<string> = []',
    '<root>\n  <item id="1">value</item>\n</root>',
  ]
  for (const sample of codeSamples) {
    assert.equal(getCodeBlockPlainTextPaste(true, sample), sample)
  }
  const richClipboardPayload = {
    plainText: '<Widget>value</Widget>',
    html: '<pre><code>&lt;Widget&gt;value&lt;/Widget&gt;</code></pre>',
  }
  assert.equal(
    getCodeBlockPlainTextPaste(true, richClipboardPayload.plainText),
    richClipboardPayload.plainText,
  )
  assert.equal(getCodeBlockPlainTextPaste(false, '<xxx>'), undefined)
  assert.equal(getCodeBlockPlainTextPaste(true, ''), undefined)
}

{
  // Scenario B: clipboard carries only text/html with an empty text/plain
  // (web code blocks, some rich-text apps). The handler must recover literal
  // code from the HTML payload instead of feeding the raw HTML through
  // pasteHTML where <xxx> would be stripped.

  // B1: unescaped HTML (sources that dump raw code into text/html). No DOM is
  // needed; the string-level wrapper stripping must survive <iostream>, 1<<i,
  // and Array<string> literally — the exact cases from the reported C++ bug.
  assert.equal(
    getCodeBlockPlainTextFromHtml(
      '<pre><code>#include<iostream>\nusing namespace std;\nif( s&(1<<i) )\nprintf("%c",str[i]);</code></pre>',
    ),
    '#include<iostream>\nusing namespace std;\nif( s&(1<<i) )\nprintf("%c",str[i]);',
  )
  assert.equal(
    getCodeBlockPlainTextFromHtml(
      '<div class="code">const el = <xxx>hello</xxx>; let ok = a < b && c > d;</div>',
    ),
    'const el = <xxx>hello</xxx>; let ok = a < b && c > d;',
  )
  assert.equal(
    getCodeBlockPlainTextFromHtml(
      '<pre><code>const g: Array<string> = []</code></pre>',
    ),
    'const g: Array<string> = []',
  )
  // B1b: PARTIALLY escaped HTML — sources escape & as &amp; but leave < > raw
  // (exactly the reported C++ case: `s&(1<<i)`). Angle brackets must decide the
  // path, not any entity: a &amp; alone must NOT route to DOM parsing.
  assert.equal(
    getCodeBlockPlainTextFromHtml(
      '<pre><code>#include<iostream>\nusing namespace std;\nif( s&amp;(1<<i) )\nprintf("%c",str[i]);</code></pre>',
    ),
    '#include<iostream>\nusing namespace std;\nif( s&(1<<i) )\nprintf("%c",str[i]);',
  )

  // B2: escaped HTML (standard browser copy). With the unified string path
  // (no DOMParser), escaped entities are decoded identically in Node.
  const htmlSamples: Array<[html: string, expected: string]> = [
    ['<pre><code>#include&lt;iostream&gt;</code></pre>', '#include<iostream>'],
    ['<pre><code>const el = &lt;xxx&gt;hello&lt;/xxx&gt;</code></pre>', 'const el = <xxx>hello</xxx>'],
    ['<pre><code>let ok = a &lt; b &amp;&amp; c &gt; d;</code></pre>', 'let ok = a < b && c > d;'],
    ['<pre><code>const g: Array&lt;string&gt; = []</code></pre>', 'const g: Array<string> = []'],
    ['<div>line1<br>line2</div>', 'line1\nline2'],
    ['<pre><code>if( s&amp;(1&lt;&lt;i) )</code></pre>', 'if( s&(1<<i) )'],
  ]
  for (const [html, expected] of htmlSamples) {
    assert.equal(getCodeBlockPlainTextFromHtml(html), expected)
  }
  assert.equal(getCodeBlockPlainTextFromHtml('', () => ''), '')
  assert.equal(getCodeBlockPlainTextFromHtml('<p></p>', () => ''), '')
  // B3: exported helpers stay stable
  assert.equal(decodeHtmlEntities('&lt;b&gt;&amp;&quot;x&quot;&#39;'), '<b>&"x"\'')
  // Consecutive closing wrappers collapse to a single blank line max.
  assert.equal(stripHtmlWrapperTags('<pre><code>a</code></pre>\n<div>b</div>'), 'a\n\nb')

  // B4: code-block HTML pasted OUTSIDE a code block must be re-emitted as a
  // clean escaped <pre><code> so BlockNote auto-creates a codeBlock without
  // stripping <xxx>/1<<i (the reported C++ paste bug). The unified string path
  // (no DOMParser) makes all of these testable directly in Node.
  assert.equal(
    getCodeBlockPasteHtml('<pre><code>#include<iostream>\nusing namespace std;\nif( s&(1<<i) )</code></pre>'),
    '<pre><code>#include&lt;iostream&gt;\nusing namespace std;\nif( s&amp;(1&lt;&lt;i) )</code></pre>',
  )
  assert.equal(
    getCodeBlockPasteHtml('<pre><code>const el = <xxx>hello</xxx>;</code></pre>'),
    '<pre><code>const el = &lt;xxx&gt;hello&lt;/xxx&gt;;</code></pre>',
  )
  // language hint from class="language-xxx" / data-language on <code>/<pre> only
  assert.equal(
    getCodeBlockPasteHtml('<pre><code class="language-cpp">int x &lt; 1;</code></pre>'),
    '<pre><code data-language="cpp">int x &lt; 1;</code></pre>',
  )
  // a random span class (e.g. `e6vjtes0`) must NOT be treated as a language
  assert.equal(
    getCodeBlockPasteHtml('<pre><code class="e6vjtes0">int x &lt; 1;</code></pre>'),
    '<pre><code>int x &lt; 1;</code></pre>',
  )
  // partial escaping: &amp; present but < > raw must still survive
  assert.equal(
    getCodeBlockPasteHtml('<pre><code>#include<iostream>\nif( s&amp;(1<<i) )</code></pre>'),
    '<pre><code>#include&lt;iostream&gt;\nif( s&amp;(1&lt;&lt;i) )</code></pre>',
  )
  // The paste handler may replace the whole payload only when it is a single
  // standalone <pre>. Mixed rich text and inline code must stay on the normal
  // HTML path so surrounding content is never discarded/promoted.
  assert.equal(
    getStandaloneCodeBlockPasteHtml('<pre><code>#include<iostream>\nreturn 0;</code></pre>'),
    '<pre><code>#include&lt;iostream&gt;\nreturn 0;</code></pre>',
  )
  assert.equal(
    getStandaloneCodeBlockPasteHtml('<html><body><pre><code>int x &lt; 1;</code></pre></body></html>'),
    '<pre><code>int x &lt; 1;</code></pre>',
  )
  assert.equal(
    getStandaloneCodeBlockPasteHtml('<h1>标题</h1><p>前文</p><pre><code>int x &lt; 1;</code></pre><p>后文</p>'),
    '',
  )
  assert.equal(getStandaloneCodeBlockPasteHtml('<p>运行 <code>npm install</code> 后继续</p>'), '')
  assert.equal(getCodeBlockPasteHtml(''), '')
}

{
  // escapeUnknownHtmlTags: protects literal code angle brackets on the
  // markdown / rich-HTML paste paths (same root cause as the code-block bug).
  // Unknown tags are escaped; known HTML tags pass through.
  assert.equal(escapeUnknownHtmlTags('#include<iostream>'), '#include&lt;iostream>')
  assert.equal(escapeUnknownHtmlTags('const el = <Component>'), 'const el = &lt;Component>')
  // `1<<i`: the second `<i` is NOT a tag start (no valid boundary after), so
  // it must be escaped to survive DOM parsing.
  assert.equal(escapeUnknownHtmlTags('if( s&(1<<i) )'), 'if( s&(1&lt;&lt;i) )')
  assert.equal(escapeUnknownHtmlTags('let ok = a < b && c > d'), 'let ok = a < b && c > d')
  // Known HTML tags pass through unchanged.
  assert.equal(escapeUnknownHtmlTags('<b>bold</b>'), '<b>bold</b>')
  assert.equal(escapeUnknownHtmlTags('<div class="x">code <xxx> here</div>'), '<div class="x">code &lt;xxx> here</div>')
  assert.equal(escapeUnknownHtmlTags('<pre><code>real</code></pre>'), '<pre><code>real</code></pre>')
  // Document-structure tags must survive as REAL tags so DOMPurify can strip
  // them; escaping them is what leaked "<html> <body> ..." noise into pastes.
  assert.equal(
    escapeUnknownHtmlTags('<html><head></head><body>[link](https://a.b/)</body></html>'),
    '<html><head></head><body>[link](https://a.b/)</body></html>',
  )
}

{
  // 腾讯文档/微信剪贴板：<sc-clipboard> 元数据必须整体移除，正文保留。
  const clipboardHtml =
    '<html><head></head><body>\n[226.翻转二叉树](https://leetcode-cn.com/problems/invert-binary-tree/)\n\n[题解](https://leetcode-cn.com/problems/invert-binary-tree/solution/fan-zhuan-er-cha-shu-by-leetcode-solution/)\n<sc-clipboard block-data="{&quot;data&quot;:[{&quot;text&quot;:&quot;duplicated&quot;}]}"></sc-clipboard>\n</body></html>'
  const stripped = stripClipboardMetaTags(clipboardHtml)
  assert.equal(stripped.includes('sc-clipboard'), false)
  assert.equal(stripped.includes('duplicated'), false)
  assert.equal(stripped.includes('[226.翻转二叉树]'), true)
  assert.equal(stripClipboardMetaTags('<sc-clipboard block-data="x"/>[a](b)'), '[a](b)')
  assert.equal(hasMeaningfulHtmlStructure(clipboardHtml), false)
  assert.equal(hasMeaningfulHtmlStructure('<html><body><p>real <strong>text</strong></p></body></html>'), true)
  assert.equal(hasMeaningfulHtmlStructure('<strong>加粗</strong>'), true)
  assert.equal(hasMeaningfulHtmlStructure('<em>斜体</em>'), true)
  assert.equal(hasMeaningfulHtmlStructure('<a href="https://example.com">链接</a>'), true)
  assert.equal(hasMeaningfulHtmlStructure('<img src="_attach/a.png">'), true)
  assert.equal(
    stripClipboardHtmlNoise('<html><head></head><body><sc-clipboard block-data="x">dup</sc-clipboard>标题 内容</body></html>'),
    '标题 内容',
  )
}

{
  assert.deepEqual(
    getRemoteImageRequestHeaders(new URL('https://docimg10.docs.qq.com/image/example.gif?w=571&h=279')),
    {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: 'https://docs.qq.com/',
    },
  )
  assert.deepEqual(
    getRemoteImageRequestHeaders(new URL('https://example.com/image.png')),
    {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  )

  const source = '![图片](https://docimg3.docs.qq.com/image/AgAAChxmIrvxPOJuJOZM8alTwEXQ70IW.png?w=788&h=373)'
  assert.deepEqual(getClipboardMarkdownImage(source), {
    alt: '图片',
    url: 'https://docimg3.docs.qq.com/image/AgAAChxmIrvxPOJuJOZM8alTwEXQ70IW.png?w=788&h=373',
  })
  assert.equal(getClipboardMarkdownImage(`前文\n${source}\n后文`), null)
  assert.equal(getClipboardMarkdownImage('普通文本'), null)
  assert.equal(getClipboardMarkdownImage('![图片](data:image/png;base64,abc)'), null)
  assert.equal(getUploadedFileUrl('_attach/a.png'), '_attach/a.png')
  assert.equal(getUploadedFileUrl({ props: { url: '_attach/b.gif' } }), '_attach/b.gif')
  assert.equal(getUploadedFileUrl({ url: '_attach/c.webp' }), '_attach/c.webp')
  assert.equal(getUploadedFileUrl({ props: {} }), null)
  assert.equal(
    buildPastedImageHtml('_attach/x.png', '图"片'),
    '<img src="_attach/x.png" alt="图&quot;片">',
  )
}

{
  // 图片全屏预览缩放：向上滚放大、向下滚缩小，并限制在 25% ~ 800% 之间。
  assert.equal(getImagePreviewScale(1, -100), 1.15)
  assert.equal(getImagePreviewScale(1, 100), 0.85)
  assert.equal(getImagePreviewScale(0.25, 100), 0.25)
  assert.equal(getImagePreviewScale(0.29, 100), 0.25)
  assert.equal(getImagePreviewScale(8, -100), 8)
  assert.equal(getImagePreviewScale(7.5, -100), 8)
}

{
  // 腾讯文档纯文本包裹（<html><body> + <sc-clipboard multi-text-data>）无真实结构：
  // 应走纯文本 markdown 路径，防止 convertMixedHtmlToHtml 把单个 * 当斜体转 <em>。
  assert.equal(hasMeaningfulHtmlStructure('<html><body>100W * 50 B = 50 * 10^6 B = 50M<sc-clipboard multi-text-data="{}"></sc-clipboard></body></html>'), false)
  assert.equal(stripClipboardMetaTags('<html><body>a<sc-clipboard multi-text-data="[{&quot;x&quot;:1}]">dup</sc-clipboard>b</body></html>'), '<html><body>ab</body></html>')
  // 单个 * 不是 markdown 分隔符（成对 **/__ 或链接才是），因此旧逻辑会漏判走 HTML 分支。
  assert.equal(containsMarkdownDelimiters('100W * 50 B = 50 * 10^6 B = 50M'), false)
  assert.equal(containsMarkdownDelimiters('**加粗** 和 [链接](https://a.b)'), true)
}

{
  assert.equal(getSmartDocumentSelectedTextState('   ', [{ content: [] }]), undefined)
  assert.deepEqual(getSmartDocumentSelectedTextState('  x + y  ', [{ content: [] }]), {
    rawText: '  x + y  ',
    latex: 'x + y',
    canConvertInlineMath: true,
    canConvertBlockMath: true,
  })
  assert.deepEqual(getSmartDocumentSelectedTextState('x\ny', [{ content: [] }]), {
    rawText: 'x\ny',
    latex: 'x\ny',
    canConvertInlineMath: false,
    canConvertBlockMath: true,
  })
  assert.deepEqual(getSmartDocumentSelectedTextState('x', [{ content: [] }, { content: undefined }]), {
    rawText: 'x',
    latex: 'x',
    canConvertInlineMath: false,
    canConvertBlockMath: false,
  })
}

{
  const original = {
    version: 1,
    title: '文档',
    blocks: [{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: '内容' }] }],
    metadata: { createdAt: 'old', updatedAt: 'before' },
  }
  const timestampOnlyChange = {
    ...original,
    metadata: { createdAt: 'new', updatedAt: 'after' },
  }
  assert.equal(areDocumentContentsEqual(original, timestampOnlyChange), true)
  assert.equal(areDocumentContentsEqual(original, { ...original, title: '新标题' }), false)
  assert.deepEqual(prepareStructuredDocumentContentForSave(JSON.stringify(original)), original)
  assert.equal(prepareStructuredDocumentContentForSave('   '), null)
  assert.throws(
    () => prepareStructuredDocumentContentForSave('[1,2,3]'),
    /为防止覆盖，已终止保存/,
  )
  assert.throws(
    () => prepareStructuredDocumentContentForSave('invalid json'),
    /不是有效的 JSON 格式|为防止覆盖，已终止保存/,
  )
}

{
  // 多行引用必须在打开文档时保持为单个 quote 块（文本内含 \n，pre-wrap 渲染换行）；
  // 若按 \n 拆分，下次打开会变成多个独立的引用块。
  const multiLineQuote = normalizeSmartDocumentContent({
    version: 1,
    title: '多行引用',
    blocks: [
      {
        id: 'q1',
        type: 'quote',
        content: [{ type: 'text', text: '第一行\n第二行\n第三行', styles: {} }],
      },
    ],
  }, 'fallback')
  assert.equal(multiLineQuote.blocks.length, 1)
  assert.equal(multiLineQuote.blocks[0].type, 'quote')
  assert.deepEqual(
    (multiLineQuote.blocks[0].content as Array<{ type: string; text: string }>).map((item) => item.text),
    ['第一行\n第二行\n第三行'],
  )

  // 段落仍保持按换行拆分的行为（防巨型单块）。
  const multiLineParagraph = normalizeSmartDocumentContent({
    version: 1,
    title: '多行段落',
    blocks: [
      {
        id: 'p1',
        type: 'paragraph',
        content: [{ type: 'text', text: '第一行\n第二行', styles: {} }],
      },
    ],
  }, 'fallback')
  assert.equal(multiLineParagraph.blocks.length, 2)
  assert.equal(multiLineParagraph.blocks[0].type, 'paragraph')
}

{
  // 引用内回车：仅 quote 块拦截为行内换行，其他块类型放行。
  assert.equal(shouldHandleQuoteEnter('quote'), true)
  assert.equal(shouldHandleQuoteEnter('paragraph'), false)
  assert.equal(shouldHandleQuoteEnter('heading'), false)
  assert.equal(shouldHandleQuoteEnter(undefined), false)
  assert.equal(quoteEnterPayload(), '\n')
}

{
  // 列表项内缩进的代码围栏必须归一化为顶层围栏，否则 markdown-it 不识别：
  // 开围栏被吞进列表、代码变普通文字、闭围栏被误认为新的空代码块。
  const source = '1. 逐个处理临时文件：\n    ```python\n    x = 1\n    y = 2\n```\n1. 内存控制：\n    - 关键点 A'
  assert.equal(containsMarkdownFence(source), true)
  // 双端缩进是此前漏掉的关键路径：粘贴分支也必须识别它，才能进入归一化。
  const bothIndented = '1. 代码：\n    ```python\n    x = 1\n    ```\n1. 后文'
  assert.equal(containsMarkdownFence(bothIndented), true)
  assert.equal(
    normalizeFenceIndentation(bothIndented),
    '1. 代码：\n```python\nx = 1\n```\n1. 后文',
  )
  const normalized = normalizeFenceIndentation(source)
  assert.equal(
    normalized,
    '1. 逐个处理临时文件：\n```python\nx = 1\ny = 2\n```\n1. 内存控制：\n    - 关键点 A',
  )
  // 结束围栏也缩进的情况同样归一化。
  assert.equal(
    normalizeFenceIndentation('    ```js\n    const a = 1\n    ```'),
    '```js\nconst a = 1\n```',
  )
  // 顶层围栏（0-3 空格）不受影响。
  assert.equal(
    normalizeFenceIndentation('```py\nx = 1\n```\n后文'),
    '```py\nx = 1\n```\n后文',
  )
  // 较短 fence 和带尾随内容的 fence 都不能关闭当前代码块。
  assert.equal(
    normalizeFenceIndentation('    ````js\n    const marker = "```"\n    ```\n    after\n    ````'),
    '````js\nconst marker = "```"\n```\nafter\n````',
  )
  assert.equal(
    normalizeFenceIndentation('    ```js\n    code\n    ```not-close\n    tail\n    ```'),
    '```js\ncode\n```not-close\ntail\n```',
  )
  // 无闭合围栏的悬空开围栏保持原样，不做猜测。
  const dangling = '    ```py\nx = 1'
  assert.equal(normalizeFenceIndentation(dangling), dangling)
}

{
  // 文档自定义图标/颜色：hex 颜色校验与图标回退逻辑（用于"修改字体颜色/更换图标"）。
  assert.equal(isValidHexColor('#e74c3c'), true)
  assert.equal(isValidHexColor('#abc'), true)
  assert.equal(isValidHexColor('#abcd'), true)
  assert.equal(isValidHexColor('#aabbccdd'), true)
  assert.equal(isValidHexColor('#12345'), false)
  assert.equal(isValidHexColor('#1234567'), false)
  assert.equal(isValidHexColor('e74c3c'), false)
  assert.equal(isValidHexColor('#gggggg'), false)
  assert.equal(isValidHexColor(''), false)
  assert.equal(resolveDocumentIcon(undefined, '✨'), '✨')
  assert.equal(resolveDocumentIcon('  🚀  ', '✨'), '🚀')
  assert.equal(resolveDocumentIcon('', '✨'), '✨')
}

{
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }

  assert.equal(getExpandedDocumentNodesStorageKey('node-1'), 'topomind_expanded_nodes_node-1')
  assert.deepEqual(parseExpandedDocumentNodeIds(null), [])
  assert.deepEqual(parseExpandedDocumentNodeIds('not-json'), [])
  assert.deepEqual(parseExpandedDocumentNodeIds('{"id":"doc-1"}'), [])
  assert.deepEqual(parseExpandedDocumentNodeIds('["doc-1","",2,"doc-1","doc-2"]'), ['doc-1', 'doc-2'])

  saveExpandedDocumentNodeIds(storage, 'node-1', ['doc-1', 'doc-2'])
  saveExpandedDocumentNodeIds(storage, 'node-2', ['doc-3'])
  assert.deepEqual(Array.from(loadExpandedDocumentNodeIds(storage, 'node-1')), ['doc-1', 'doc-2'])
  assert.deepEqual(Array.from(loadExpandedDocumentNodeIds(storage, 'node-2')), ['doc-3'])
  assert.deepEqual(Array.from(loadExpandedDocumentNodeIds(storage, undefined)), [])

  assert.equal(getDocumentSidebarScrollStorageKey('node-1'), 'topomind_document_sidebar_scroll_node-1')
  assert.equal(loadDocumentSidebarScrollTop(storage, 'node-1'), 0)
  saveDocumentSidebarScrollTop(storage, 'node-1', 268.5)
  saveDocumentSidebarScrollTop(storage, 'node-2', 32)
  assert.equal(loadDocumentSidebarScrollTop(storage, 'node-1'), 268.5)
  assert.equal(loadDocumentSidebarScrollTop(storage, 'node-2'), 32)
  saveDocumentSidebarScrollTop(storage, 'node-1', -10)
  assert.equal(loadDocumentSidebarScrollTop(storage, 'node-1'), 0)
  values.set(getDocumentSidebarScrollStorageKey('node-1'), 'invalid')
  assert.equal(loadDocumentSidebarScrollTop(storage, 'node-1'), 0)

  const fsSync = await import('node:fs')
  const workspaceSource = fsSync.readFileSync(new URL('../src/features/documents/DocumentWorkspace.tsx', import.meta.url), 'utf-8')
  assert.ok(workspaceSource.includes('nodeId={nodeId}'), 'DocumentWorkspace 必须把 nodeId 传给 DocumentSidebar，否则展开状态无法按节点持久化')
  assert.ok(workspaceSource.includes("key={nodeId ?? 'document-sidebar'}"), '节点切换时应重新挂载 DocumentSidebar，避免展开状态串到其他节点')
  const sidebarSource = fsSync.readFileSync(new URL('../src/features/documents/DocumentSidebar.tsx', import.meta.url), 'utf-8')
  assert.ok(sidebarSource.includes('ref={scrollContainerRef}'), '文档列表滚动容器应绑定持久化 ref')
  assert.ok(sidebarSource.includes('onScroll={handleSidebarScroll}'), '文档列表滚动时应保存当前位置')
  const sidebarModelSource = fsSync.readFileSync(new URL('../src/features/documents/model/useDocumentSidebarModel.ts', import.meta.url), 'utf-8')
  assert.ok(sidebarModelSource.includes('lastScrollTopRef.current = scrollTop'), '滚动时应同步记录最后位置，供卸载保存使用')
  assert.ok(sidebarModelSource.includes('saveDocumentSidebarScrollTop(localStorage, nodeId, lastScrollTopRef.current)'), '卸载时应保存最后记录的位置')
  assert.equal(sidebarModelSource.includes('scrollContainerRef.current?.scrollTop ?? 0'), false, '卸载时不能读取已被 React 清空的 DOM ref，否则会用 0 覆盖滚动位置')

  const smartEditorSource = fsSync.readFileSync(new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url), 'utf-8')
  assert.ok(smartEditorSource.includes('persistScrollTop()'), '智能文档滚动 debounce 在卸载时必须同步 flush 最后位置')

  const rightPanelSource = fsSync.readFileSync(new URL('../src/features/right-panel/RightPanelContainer.tsx', import.meta.url), 'utf-8')
  assert.equal(rightPanelSource.includes('<DetailPanel tabId={tabId} isActive={false}'), false, '折叠时不能替换 DetailPanel 实例，否则 dirty close guard 会被重置')
  assert.ok(rightPanelSource.includes("${collapsed ? 'hidden' : 'flex'}"), '折叠应仅隐藏同一组件树并保留文档保存 session')

  const mindMapSource = fsSync.readFileSync(new URL('../src/features/documents/MindMapDocumentEditor/MindMapDocumentEditor.tsx', import.meta.url), 'utf-8')
  assert.ok(mindMapSource.includes('const readOnlyRef = useRef(readOnly)'), '思维导图事件回调必须读取最新 readOnly')
  assert.ok(mindMapSource.includes('onChangeRef.current(updatedValue)'), '思维导图事件回调必须调用最新 onChange')

  const pasteModelSource = fsSync.readFileSync(new URL('../src/features/documents/SmartDocumentEditor/model/useSmartDocumentEditorModel.ts', import.meta.url), 'utf-8')
  assert.ok(pasteModelSource.includes('if (!editorSessionActiveRef.current) return'), '异步远程图片回调必须忽略已卸载 editor session')
}

{
  // 文档自定义 icon/color 持久化链路（纯 Node 无法加载 electron 依赖，改用源码断言验证关键实现存在）：
  // 1. manifest 归一化保留 icon/color（否则重启丢失）；
  // 2. 提供 _fs_updateTopoDocumentMeta 更新函数；
  // 3. IPC 通道已注册并加入 preload 白名单。
  const fsSync = await import('node:fs')
  const fileServiceSource = fsSync.readFileSync(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  assert.ok(fileServiceSource.includes("if (typeof item.icon === 'string' && item.icon.trim()) documents[id].icon = item.icon.slice(0, 32);"), 'manifest 归一化应保留 icon')
  assert.ok(fileServiceSource.includes("if (typeof item.color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(item.color)) documents[id].color = item.color;"), 'manifest 归一化应只保留合法 CSS hex color')
  assert.ok(fileServiceSource.includes('function _fs_updateTopoDocumentMeta('), '应提供 _fs_updateTopoDocumentMeta')
  assert.ok(fileServiceSource.includes('updateTopoDocumentMeta: _fs_updateTopoDocumentMeta'), 'documentService 应挂载 updateTopoDocumentMeta')
  // fileService 是显式转发对象，漏转发会导致运行时 "fileService.updateTopoDocumentMeta is not a function"
  assert.ok(fileServiceSource.includes('updateTopoDocumentMeta: function(rootDir, cardPath, documentId, patch)'), 'fileService 应转发 updateTopoDocumentMeta 到 documentService')
  assert.ok(fileServiceSource.includes('return documentService.updateTopoDocumentMeta(rootDir, cardPath, documentId, patch);'), 'fileService 转发应调用 documentService.updateTopoDocumentMeta')

  const mainSource = fsSync.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf-8')
  assert.ok(mainSource.includes("ipcMain.handle('fs:updateTopoDocumentMeta'"), 'main.js 应注册 fs:updateTopoDocumentMeta IPC')

  const preloadSource = fsSync.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf-8')
  assert.ok(preloadSource.includes("'fs:updateTopoDocumentMeta'"), 'preload.js 白名单应包含 fs:updateTopoDocumentMeta')

  // 2. 前端 hex 颜色校验与图标回退逻辑。
  assert.equal(isValidHexColor('#e74c3c'), true)
  assert.equal(isValidHexColor('#abc'), true)
  assert.equal(isValidHexColor('#abcd'), true)
  assert.equal(isValidHexColor('#aabbccdd'), true)
  assert.equal(isValidHexColor('#12345'), false)
  assert.equal(isValidHexColor('#1234567'), false)
  assert.equal(isValidHexColor('e74c3c'), false)
  assert.equal(isValidHexColor('#gggggg'), false)
  assert.equal(isValidHexColor(''), false)
  assert.equal(resolveDocumentIcon(undefined, '✨'), '✨')
  assert.equal(resolveDocumentIcon('  🚀  ', '✨'), '🚀')
  assert.equal(resolveDocumentIcon('', '✨'), '✨')
}

{
  const events: string[] = []
  let dirty = true
  const unregister = registerTabSaver('regression-tab', async () => {
    events.push('save')
    dirty = false
  }, () => dirty)
  assert.deepEqual(getDirtyState(), { hasDirty: true, dirtyTabIds: ['regression-tab'] })
  assert.deepEqual(await flushTabs(['regression-tab']), { ok: true })
  assert.deepEqual(events, ['save'])
  assert.deepEqual(getDirtyState(), { hasDirty: false, dirtyTabIds: [] })
  unregister()
}

{
  let mutationCount = 0
  const unregister = registerTabSaver('failed-tab', async () => {
    mutationCount += 1
    throw new Error('save failed')
  })
  const result = await flushTabs(['failed-tab'])
  assert.equal(result.ok, false)
  assert.equal(result.failedTabId, 'failed-tab')
  assert.equal(mutationCount, 1)
  unregister()
}

{
  const attempts: string[] = []
  let shouldFail = true
  const coordinator = new SaveCoordinator<string>({
    delayMs: 5,
    save: async (_key, value) => {
      attempts.push(value)
      if (shouldFail) throw new Error('coordinator save failed')
    },
  })
  void coordinator.schedule('retry-key', () => 'draft-v1')
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(coordinator.hasPending('retry-key'), true)
  shouldFail = false
  await coordinator.flush('retry-key', () => 'draft-v1')
  assert.deepEqual(attempts, ['draft-v1', 'draft-v1'])
  assert.equal(coordinator.hasPending('retry-key'), false)
}

{
  const html = convertMarkdownWithMathToHtml('第一行\n第二行\n第三行')
  assert.equal((html.match(/<p>/g) ?? []).length, 3)
  const quoteHtml = convertMarkdownWithMathToHtml('> 第一行\n> 第二行')
  assert.equal((quoteHtml.match(/<blockquote>/g) ?? []).length, 1)
}

{
  const firstBlock = { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'Hello 世界' }] }
  const heading = { id: 'h1', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '标题' }] }
  let blocks = [firstBlock, heading]
  const editor = {
    forEachBlock(visitor: (block: unknown) => boolean) {
      for (const block of blocks) visitor(block)
    },
  }
  const cache = new Map()
  const first = getSmartDocumentOutlineAndStats(editor, cache)
  assert.deepEqual(first.stats, { characters: 9, words: 5, blocks: 2 })
  const cachedParagraph = cache.get('p1')
  getSmartDocumentOutlineAndStats(editor, cache)
  assert.equal(cache.get('p1'), cachedParagraph)
  blocks = [heading]
  const next = getSmartDocumentOutlineAndStats(editor, cache)
  assert.equal(next.stats.blocks, 1)
  assert.equal(cache.has('p1'), false)
}

console.log('Critical regression checks verified')
