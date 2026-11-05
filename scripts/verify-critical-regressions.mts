import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
import {
  flattenVisibleDocumentTree,
  resolveStickyDocumentAncestorIds,
  type DocumentTreeRowLayout,
} from '../src/features/documents/model/documentStickyAncestors.ts'
import type { TopoDocumentManifestItem } from '../src/core/storage/index.ts'
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
  isSameSmartDocumentToc,
  stripHtmlWrapperTags,
  writeClipboardBeforeMutation,
} from '../src/features/documents/SmartDocumentEditor/smartDocumentUtils.ts'
import {
  buildHeadingNumberStyles,
  computeHeadingNumbers,
  formatHeadingNumber,
  isSameHeadingNumbering,
  isSameHeadingNumbers,
  normalizeHeadingNumbering,
  DEFAULT_HEADING_NUMBERING,
  HEADING_NUMBERING_STYLE_OPTIONS,
} from '../src/features/documents/SmartDocumentEditor/headingNumbering.ts'
import {
  buildEditorLayoutVars,
  computeEditorLayoutPixels,
  normalizeEditorLayout,
  DEFAULT_EDITOR_LAYOUT,
} from '../src/features/documents/SmartDocumentEditor/editorLayout.ts'
import {
  areDocumentContentsEqual,
  prepareStructuredDocumentContentForSave,
} from '../src/features/documents/model/documentContentSession.ts'
import { normalizeSmartDocumentContent } from '../src/features/documents/SmartDocumentEditor/smartDocumentTypes.ts'
import {
  containsMarkdownDelimiters,
  containsMathDelimiters,
  containsStrictMarkdownDelimiters,
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
import { normalizeDefaultEdgeStyle } from '../src/domain/style/normalizeStyleConfig.ts'
import { normalizeGraphMeta } from '../src/domain/graph/normalizeGraphMeta.ts'
import {
  clampEdgeAnchor,
  isBorderAnchor,
  normalizeEdgeAnchor,
  offsetBorderPoints,
  projectAnchorToBorder,
  resolveAnchorPoint,
  toEdgeAnchor,
} from '../src/domain/graph/edgeAnchors.ts'
import {
  CURVE_AMPLITUDE_MAX,
  CURVE_AMPLITUDE_MIN,
  CURVE_MODE_DEFAULT_CONTROL,
  CURVE_POSITION_MAX,
  CURVE_POSITION_MIN,
  DEFAULT_CURVE_CONTROL,
  hasCurveDraftChange,
  hasCustomCurve,
  normalizeCurveControl,
  seedCurveControlOnModeSwitch,
} from '../src/domain/graph/edgeCurve.ts'
import { EDGE_COLOR_PRESETS, STYLE_CONFIG_DEFAULTS } from '../src/domain/style/styleDefaults.ts'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT, MAIN_EDGE_WIDTH_RATIO } from '../src/domain/style/styleConstraints.ts'
import { buildEdgeView } from '../src/hooks/useGraph/edgeView.ts'
import { migrateRetiredTheme, DARK_THEME, LIGHT_THEME, isDarkTheme } from '../src/stores/themeStore.ts'

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
  })
  assert.deepEqual(getSmartDocumentSelectedTextState('x\ny', [{ content: [] }]), {
    rawText: 'x\ny',
    latex: 'x\ny',
    canConvertInlineMath: false,
  })
  assert.deepEqual(getSmartDocumentSelectedTextState('x', [{ content: [] }, { content: undefined }]), {
    rawText: 'x',
    latex: 'x',
    canConvertInlineMath: false,
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

  const doc = (id: string, parentId: string | null, sortOrder: number): TopoDocumentManifestItem => ({
    id,
    parentId,
    sortOrder,
    type: 'smart',
    title: id,
    path: `${id}.json`,
    createdAt: 0,
    updatedAt: 0,
    version: 1,
  })
  const documents = [
    doc('root', null, 0),
    doc('child', 'root', 0),
    doc('grandchild', 'child', 0),
    doc('leaf-1', 'grandchild', 0),
    doc('leaf-2', 'grandchild', 1),
    doc('sibling', null, 1),
  ]
  const documentById = new Map(documents.map((item) => [item.id, item]))
  const rows = flattenVisibleDocumentTree(
    [documentById.get('root')!, documentById.get('sibling')!],
    {
      root: [documentById.get('child')!],
      child: [documentById.get('grandchild')!],
      grandchild: [documentById.get('leaf-1')!, documentById.get('leaf-2')!],
    },
    new Set(['root', 'child', 'grandchild']),
  )
  assert.deepEqual(rows.map((row) => row.node.id), ['root', 'child', 'grandchild', 'leaf-1', 'leaf-2', 'sibling'])
  assert.deepEqual(rows.find((row) => row.node.id === 'leaf-2')?.ancestorIds, ['root', 'child', 'grandchild'])

  const layouts: DocumentTreeRowLayout[] = rows.map((row, index) => ({
    row,
    top: index * 32,
    bottom: index * 32 + 30,
  }))
  assert.deepEqual(resolveStickyDocumentAncestorIds(layouts, 0), [])
  assert.deepEqual(resolveStickyDocumentAncestorIds(layouts, 97), ['root', 'child', 'grandchild'])
  assert.deepEqual(resolveStickyDocumentAncestorIds(layouts, 65), ['root', 'child', 'grandchild'])
  assert.deepEqual(resolveStickyDocumentAncestorIds(layouts, 10), [])
  assert.deepEqual(resolveStickyDocumentAncestorIds(layouts, 31), ['root'])
  const collapsedRows = flattenVisibleDocumentTree(
    [documentById.get('root')!, documentById.get('sibling')!],
    { root: [documentById.get('child')!] },
    new Set<string>(),
  )
  assert.deepEqual(collapsedRows.map((row) => row.node.id), ['root', 'sibling'])
  assert.deepEqual(resolveStickyDocumentAncestorIds(collapsedRows.map((row, index) => ({
    row,
    top: index * 32,
    bottom: index * 32 + 30,
  })), 40), [])

  const fsSync = await import('node:fs')
  const workspaceSource = fsSync.readFileSync(new URL('../src/features/documents/DocumentWorkspace.tsx', import.meta.url), 'utf-8')
  assert.ok(workspaceSource.includes('nodeId={nodeId}'), 'DocumentWorkspace 必须把 nodeId 传给 DocumentSidebar，否则展开状态无法按节点持久化')
  assert.ok(workspaceSource.includes("key={nodeId ?? 'document-sidebar'}"), '节点切换时应重新挂载 DocumentSidebar，避免展开状态串到其他节点')
  const sidebarSource = fsSync.readFileSync(new URL('../src/features/documents/DocumentSidebar.tsx', import.meta.url), 'utf-8')
  assert.ok(sidebarSource.includes('ref={scrollContainerRef}'), '文档列表滚动容器应绑定持久化 ref')
  assert.ok(sidebarSource.includes('onScroll={handleSidebarScroll}'), '文档列表滚动时应保存当前位置')
  const rootDocumentMapIndex = sidebarSource.indexOf('{rootItems.map(node => (')
  const rootCreateInputIndex = sidebarSource.indexOf("{inlineEdit?.mode !== 'rename' && !inlineEdit?.parentId && inlineEdit && (")
  assert.ok(rootDocumentMapIndex >= 0 && rootCreateInputIndex > rootDocumentMapIndex, '根层新建输入框必须渲染在已有根文档之后，与同级末尾创建位置一致')
  const sidebarModelSource = fsSync.readFileSync(new URL('../src/features/documents/model/useDocumentSidebarModel.ts', import.meta.url), 'utf-8')
  assert.ok(sidebarModelSource.includes('lastScrollTopRef.current = scrollTop'), '滚动时应同步记录最后位置，供卸载保存使用')
  assert.ok(sidebarModelSource.includes('saveDocumentSidebarScrollTop(localStorage, nodeId, lastScrollTopRef.current)'), '卸载时应保存最后记录的位置')
  assert.equal(sidebarModelSource.includes('scrollContainerRef.current?.scrollTop ?? 0'), false, '卸载时不能读取已被 React 清空的 DOM ref，否则会用 0 覆盖滚动位置')
  // 输入框必须滚进侧栏自己的滚动区，但**不能**用 scrollIntoView：后者会沿祖先链
  // 连带滚动 html/body 与各层 overflow:hidden 的外壳，造成整页漂移（2026-11-03）。
  assert.ok(sidebarModelSource.includes('scrollChildIntoView(container, input)'), '新建或重命名输入框出现后必须滚进侧栏滚动区，保持原位编辑')
  assert.equal(sidebarModelSource.includes("input?.scrollIntoView({ block: 'nearest' })"), false, '不能用 scrollIntoView：它会连带滚动祖先链上的外壳容器，导致整页漂移')
  assert.ok(sidebarModelSource.includes('input.focus({ preventScroll: true })'), '聚焦输入框必须 preventScroll，否则浏览器会自行滚动祖先容器')
  assert.ok(sidebarModelSource.includes('scheduleStickyAncestorSync()'), '滚动热路径必须按动画帧合并吸顶祖先计算')
  const sidebarScrollHandlerSource = sidebarModelSource.slice(
    sidebarModelSource.indexOf('const handleSidebarScroll = useCallback'),
    sidebarModelSource.indexOf('useEffect(() => () => {', sidebarModelSource.indexOf('const handleSidebarScroll = useCallback')),
  )
  assert.ok(sidebarScrollHandlerSource.includes('setTimeout(() =>'), '滚动位置持久化必须延迟到滚动间隙执行')
  assert.equal(sidebarScrollHandlerSource.includes('saveDocumentSidebarScrollTop(localStorage, nodeId, scrollTop)'), false, '滚动事件热路径不能同步写 localStorage')
  assert.ok(sidebarModelSource.includes('stackHeight: Math.max('), '驻留高度必须包含普通列表行间距，避免层级切换阈值抖动')
  assert.ok(sidebarModelSource.includes('setStickyAncestorIds([])'), '节点或展开状态切换时必须立即清空旧驻留路径')
  const contextMenuHandlerSource = sidebarModelSource.slice(
    sidebarModelSource.indexOf('const openContextMenu = useCallback'),
    sidebarModelSource.indexOf('const startRename = useCallback'),
  )
  assert.equal(contextMenuHandlerSource.includes('onSelectDocument('), false, '右键打开菜单不能改变当前选中文档')
  assert.ok(contextMenuHandlerSource.includes('setContextMenu({ x: e.clientX, y: e.clientY, targetId })'), '右键菜单必须保留被点击条目作为操作目标')
  assert.ok(sidebarSource.includes('className="sticky top-0 z-20 h-0"'), '吸顶层必须使用零高度容器，不能推动原树')
  assert.ok(sidebarSource.includes('className="absolute inset-x-0 top-[-8px] flex flex-col gap-0.5 overflow-hidden bg-[var(--color-surface)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[var(--color-border)]"'), '驻留内容必须抵消列表顶部内边距、保持普通树行间距，并且只在整体底部保留一条分隔线')
  assert.equal(sidebarSource.includes('inset-x-[-6px]'), false, '驻留区域不能扩展到普通条目布局之外')
  assert.ok(sidebarSource.includes('renderChildren={false}'), '驻留条目只能渲染自身，不能递归复制整棵子树')
  const documentNodeSource = fsSync.readFileSync(new URL('../src/features/documents/components/DocumentNode.tsx', import.meta.url), 'utf-8')
  assert.equal(documentNodeSource.includes("sticky ? 'mb-0 rounded-none"), false, '驻留条目必须保留普通条目的圆角、间距和背景样式')
  assert.equal(documentNodeSource.includes('shadow-[0_1px_0_var(--color-border)]'), false, '不能为每个驻留条目重复绘制分隔线')

  const smartEditorSource = fsSync.readFileSync(new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url), 'utf-8')
  assert.ok(smartEditorSource.includes('persistScrollTop()'), '智能文档滚动 debounce 在卸载时必须同步 flush 最后位置')
  assert.ok(sidebarSource.includes('data-document-sidebar-root'), '文档侧栏必须提供稳定 DOM 边界供编辑器隔离鼠标事件')
  assert.ok(smartEditorSource.includes("event.target.closest('[data-document-sidebar-root]')"), '块侧边菜单只能在鼠标明确进入文档侧栏时由项目主动隐藏')
  assert.ok(smartEditorSource.includes("editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen()"), '鼠标移动到文档侧栏时必须关闭块侧边菜单')
  assert.equal(smartEditorSource.includes('isWithinEditor(event.target)'), false, '不能对所有编辑器外区域立即隐藏，否则正文到块按钮之间的空隙会导致按钮消失')
  assert.equal(smartEditorSource.includes('editorRoot.contains(event.target)'), false, '块侧边菜单边界不能只依赖 editorRoot，否则 portal 浮层会被误判为外部区域')
  assert.equal(smartEditorSource.includes('<SideMenuController sideMenu={SmartDocumentSideMenu} portalElement={null} />'), false, '块侧边菜单必须使用编辑器专属 portal，才能被 BlockNote 识别为内部浮层')
  const smartSideMenuSource = fsSync.readFileSync(new URL('../src/features/documents/SmartDocumentEditor/components/SmartDocumentSideMenu.tsx', import.meta.url), 'utf-8')
  assert.ok(smartSideMenuSource.includes('referenceX: state.referencePos.x'), '块侧边按钮必须读取 BlockNote 的固定操作列横坐标，不能随块缩进移动')
  assert.ok(smartSideMenuSource.includes('blockElement.getBoundingClientRect().x - sideMenuState.referenceX'), '块侧边菜单必须计算当前块相对固定操作列的缩进量')
  assert.ok(smartSideMenuSource.includes('style={{ paddingRight: `${blockIndent + SIDE_MENU_TEXT_GAP}px` }}'), '块侧边菜单命中区域必须覆盖固定按钮与缩进内容之间的空白通道，并额外留出防误触缓冲')
  const smartEditorStyles = fsSync.readFileSync(new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url), 'utf-8')
  assert.ok(smartEditorStyles.includes('.bn-formatting-toolbar .bn-select,'), '格式工具栏的块类型下拉必须直接获得实体浮层背景，不能依赖缺失的 bn-mantine 祖先')
  assert.ok(smartEditorStyles.includes('.bn-formatting-toolbar .mantine-Menu-item:hover'), '格式工具栏下拉项必须有悬停背景')
  assert.ok(smartEditorStyles.includes('.bn-formatting-toolbar .mantine-Menu-item[aria-selected="true"]'), '格式工具栏下拉项必须有选中态背景')
  assert.ok(smartEditorStyles.includes('.mantine-Tooltip-tooltip:has(.bn-tooltip)'), '格式工具栏 tooltip 必须覆盖 Mantine portal 浮层背景')
  assert.ok(smartEditorStyles.includes('.mantine-Menu-item:has(.bn-tick-icon)'), '块类型下拉当前项必须通过勾选图标呈现稳定选中态')
  assert.ok(smartEditorStyles.includes('flex-wrap: wrap !important;'), '格式工具栏空间不足时必须换行，不能用 overflow 裁剪 tooltip 和子浮层')
  assert.ok(smartEditorStyles.includes('overflow: visible !important;'), '格式工具栏不能裁剪 Tooltip、颜色面板或链接弹窗')
  assert.ok(smartEditorStyles.includes('.bn-color-picker-dropdown'), '颜色面板必须有稳定的实体浮层样式')
  assert.ok(smartEditorStyles.includes('.bn-form-popover'), '链接编辑浮层必须有实体背景')
  assert.ok(smartEditorStyles.includes('.bn-form-popover .mantine-TextInput-input:focus'), '链接编辑输入框必须有清晰的键盘焦点状态')

  const rightPanelSource = fsSync.readFileSync(new URL('../src/features/right-panel/RightPanelContainer.tsx', import.meta.url), 'utf-8')
  assert.equal(rightPanelSource.includes('<DetailPanel tabId={tabId} isActive={false}'), false, '折叠时不能替换 DetailPanel 实例，否则 dirty close guard 会被重置')
  assert.ok(rightPanelSource.includes("${collapsed ? 'hidden' : 'flex'}"), '折叠应仅隐藏同一组件树并保留文档保存 session')

  const mindMapSource = fsSync.readFileSync(new URL('../src/features/documents/MindMapDocumentEditor/MindMapDocumentEditor.tsx', import.meta.url), 'utf-8')
  assert.ok(mindMapSource.includes('const readOnlyRef = useRef(readOnly)'), '思维导图事件回调必须读取最新 readOnly')
  assert.ok(mindMapSource.includes('onChangeRef.current(updatedValue)'), '思维导图事件回调必须调用最新 onChange')

  const pasteModelSource = fsSync.readFileSync(new URL('../src/features/documents/SmartDocumentEditor/model/useSmartDocumentEditorModel.ts', import.meta.url), 'utf-8')
  assert.ok(pasteModelSource.includes('if (!editorSessionActiveRef.current) return'), '异步远程图片回调必须忽略已卸载 editor session')

  const graphEventSource = fsSync.readFileSync(new URL('../src/hooks/useGraph/graphEventHandlers.ts', import.meta.url), 'utf-8')
  assert.ok(graphEventSource.includes('if (!connectionState.isValid && source && target && source !== target)'), '有效 React Flow 连线结束后不能再次合成重复边')
  assert.ok(graphEventSource.includes('const target = connection.target ?? graphUi.connectingTargetId'), '原生连接必须优先使用 React Flow 提供的目标节点')

  const edgeOperationsSource = fsSync.readFileSync(new URL('../src/hooks/useGraph/edgeOperations.ts', import.meta.url), 'utf-8')
  assert.ok(edgeOperationsSource.includes('const alreadyExists = store.edges.some'), '边创建业务层必须包含重复连接幂等保护')

  const canvasModelSource = fsSync.readFileSync(new URL('../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts', import.meta.url), 'utf-8')
  assert.ok(canvasModelSource.includes('if (!connectingSourceId) return null'), '非连线状态不应构建全量吸附空间索引')

  const miniMapSource = fsSync.readFileSync(new URL('../src/features/graph/GraphCanvas/components/CanvasMiniMap.tsx', import.meta.url), 'utf-8')
  assert.ok(miniMapSource.includes('if (!isMiniMapVisible)'), '缩略图不可见时必须跳过完整预览模型派生')
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

// 连线箭头配置：旧存档兼容 + 取值收敛 + 视图映射
{
  // 1) 旧配置没有箭头字段时，必须回落到默认值（不改变既有图谱外观）
  const legacy = normalizeDefaultEdgeStyle({ lineMode: 'straight', lineStyle: 'solid', color: '#7f8c8d', arrow: true }, 2)
  assert.deepEqual(legacy, {
    lineMode: 'straight',
    lineStyle: 'solid',
    // 曲线控制点是后加字段，旧配置无该字段时必须回落 null（直线），不能凭空生成弯曲
    curveControl: null,
    color: '#7f8c8d',
    lineWidth: STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth,
    arrow: true,
    arrowSize: STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize,
    arrowShape: STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape,
    arrowPosition: STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition,
  })

  // 2) 非法/越界取值要被收敛，不能穿透到渲染层
  const sanitized = normalizeDefaultEdgeStyle({ arrowSize: 9999, arrowShape: 'star', arrowPosition: 'middle' })
  assert.equal(sanitized.arrowSize, EDGE_ARROW_SIZE_LIMIT.max)
  assert.equal(sanitized.arrowShape, STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape)
  assert.equal(sanitized.arrowPosition, STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition)

  // 3) 存档里的箭头配置要能被读回，且越界值被 clamp
  const meta = normalizeGraphMeta({
    nodes: {},
    edges: [
      { id: 'e1', source: { ref: 'a' }, target: { ref: 'b' }, arrow: true, arrowSize: 24, arrowShape: 'solid', arrowPosition: 'both' },
      { id: 'e2', source: { ref: 'a' }, target: { ref: 'c' }, arrowSize: 1, arrowShape: 'bogus', arrowPosition: 'sideways' },
    ],
    viewport: {},
  })
  assert.equal(meta.edges[0].arrowSize, 24)
  assert.equal(meta.edges[0].arrowShape, 'solid')
  assert.equal(meta.edges[0].arrowPosition, 'both')
  assert.equal(meta.edges[1].arrowSize, EDGE_ARROW_SIZE_LIMIT.min)
  assert.equal(meta.edges[1].arrowShape, undefined)
  assert.equal(meta.edges[1].arrowPosition, undefined)

  // 4) 视图映射：形状->marker 类型、位置->markerStart/markerEnd
  const solidEnd = buildEdgeView({ arrow: true, arrowShape: 'solid', arrowPosition: 'end', arrowSize: 20 })
  assert.equal(solidEnd.markerEnd?.type, 'arrowclosed')
  assert.equal(solidEnd.markerStart, undefined)
  assert.equal(solidEnd.markerEnd?.width, 20)

  const hollowBoth = buildEdgeView({ arrow: true, arrowShape: 'hollow', arrowPosition: 'both' })
  assert.equal(hollowBoth.markerEnd?.type, 'arrow')
  assert.equal(hollowBoth.markerStart?.type, 'arrow')

  const noArrow = buildEdgeView({ arrow: false, arrowPosition: 'both' })
  assert.equal(noArrow.markerEnd, undefined)
  assert.equal(noArrow.markerStart, undefined)
}

// 连线线条粗细：旧存档兼容 + 主线加粗比例 + 边界收敛
{
  // 1) 旧配置没有 lineWidth 时回落默认，且次线 1.2 / 主线 1.5 与改造前硬编码值一致
  const legacy = normalizeDefaultEdgeStyle({ lineMode: 'straight', lineStyle: 'solid', color: '#7f8c8d', arrow: true }, 2)
  assert.equal(legacy.lineWidth, 1.2)
  assert.equal(buildEdgeView({ lineWidth: legacy.lineWidth, weight: 'minor' }).style?.strokeWidth, 1.2)
  assert.equal(buildEdgeView({ lineWidth: legacy.lineWidth, weight: 'main' }).style?.strokeWidth, 1.5)

  // 2) 越界取值收敛到边界
  assert.equal(normalizeDefaultEdgeStyle({ lineWidth: 999 }).lineWidth, EDGE_LINE_WIDTH_LIMIT.max)
  assert.equal(normalizeDefaultEdgeStyle({ lineWidth: -3 }).lineWidth, EDGE_LINE_WIDTH_LIMIT.min)

  // 3) 主线始终比次线粗，且随用户设定等比放大
  const thick = { minor: buildEdgeView({ lineWidth: 4, weight: 'minor' }).style?.strokeWidth, main: buildEdgeView({ lineWidth: 4, weight: 'main' }).style?.strokeWidth }
  assert.equal(thick.minor, 4)
  assert.equal(thick.main, 4 * MAIN_EDGE_WIDTH_RATIO)
  assert.ok((thick.main as number) > (thick.minor as number))

  // 4) 存档读回保留线宽，越界值被 clamp
  const meta = normalizeGraphMeta({
    nodes: {},
    edges: [
      { id: 'e1', source: { ref: 'a' }, target: { ref: 'b' }, lineWidth: 3 },
      { id: 'e2', source: { ref: 'a' }, target: { ref: 'c' }, lineWidth: 0.01 },
    ],
    viewport: {},
  })
  assert.equal(meta.edges[0].lineWidth, 3)
  assert.equal(meta.edges[1].lineWidth, EDGE_LINE_WIDTH_LIMIT.min)
}

// 连线锚点：只贴边框 + 线头与边框保留间隙 + 存档读入 + 全链路白名单同步
{
  assert.deepEqual(clampEdgeAnchor({ u: 2, v: -1 }), { u: 1, v: 0 })
  assert.equal(normalizeEdgeAnchor({ u: Number.NaN, v: 0.3 }), undefined)
  assert.equal(normalizeEdgeAnchor({ u: 0.5 }), undefined)
  assert.equal(normalizeEdgeAnchor('oops'), undefined)

  const rect = { x: 100, y: 50, width: 200, height: 80 }
  // 框内点一律投影到最近的边框（按像素距离，宽高比不同也不会贴错边）
  assert.deepEqual(projectAnchorToBorder({ u: 0.25, v: 0.75 }, rect), { u: 0.25, v: 1 })
  assert.deepEqual(projectAnchorToBorder({ u: 0.9, v: 0.5 }, rect), { u: 1, v: 0.5 })
  assert.deepEqual(projectAnchorToBorder({ u: 0.5, v: 0 }, rect), { u: 0.5, v: 0 }, '已贴边的点投影必须幂等')
  assert.equal(isBorderAnchor({ u: 0.5, v: 1 }), true)
  assert.equal(isBorderAnchor({ u: 0.5, v: 0.5 }), false)
  assert.deepEqual(resolveAnchorPoint(rect, { u: 0.25, v: 0.75 }), { x: 150, y: 130 })
  assert.equal(resolveAnchorPoint(rect, undefined), undefined)
  assert.deepEqual(toEdgeAnchor(rect, { x: 999, y: -999 }), { u: 1, v: 0 })
  assert.deepEqual(toEdgeAnchor(rect, { x: 150, y: 90 }), { u: 0.25, v: 0 }, '拖到节点内部也必须贴边')
  assert.ok(isBorderAnchor(toEdgeAnchor(rect, { x: 210, y: 95 })!), '任意拖动结果都必须落在边框上')
  assert.deepEqual(
    toEdgeAnchor(rect, resolveAnchorPoint(rect, { u: 0.3, v: 0.6 })!),
    { u: 0.3, v: 1 },
    '边框点 → 画布点 → 锚点 必须往返一致'
  )

  // 铁律：自定义锚点不是线头，线头仍要从边框交点沿连线方向外推 6px
  const heads = offsetBorderPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 6)
  assert.deepEqual(heads, { sx: 6, sy: 0, tx: 94, ty: 0 })
  assert.equal(Math.hypot(heads.sx - 0, heads.sy - 0), 6, '线头与起点锚点必须保持 6px 间隙')
  assert.equal(Math.hypot(heads.tx - 100, heads.ty - 0), 6, '线头与终点锚点必须保持 6px 间隙')
  assert.deepEqual(
    offsetBorderPoints({ x: 0, y: 0 }, { x: 8, y: 0 }, 6),
    { sx: 0, sy: 0, tx: 8, ty: 0 },
    '两点过近时不外推，避免线头越过彼此'
  )

  // 只测纯函数不够：真跑一次 FloatingEdge 用的 getEdgeParams，确认自定义锚点端
  // 同样是「边框交点 + 6px 间隙」，而不是把线头直接焊在锚点手柄上
  const { build: buildFloating } = await import('esbuild')
  const { fileURLToPath: floatingPath } = await import('node:url')
  const floatingBundle = await buildFloating({
    entryPoints: [floatingPath(new URL('../src/features/graph/GraphCanvas/edges/floatingUtils.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const floatingModule = await import(
    `data:text/javascript;base64,${Buffer.from(floatingBundle.outputFiles[0].text).toString('base64')}`
  ) as unknown as {
    getEdgeParams: (source: unknown, target: unknown, anchors: Record<string, unknown>) => {
      sx: number; sy: number; tx: number; ty: number
      sourcePos: string; targetPos: string
      sourceBorder: { x: number; y: number }
      targetBorder: { x: number; y: number }
    }
  }
  const fakeInternalNode = (x: number, y: number, w: number, h: number) => ({
    internals: { positionAbsolute: { x, y } },
    measured: { width: w, height: h },
  })
  const fakeSource = fakeInternalNode(0, 0, 200, 100)
  const fakeTarget = fakeInternalNode(400, 0, 200, 100)
  const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 100) / 100

  const custom = floatingModule.getEdgeParams(fakeSource, fakeTarget, { sourceAnchor: { u: 1, v: 0.8 } })
  assert.deepEqual(custom.sourceBorder, { x: 200, y: 80 }, '自定义锚点必须落在节点边框上')
  assert.equal(gap({ x: custom.sx, y: custom.sy }, custom.sourceBorder), 6, '自定义端线头与边框必须留 6px')
  assert.equal(gap({ x: custom.tx, y: custom.ty }, custom.targetBorder), 6, '自动端线头与边框必须留 6px')
  assert.equal(custom.sourcePos, 'right', '出线方向按锚点所在的边框判断')
  const auto = floatingModule.getEdgeParams(fakeSource, fakeTarget, {})
  assert.equal(gap({ x: auto.sx, y: auto.sy }, auto.sourceBorder), 6, '无锚点时旧算法间隙不变')
  assert.equal(gap({ x: auto.tx, y: auto.ty }, auto.targetBorder), 6, '无锚点时旧算法间隙不变')

  // 老存档没有锚点字段：行为完全不变；越界值读入时必须被夹回节点框内
  const meta = normalizeGraphMeta({
    nodes: {},
    edges: [
      { id: 'e1', source: { ref: 'a' }, target: { ref: 'b' }, sourceAnchor: { u: 0.2, v: 0.8 }, targetAnchor: { u: 9, v: -3 } },
      { id: 'e2', source: { ref: 'a' }, target: { ref: 'c' }, sourceAnchor: 'oops', targetAnchor: { u: 0.5 } },
      { id: 'e3', source: { ref: 'a' }, target: { ref: 'd' } },
    ],
    viewport: {},
  })
  assert.deepEqual(meta.edges[0].sourceAnchor, { u: 0.2, v: 0.8 })
  assert.deepEqual(meta.edges[0].targetAnchor, { u: 1, v: 0 })
  assert.equal(meta.edges[1].sourceAnchor, undefined)
  assert.equal(meta.edges[2].sourceAnchor, undefined)
  assert.equal(meta.edges[2].targetAnchor, undefined)

  // 铁律：新增/删除边字段时，读写、映射、渲染各层必须同步，否则锚点会静默丢失
  const anchorWhitelistFiles = [
    'src/core/storage/file.ts',
    'src/domain/graph/normalizeGraphMeta.ts',
    'src/domain/graph/graphMapper.ts',
    'src/hooks/useGraph/graphBuilder.ts',
    'src/hooks/useGraph/edgeOperations.ts',
    'src/features/graph/GraphCanvas/edges/floatingUtils.ts',
    'src/features/graph/GraphCanvas/components/CanvasMiniMap.tsx',
  ]
  const fsSync = await import('node:fs')
  for (const file of anchorWhitelistFiles) {
    const source = fsSync.readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8')
    assert.ok(source.includes('sourceAnchor') && source.includes('targetAnchor'), `${file} 必须同步透传连线锚点`)
  }

  // 静态断言只保证「文件里出现过字段名」，抓不到「类型声明写了、edges.map 却忘写」的静默丢失。
  // 曾因此导致锚点写盘时整段丢失、重开知识库后复位，所以这里必须真的走一遍写盘往返。
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/core/storage/file.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const storageModule = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  ) as {
    convertGraphToFSB: (graphMeta: ReturnType<typeof normalizeGraphMeta>) => { edges?: Array<Record<string, unknown>> }
    convertFSBToGraph: (raw: unknown) => { edges: Array<Record<string, unknown>> }
  }
  // 序列化一次，模拟真正落盘成 JSON 再读回来
  const written = JSON.parse(JSON.stringify(storageModule.convertGraphToFSB(meta)))
  assert.deepEqual(
    (written.edges?.[0] as Record<string, unknown>).sourceAnchor,
    { u: 0.2, v: 0.8 },
    '起端锚点必须真的写进磁盘 JSON'
  )
  assert.deepEqual(
    (written.edges?.[0] as Record<string, unknown>).targetAnchor,
    { u: 1, v: 0 },
    '末端锚点必须真的写进磁盘 JSON（越界值先夹回边框）'
  )
  const reloaded = storageModule.convertFSBToGraph(written)
  assert.deepEqual(reloaded.edges[0].sourceAnchor, { u: 0.2, v: 0.8 }, '写盘往返后起端锚点不能丢')
  assert.deepEqual(reloaded.edges[0].targetAnchor, { u: 1, v: 0 }, '写盘往返后末端锚点不能丢')
  assert.equal(reloaded.edges[2].sourceAnchor, undefined, '老存档无锚点字段时不应凭空生成')
  assert.equal(reloaded.edges[2].targetAnchor, undefined, '老存档无锚点字段时不应凭空生成')
}

// 连线曲线：归一化 + 几何往返 + 【操作层真跑】+ 默认样式 + 写盘往返
// 铁律：上一版只测了 file.ts 的序列化往返，完全没测 updateEdgeStyle 这个真正的写库入口，
// 结果「曲线参数被变化检测短路、既不写内存也不落盘」整个漏网。这次必须测到 ops 层。
{
  // 1) 控制点归一化：越界钳制、非法回落 null、旧 curveBend 兼容映射
  assert.deepEqual(normalizeCurveControl({ u: 0.3, v: 0.4 }), { u: 0.3, v: 0.4 })
  assert.deepEqual(normalizeCurveControl({ u: -5, v: 9 }), { u: CURVE_POSITION_MIN, v: CURVE_AMPLITUDE_MAX })
  assert.deepEqual(normalizeCurveControl({ u: 5, v: -9 }), { u: CURVE_POSITION_MAX, v: CURVE_AMPLITUDE_MIN })
  assert.equal(normalizeCurveControl({ u: Number.NaN, v: 0.2 }), null)
  assert.equal(normalizeCurveControl(undefined), null)
  assert.equal(normalizeCurveControl(null), null)
  assert.deepEqual(normalizeCurveControl(undefined, 0.5), { u: DEFAULT_CURVE_CONTROL.u, v: 0.3375 })
  assert.equal(hasCustomCurve(null), false)
  assert.equal(hasCustomCurve(DEFAULT_CURVE_CONTROL), false)
  assert.equal(hasCustomCurve({ u: 0.3, v: 0 }), true)
  assert.equal(hasCustomCurve({ u: 0.5, v: 0.2 }), true)

  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundle = async (relativePath: string, extra: Record<string, unknown> = {}) => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      ...extra,
    })
    return import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
    )
  }

  // 2) 几何：控制柄严格落在曲线上（Q(0.5)=P），二维反推必须原样还原 {u,v}
  const floatingModule = await loadBundle('../src/features/graph/GraphCanvas/edges/floatingUtils.ts') as unknown as {
    getCurvedEdgePath: (sx: number, sy: number, tx: number, ty: number, c: { u: number; v: number }) => [string, number, number]
    resolveCurveControlFromDrag: (sx: number, sy: number, tx: number, ty: number, px: number, py: number) => { u: number; v: number }
  }
  for (const control of [{ u: 0.5, v: 0 }, { u: 0.25, v: 0.4 }, { u: 0.72, v: -0.6 }]) {
    const [path, px, py] = floatingModule.getCurvedEdgePath(0, 0, 100, 0, control)
    assert.ok(path.startsWith('M 0,0 Q'), '曲线必须是二次贝塞尔且从起点起笔')
    const back = floatingModule.resolveCurveControlFromDrag(0, 0, 100, 0, px, py)
    assert.ok(Math.abs(back.u - control.u) < 1e-6, `控制点 u 往返必须还原：${control.u} → ${back.u}`)
    assert.ok(Math.abs(back.v - control.v) < 1e-6, `控制点 v 往返必须还原：${control.v} → ${back.v}`)
    // Q(0.5) 必须真的等于 P：0.25S + 0.5C + 0.25T
    const match = /^M 0,0 Q ([-\d.]+),([-\d.]+) 100,0$/.exec(path)
    assert.ok(match, '路径格式应可解析出二次贝塞尔控制点')
    const qMidX = 0.5 * Number(match![1]) + 0.25 * 100
    const qMidY = 0.5 * Number(match![2])
    assert.ok(Math.abs(qMidX - px) < 1e-6, '曲线中点 x 必须等于控制柄位置')
    assert.ok(Math.abs(qMidY - py) < 1e-6, '曲线中点 y 必须等于控制柄位置')
  }

  // 3) 【核心】操作层真跑 updateEdgeStyle：只改曲线参数必须既写内存又落盘。
  //    上一版这里被「8 字段变化检测 + 8 字段 shouldPersist」双重短路，回归完全没覆盖到。
  const opsModule = await loadBundle('../src/hooks/useGraph/edgeOperations.ts', {
    // log-backend 读 window.electronAPI；注入空 window 让 logAction 自然返回 false
    banner: { js: 'globalThis.window = globalThis.window || {};' },
  }) as unknown as {
    buildEdgeOperations: (deps: Record<string, unknown>) => {
      updateEdgeStyle: (edgeId: string, patch: Record<string, unknown>) => Promise<void>
      addEdge: (connection: Record<string, unknown>, edgeId: string, defaultStyle?: Record<string, unknown>) => Promise<boolean>
    }
  }
  let edges: Array<Record<string, unknown>> = [{
    id: 'e1', source: 'a', target: 'b', type: 'curve',
    data: {
      relation: '相关', weight: 'minor', lineMode: 'curve', lineStyle: 'solid',
      color: '#111111', lineWidth: 1.2, arrow: true, arrowSize: 12,
      arrowShape: 'hollow', arrowPosition: 'end',
    },
  }]
  let setEdgesCalls = 0
  let saveLaterCalls = 0
  const ops = opsModule.buildEdgeOperations({
    getActiveGraphSession: () => ({ roomPath: 'room-a' }),
    saveNow: async () => {},
    saveLater: async () => { saveLaterCalls++ },
    storeApi: {
      getState: () => ({
        edges,
        setEdges: (next: Array<Record<string, unknown>>) => { edges = next; setEdgesCalls++ },
      }),
    },
  })

  await ops.updateEdgeStyle('e1', { curveControl: { u: 0.3, v: 0.4 } })
  assert.equal(setEdgesCalls, 1, '只改曲线参数必须写内存 store（上一版被变化检测短路）')
  assert.equal(saveLaterCalls, 1, '只改曲线参数必须触发落盘（上一版被 shouldPersist 白名单挡掉）')
  assert.deepEqual((edges[0].data as Record<string, unknown>).curveControl, { u: 0.3, v: 0.4 }, '写入的控制点值必须正确')

  await ops.updateEdgeStyle('e1', { selected: true })
  assert.equal(saveLaterCalls, 1, '纯选中态变化不应落盘')
  assert.equal((edges[0].data as Record<string, unknown>).selected, true)

  await ops.updateEdgeStyle('e1', { curveControl: null })
  assert.equal(saveLaterCalls, 2, '显式 null 复位弯曲也要落盘')
  assert.equal((edges[0].data as Record<string, unknown>).curveControl, null)

  const callsBefore = setEdgesCalls
  await ops.updateEdgeStyle('e1', { curveControl: null })
  assert.equal(setEdgesCalls, callsBefore, '重复写入相同值不应产生多余写库')

  // 未来新增任意样式字段也应自动透传（通用字段检测，而非白名单）
  await ops.updateEdgeStyle('e1', { someFutureStyleField: 'x' } as Record<string, unknown>)
  assert.equal(saveLaterCalls, 3, '未知/未来样式字段也必须透传并落盘')
  assert.equal((edges[0].data as Record<string, unknown>).someFutureStyleField, 'x')

  // 4) 默认样式：lineMode='curve' 与 curveControl 读配置时都不能被吞掉
  const defaultStyle = normalizeDefaultEdgeStyle({
    lineMode: 'curve',
    curveControl: { u: 0.25, v: -0.6 },
  })
  assert.equal(defaultStyle.lineMode, 'curve', '默认线型选曲线后刷新不能被重置回直线')
  assert.deepEqual(defaultStyle.curveControl, { u: 0.25, v: -0.6 }, '默认控制点读配置不能丢')

  // 5) 铁律：curveControl 必须真的写进磁盘 JSON 并在往返后不丢
  const meta = normalizeGraphMeta({
    nodes: {},
    edges: [
      { id: 'e1', source: { ref: 'a' }, target: { ref: 'b' }, lineMode: 'curve', curveControl: { u: 0.3, v: 0.4 } },
      { id: 'e2', source: { ref: 'a' }, target: { ref: 'c' }, lineMode: 'curve', curveControl: { u: 0.72, v: -0.6 } },
      { id: 'e3', source: { ref: 'a' }, target: { ref: 'd' }, lineMode: 'curve' },
      { id: 'e4', source: { ref: 'a' }, target: { ref: 'e' }, lineMode: 'curve', curveBend: 0.5 },
    ],
    viewport: {},
  })
  assert.deepEqual(meta.edges[0].curveControl, { u: 0.3, v: 0.4 }, 'normalizeGraphMeta 必须保留控制点')
  assert.equal(meta.edges[2].curveControl, null, '缺失控制点的曲线边应回落为 null')
  assert.ok(meta.edges[3].curveControl, '旧版 curveBend 存档应被兼容映射成控制点')

  const storageModule = await loadBundle('../src/core/storage/file.ts') as {
    convertGraphToFSB: (graphMeta: ReturnType<typeof normalizeGraphMeta>) => { edges?: Array<Record<string, unknown>> }
    convertFSBToGraph: (raw: unknown) => { edges: Array<Record<string, unknown>> }
  }
  // 序列化一次，模拟真正落盘成 JSON 再读回来
  const written = JSON.parse(JSON.stringify(storageModule.convertGraphToFSB(meta)))
  assert.equal((written.edges?.[0] as Record<string, unknown>).lineMode, 'curve', '曲线模式必须写进磁盘 JSON')
  assert.deepEqual((written.edges?.[0] as Record<string, unknown>).curveControl, { u: 0.3, v: 0.4 }, '控制点必须真的写进磁盘 JSON')
  assert.deepEqual((written.edges?.[1] as Record<string, unknown>).curveControl, { u: 0.72, v: -0.6 }, '弯曲位置变化必须写进磁盘 JSON')
  const reloaded = storageModule.convertFSBToGraph(written)
  assert.equal(reloaded.edges[0].lineMode, 'curve', '写盘往返后曲线模式不能丢')
  assert.deepEqual(reloaded.edges[0].curveControl, { u: 0.3, v: 0.4 }, '写盘往返后控制点不能丢')
  assert.deepEqual(reloaded.edges[1].curveControl, { u: 0.72, v: -0.6 }, '写盘往返后弯曲位置不能丢')
  assert.equal(reloaded.edges[2].curveControl, null, '写盘往返后缺失控制点应回落为 null')

  // 6) 批次 A：从其它线型切到「曲线」必须给一个可见弧度，不能点了曲线还是直线
  assert.notEqual(CURVE_MODE_DEFAULT_CONTROL.v, 0, '切到曲线时的默认弧度必须可见')
  assert.deepEqual(seedCurveControlOnModeSwitch('curve', 'straight', null), CURVE_MODE_DEFAULT_CONTROL,
    '直线 → 曲线且无自定义形态时必须注入默认弧度')
  assert.equal(seedCurveControlOnModeSwitch('curve', 'curve', null), null,
    '已经是曲线时不应重复注入（复位成直线后不能被再次改弯）')
  assert.equal(seedCurveControlOnModeSwitch('curve', 'straight', { u: 0.3, v: 0 }), null,
    '已有自定义形态时必须保留，不能被默认弧度覆盖')
  assert.equal(seedCurveControlOnModeSwitch('straight', 'curve', null), null,
    '切到非曲线线型不应注入控制点')

  // 7) 批次 A：滑杆草稿提交判定 —— 点击轨道 / 拖回原值都不该白写一次库
  assert.equal(hasCurveDraftChange({ u: 0.5, v: 0.25 }, { u: 0.5, v: 0.25 }), false)
  assert.equal(hasCurveDraftChange({ u: 0.5, v: 0.25 }, { u: 0.5, v: 0.26 }), true)
  assert.equal(hasCurveDraftChange({ u: 0.5, v: 0.25 }, { u: 0.51, v: 0.25 }), true)
  // 组件结构约束：range 每帧只能改草稿，松手 / 键盘 / 失焦才提交。
  // 精确截取 CurveSlider 函数体再断言，避免同文件其它函数把字面量断言"蒙混过关"。
  const panelSource = await readFile(
    fileURLToPath(new URL('../src/features/right-panel/components/StyleTab/EdgeStylePanel.tsx', import.meta.url)),
    'utf8',
  )
  const sliderBody = panelSource.slice(
    panelSource.indexOf('function CurveSlider('),
    panelSource.indexOf('function CurveControlFields('),
  )
  assert.ok(sliderBody.length > 0, '必须能定位到 CurveSlider 组件')
  assert.ok(sliderBody.includes('onDraftChange(Number(e.target.value))'), 'range 每帧只能更新草稿')
  assert.ok(sliderBody.includes('onPointerUp={onCommit}') && sliderBody.includes('onBlur={onCommit}'),
    '松手 / 失焦必须提交一次（拖一次滑杆只写一次库）')
  const sliderOnChange = sliderBody.split('\n').find((line) => line.trim().startsWith('onChange=')) ?? ''
  assert.ok(sliderOnChange.includes('onDraftChange') && !sliderOnChange.includes('onCommit'),
    'range 的 onChange 只能改草稿，不能每帧直接写库')

  // 8) 批次 A：旧配置「曲线 + 无控制点」刷新后也要补出弧度；显式直线形态必须被尊重
  assert.deepEqual(normalizeDefaultEdgeStyle({ lineMode: 'curve' }).curveControl, CURVE_MODE_DEFAULT_CONTROL,
    '旧配置只有 lineMode=curve 时刷新后必须补出可见弧度')
  assert.deepEqual(
    normalizeDefaultEdgeStyle({ lineMode: 'curve', curveControl: { u: 0.5, v: 0 } }).curveControl,
    { u: 0.5, v: 0 },
    '显式存了直线形态（v=0）必须被尊重',
  )
  assert.equal(normalizeDefaultEdgeStyle({ lineMode: 'straight' }).curveControl, null,
    '非曲线默认样式不应凭空生成控制点')

  // 9) 批次 A：新建曲线边继承默认样式时同样不能退化成直线（操作层真跑）
  const created = await ops.addEdge({ source: 'x', target: 'y' }, 'e-new', { lineMode: 'curve' })
  assert.equal(created, true, '新建曲线边应成功')
  const createdEdge = edges.find((edge) => edge.id === 'e-new')
  assert.ok(createdEdge, '新建边必须进入 store')
  assert.deepEqual((createdEdge!.data as Record<string, unknown>).curveControl, CURVE_MODE_DEFAULT_CONTROL,
    '默认线型为曲线且未带控制点时，新建边也必须有可见弧度')

  // 10) 批次 A：写盘 JSON 不再为每条边写 "curveControl": null，往返语义仍不变
  assert.ok(!('curveControl' in (written.edges?.[2] as Record<string, unknown>)),
    '空的曲线控制点不应写进磁盘 JSON（万级边时避免白白膨胀）')

  // 11) 批次 B：弯曲位置收紧到二次贝塞尔的安全区间，端点切线不得反向（消除回勾）
  //     C 沿连线方向的投影 = L·(2u - 0.5)，u<0.25 或 u>0.75 会把 C 推到端点外侧。
  assert.equal(CURVE_POSITION_MIN, 0.25, '弯曲位置下界必须是 C 投影不越过起点的临界值')
  assert.equal(CURVE_POSITION_MAX, 0.75, '弯曲位置上界必须是 C 投影不越过终点的临界值')
  assert.deepEqual(normalizeCurveControl({ u: 0.15, v: 0.3 }), { u: CURVE_POSITION_MIN, v: 0.3 },
    '旧存档里越界的弯曲位置读入时应平滑钳到新边界，不能把整条曲线丢掉')
  assert.deepEqual(normalizeCurveControl({ u: 0.85, v: 0.3 }), { u: CURVE_POSITION_MAX, v: 0.3 })
  // 真跑几何：水平连线 S(0,0)→T(100,0)，解析路径里的 C，
  // 断言 C.x ∈ [0,100] 且 x(t) 单调不减（不回勾、不从节点里钻出来）
  for (const u of [CURVE_POSITION_MIN, 0.5, CURVE_POSITION_MAX]) {
    for (const v of [-1, 0.4, 1]) {
      const [path] = floatingModule.getCurvedEdgePath(0, 0, 100, 0, { u, v })
      const match = /^M 0,0 Q ([-\d.]+),([-\d.]+) 100,0$/.exec(path)
      assert.ok(match, '曲线路径必须能解析出二次贝塞尔控制点')
      const cx = Number(match![1])
      assert.ok(cx >= -1e-6 && cx <= 100 + 1e-6,
        `u=${u} v=${v} 时贝塞尔控制点投影不得越过两端（否则端点回勾）`)
      let prevX = -Infinity
      for (let i = 0; i <= 20; i++) {
        const t = i / 20
        const x = 2 * t * (1 - t) * cx + t * t * 100
        assert.ok(x >= prevX - 1e-6, `u=${u} v=${v} 时曲线沿连线方向必须单调，不能回勾`)
        prevX = x
      }
    }
  }
  // 拖拽反推同样受新边界约束（把手柄拖到节点外不会写回越界控制点）
  assert.equal(
    floatingModule.resolveCurveControlFromDrag(0, 0, 100, 0, -100, 50).u,
    CURVE_POSITION_MIN,
    '拖到起点外侧时弯曲位置必须钳到下界',
  )
  assert.equal(
    floatingModule.resolveCurveControlFromDrag(0, 0, 100, 0, 200, 50).u,
    CURVE_POSITION_MAX,
    '拖到终点外侧时弯曲位置必须钳到上界',
  )

  // 12) 批次 B：删除连线必须先过全局模态确认框，取消时不得删除
  const edgeSource = await readFile(
    fileURLToPath(new URL('../src/features/graph/GraphCanvas/edges/FloatingEdge.tsx', import.meta.url)),
    'utf8',
  )
  assert.ok(edgeSource.includes("import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'"),
    '删除确认必须走 shared/ui 的全局统一模态（ConfirmModal 已在 App.tsx 挂载）')
  assert.ok(edgeSource.includes('onDelete={handleDelete}'), '工具栏删除按钮必须接到带确认的处理函数')
  const deleteBody = edgeSource.slice(
    edgeSource.indexOf('const handleDelete = useCallback('),
    edgeSource.indexOf('const handleCurveCommit = useCallback('),
  )
  assert.ok(deleteBody.length > 0, '必须能定位到 handleDelete 函数体')
  assert.ok(deleteBody.includes('await confirm({') && deleteBody.includes('if (!confirmed) return'),
    'handleDelete 必须等待确认结果，取消时不得删除')
  assert.ok(deleteBody.includes('await deleteEdge(id)'), '确认后才真正删除连线')
  assert.ok(!deleteBody.includes('void deleteEdge(id)'), '不允许未确认就直接删除')

  // 13) 浮窗快捷样式面板发出的四类 patch 必须真的写内存 + 落盘（不能重蹈白名单漏字段）
  const beforeQuick = { setEdges: setEdgesCalls, saveLater: saveLaterCalls }
  await ops.updateEdgeStyle('e1', { lineMode: 'smoothstep' })
  await ops.updateEdgeStyle('e1', { lineStyle: 'dashed' })
  await ops.updateEdgeStyle('e1', { lineWidth: 2.5 })
  await ops.updateEdgeStyle('e1', { color: '#abcdef' })
  await ops.updateEdgeStyle('e1', { lineMode: 'curve', curveControl: CURVE_MODE_DEFAULT_CONTROL })
  assert.equal(setEdgesCalls - beforeQuick.setEdges, 5, '浮窗每次样式改动都必须写内存 store')
  assert.equal(saveLaterCalls - beforeQuick.saveLater, 5, '浮窗每次样式改动都必须触发落盘')
  const quickData = edges[0].data as Record<string, unknown>
  assert.equal(quickData.lineMode, 'curve', '浮窗切曲线必须生效')
  assert.deepEqual(quickData.curveControl, CURVE_MODE_DEFAULT_CONTROL, '浮窗切曲线必须带上可见默认弧度')
  assert.equal(quickData.lineStyle, 'dashed', '浮窗切换实线/虚线必须生效')
  assert.equal(quickData.lineWidth, 2.5, '浮窗设置粗细必须生效')
  assert.equal(quickData.color, '#abcdef', '浮窗设置颜色必须生效')
  await ops.updateEdgeStyle('e1', { lineWidth: 999 })
  assert.equal((edges[0].data as Record<string, unknown>).lineWidth, EDGE_LINE_WIDTH_LIMIT.max,
    '浮窗传入越界粗细仍须被 clamp（与右侧面板一致）')
}

// 连线浮窗快捷样式面板：四类控件齐全 + 不撑宽工具栏 + 粗细一次拖动一次提交 + 色板单一来源
{
  const { fileURLToPath } = await import('node:url')
  const readSource = (relativePath: string) => readFile(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  )
  const popover = await readSource('../src/features/graph/GraphCanvas/edges/QuickEdgeStylePopover.tsx')
  const toolbar = await readSource('../src/features/graph/GraphCanvas/edges/QuickEdgeToolbar.tsx')
  const floating = await readSource('../src/features/graph/GraphCanvas/edges/FloatingEdge.tsx')
  const styleControls = await readSource('../src/features/right-panel/components/StyleTab/StyleControls.tsx')

  // 四类控件都要在（用户要求的「线型、线条、线条粗细、连线颜色」）
  for (const label of ['线型', '线条', '线条粗细 (px)', '连线颜色']) {
    assert.ok(popover.includes(label), `浮窗快捷面板必须提供「${label}」设置`)
  }
  assert.ok(popover.includes('SegmentedControl'), '互斥单选必须复用统一 SegmentedControl')
  assert.ok(popover.includes('onChange({ lineStyle:'), '线条切换必须写回 lineStyle')
  assert.ok(popover.includes('onCommit={(lineWidth) => onChange({ lineWidth })}'), '粗细提交必须写回 lineWidth')
  assert.ok(popover.includes('onChange({ color: preset })'), '预设色板必须写回 color')
  // 切曲线复用领域层注入规则，避免浮窗切过去还是一条直线
  assert.ok(popover.includes('seedCurveControlOnModeSwitch('), '浮窗切曲线必须复用默认弧度注入规则')
  assert.ok(popover.includes('{ lineMode: next, curveControl: seed }'), '注入的控制点必须与线型一起提交')

  // 面板必须 absolute：EdgeToolbarAnchor 用 ResizeObserver 量工具栏尺寸做避让，
  // 面板若参与文档流会把工具栏撑大 → 展开/收起时浮层位置跳动。
  assert.ok(/className="[^"]*\babsolute\b[^"]*"/.test(popover), '快捷面板必须 absolute 定位，不能改变工具栏尺寸')
  assert.ok(toolbar.includes('nodrag nopan relative flex items-center'), '工具栏根容器必须 relative 供面板定位')

  // 粗细滑杆：range 每帧只改草稿，松手 / 键盘 / 失焦才提交一次
  const widthBody = popover.slice(
    popover.indexOf('function WidthSlider('),
    popover.indexOf('export default function QuickEdgeStylePopover('),
  )
  assert.ok(widthBody.length > 0, '必须能定位到 WidthSlider 函数体')
  assert.ok(widthBody.includes('onChange={(e) => updateDraft(Number(e.target.value))}'),
    'range 每帧只能更新草稿')
  assert.ok(widthBody.includes('onPointerUp={commit}') && widthBody.includes('onBlur={commit}'),
    '松手 / 失焦必须提交一次（拖一次滑杆只写一次库）')
  const widthOnChange = widthBody.split('\n').find((line) => line.trim().startsWith('onChange=')) ?? ''
  assert.ok(widthOnChange.includes('updateDraft') && !widthOnChange.includes('onCommit'),
    '粗细 range 的 onChange 不能直接写库')

  // 颜色预设只定义一份（单色制铁律），右侧面板改为引用 domain 层常量
  assert.ok(styleControls.includes('EDGE_COLOR_PRESETS as COLOR_PRESETS'),
    '右侧样式面板必须引用共享色板常量')
  assert.ok(!/const COLOR_PRESETS\s*=\s*\[/.test(styleControls),
    'StyleControls 不应再自己写一份 hex 色板')
  assert.equal(EDGE_COLOR_PRESETS.length, 6, '预设色板数量应保持不变')
  assert.ok(EDGE_COLOR_PRESETS.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)), '预设色必须是合法 hex')

  // 接线：浮窗所有改动直达 updateEdgeStyle，工具栏色块也走同一入口
  assert.ok(toolbar.includes('onStyleChange: (patch: EdgeStylePatch) => void'), '浮窗必须有统一样式写入口')
  assert.ok(toolbar.includes('<QuickEdgeStylePopover edgeStyle={edgeStyle} onChange={onStyleChange} />'),
    '展开的面板必须接到统一样式写入口')
  assert.ok(toolbar.includes('onStyleChange({ color: event.target.value })'), '工具栏色块也必须走统一入口')
  assert.ok(floating.includes('edgeStyle={quickEdgeStyle}') && floating.includes('onStyleChange={handleStyleChange}'),
    'FloatingEdge 必须把样式快照与统一入口传给浮窗菜单')
  assert.ok(floating.includes('void updateEdgeStyle(id, patch)'), '浮窗样式改动必须落到 updateEdgeStyle')
}

// 主题收归为浅色/深色两套：已下线主题必须迁移到正确的一套，否则菜单勾选会悬空
{
  assert.equal(LIGHT_THEME, 'github-light')
  assert.equal(DARK_THEME, 'dark')
  assert.equal(isDarkTheme(DARK_THEME), true)
  assert.equal(isDarkTheme(LIGHT_THEME), false)

  for (const retired of ['light', 'notion-light', 'linear-light', 'nord-light', 'rose-pine-dawn', 'catppuccin-latte', 'solarized-light']) {
    assert.equal(migrateRetiredTheme(retired), LIGHT_THEME, `${retired} 应迁移到浅色`)
  }
  for (const retired of ['dracula', 'monokai', 'github-dark', 'solarized-dark', 'one-dark-pro', 'tokyo-night', 'catppuccin-mocha']) {
    assert.equal(migrateRetiredTheme(retired), DARK_THEME, `${retired} 应迁移到深色`)
  }

  // 迁移结果必须仍属于当前支持的两套，且当前主题本身不应被当成已下线主题
  assert.equal(migrateRetiredTheme('tokyo-night'), DARK_THEME)
  assert.equal(migrateRetiredTheme('notion-light'), LIGHT_THEME)
  assert.equal(migrateRetiredTheme(LIGHT_THEME), null)
  assert.equal(migrateRetiredTheme(DARK_THEME), null)
  assert.equal(migrateRetiredTheme('unknown-theme'), null)
}

// 标题自动编号：压平规则 / 深度 / 四种预设 / 配置往返 / 动态样式表
{
  assert.deepEqual(DEFAULT_HEADING_NUMBERING, { enabled: false, style: 'decimal', depth: 3 })
  assert.deepEqual(normalizeHeadingNumbering(undefined), DEFAULT_HEADING_NUMBERING)
  assert.deepEqual(normalizeHeadingNumbering({ enabled: true, style: 'unknown', depth: 99 }), {
    enabled: true,
    style: 'decimal',
    depth: 6,
  })
  assert.equal(isSameHeadingNumbering({ enabled: true, style: 'decimal', depth: 3 }, { enabled: true, style: 'decimal', depth: 3 }), true)
  assert.equal(isSameHeadingNumbering({ enabled: true }, { enabled: false }), false)

  const items = [
    { id: 'a', level: 1, text: '项目背景' },
    { id: 'b', level: 2, text: '目标与范围' },
    { id: 'c', level: 3, text: '数据口径' },
    { id: 'd', level: 4, text: '约束条件' },
  ]
  const decimal = { enabled: true, style: 'decimal', depth: 3 }
  // 单级编号带尾点（「1. 标题」），多级保持 1.1 / 1.1.1 不变
  assert.deepEqual(computeHeadingNumbers(items, decimal), { a: '1.', b: '1.1', c: '1.1.1' })

  // 压平：H1 后直接 H3 得 1.1（不是 Word 的 1.0.1）；只有 H2 开头得 1.（不是 0.1）
  assert.deepEqual(computeHeadingNumbers([items[0], { ...items[2], id: 'x' }], decimal), { a: '1.', x: '1.1' })
  assert.deepEqual(computeHeadingNumbers([
    { id: 'h2', level: 2, text: '甲' },
    { id: 'h1', level: 1, text: '乙' },
  ], decimal), { h2: '1.', h1: '2.' })
  assert.deepEqual(computeHeadingNumbers([items[0], items[2], { ...items[2], id: 'x2' }], decimal), {
    a: '1.', c: '1.1', x2: '1.2',
  })
  // 新的一级章节：下级重新从 1 开始（Word 行为）
  assert.deepEqual(computeHeadingNumbers([
    items[0], items[1], { ...items[0], id: 'a2' }, { ...items[1], id: 'b2' },
  ], decimal), { a: '1.', b: '1.1', a2: '2.', b2: '2.1' })

  // 用户实报 BUG：4.1.1 / 4.1.2 之后切到 4.2，子标题必须 4.2.1 而不是 4.2.3。
  // 原因是 layerHistory 只在顶级递增时截断，中间层(H2)递增后残留了第 3 层计数。
  assert.deepEqual(computeHeadingNumbers([
    { id: 'k1', level: 1, text: '1' }, { id: 'k2', level: 1, text: '2' },
    { id: 'k3', level: 1, text: '3' }, { id: 'k4', level: 1, text: '4' },
    { id: 's41', level: 2, text: '4.1' },
    { id: 's411', level: 3, text: '4.1.1' }, { id: 's412', level: 3, text: '4.1.2' },
    { id: 's42', level: 2, text: '4.2' },
    { id: 's421', level: 3, text: '4.2.1' }, { id: 's422', level: 3, text: '4.2.2' },
    { id: 's43', level: 2, text: '4.3' }, { id: 's431', level: 3, text: '4.3.1' },
  ], decimal), {
    k1: '1.', k2: '2.', k3: '3.', k4: '4.',
    s41: '4.1', s411: '4.1.1', s412: '4.1.2',
    s42: '4.2', s421: '4.2.1', s422: '4.2.2',
    s43: '4.3', s431: '4.3.1',
  })
  // 中间层章节切换 + 顶级章节切换，都要让所有更深层重新从 1 开始
  assert.deepEqual(computeHeadingNumbers([
    items[0], items[1], items[2], { ...items[2], id: 'c2' },
    { ...items[1], id: 'b2' }, { ...items[2], id: 'c3' },
    { ...items[0], id: 'a2' }, { ...items[1], id: 'b3' }, { ...items[2], id: 'c4' },
  ], decimal), {
    a: '1.', b: '1.1', c: '1.1.1', c2: '1.1.2',
    b2: '1.2', c3: '1.2.1',
    a2: '2.', b3: '2.1', c4: '2.1.1',
  })
  // 四种样式同样共用这套计数器，不能只在 decimal 下正确
  assert.deepEqual(computeHeadingNumbers([
    items[0], items[1], items[2], { ...items[1], id: 'b2' }, { ...items[2], id: 'c2' },
  ], { ...decimal, style: 'chapter' }), {
    a: '第一章', b: '1.1', c: '1.1.1', b2: '1.2', c2: '1.2.1',
  })

  // 深度：H4 不编号也不占号，随后的 H2 继续 1.2；关闭时全部清空；空标题不占号
  assert.deepEqual(computeHeadingNumbers([
    ...items.slice(0, 3), items[3], { id: 'e', level: 2, text: '范围' },
  ], decimal), { a: '1.', b: '1.1', c: '1.1.1', e: '1.2' })
  assert.deepEqual(computeHeadingNumbers(items, { ...decimal, enabled: false }), {})
  assert.deepEqual(computeHeadingNumbers([
    items[0], { id: 'empty', level: 1, text: '   ' }, { id: 'f', level: 1, text: '下一章' },
  ], decimal), { a: '1.', f: '2.' })

  // 四种样式
  assert.deepEqual(computeHeadingNumbers(items, { ...decimal, style: 'chapter' }), {
    a: '第一章', b: '1.1', c: '1.1.1',
  })
  assert.deepEqual(computeHeadingNumbers(items, { ...decimal, style: 'cjk' }), {
    a: '一、', b: '（一）', c: '1.',
  })
  assert.deepEqual(computeHeadingNumbers(items, { ...decimal, style: 'alpha' }), {
    a: 'A.', b: 'A.1', c: 'A.1.a',
  })

  // 单级编号带尾点：只作用于纯拉丁数字/字母；多级编号与自带标点的中文样式一律不变。
  // 用户实报：「1 标题」应显示「1. 标题」，而「1.1 / 1.1.1 标题」保持现状。
  assert.equal(formatHeadingNumber([1], 'decimal'), '1.')
  assert.equal(formatHeadingNumber([12], 'decimal'), '12.')
  assert.equal(formatHeadingNumber([1, 1], 'decimal'), '1.1')
  assert.equal(formatHeadingNumber([1, 1, 1], 'decimal'), '1.1.1')
  assert.equal(formatHeadingNumber([1], 'chapter'), '第一章')
  assert.equal(formatHeadingNumber([1], 'cjk'), '一、')
  assert.equal(formatHeadingNumber([1], 'alpha'), 'A.')
  assert.equal(formatHeadingNumber([27], 'alpha'), 'AA.')
  assert.equal(formatHeadingNumber([1, 1], 'alpha'), 'A.1')
  assert.equal(formatHeadingNumber([11], 'chapter'), '第十一章')
  assert.equal(formatHeadingNumber([1, 2, 3, 4], 'cjk'), '(4)')
  assert.equal(formatHeadingNumber([], 'decimal'), '')
  // 工具栏下拉的示例文案必须与实际显示一致（否则选样式时看到的是错的预览）
  assert.equal(HEADING_NUMBERING_STYLE_OPTIONS.find((o) => o.value === 'decimal')?.preview, '1. / 1.1 / 1.1.1')
  assert.equal(HEADING_NUMBERING_STYLE_OPTIONS.find((o) => o.value === 'alpha')?.preview, 'A. / A.1 / A.1.a')
  assert.equal(HEADING_NUMBERING_STYLE_OPTIONS.find((o) => o.value === 'chapter')?.preview, '第一章 / 1.1 / 1.1.1')

  // 配置必须真跑「归一化 → JSON 写盘 → 读回」往返：漏在 normalizeSmartDocumentContent
  // 里透传字段会导致「开关不生效 / 重开文档设置丢失」（与连线曲线字段同型）。
  const source = {
    schema: 'topomind.smart-document',
    version: 1,
    title: '编号测试',
    blocks: [{ id: 'b1', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: '标题' }] }],
    numbering: { enabled: true, style: 'chapter', depth: 4 },
  }
  const normalized = normalizeSmartDocumentContent(source, '回退标题')
  const restored = normalizeSmartDocumentContent(JSON.parse(JSON.stringify(normalized)), '回退标题')
  assert.deepEqual(restored.numbering, { enabled: true, style: 'chapter', depth: 4 })
  // normalize 会给块补 children: undefined，序列化后消失；按 JSON 后的实际写盘内容比较
  assert.deepEqual(JSON.parse(JSON.stringify(restored.blocks)), source.blocks)
  // 旧文档没有该字段时不要凭空写入，保持「缺省即关闭、零影响」
  assert.equal('numbering' in normalizeSmartDocumentContent({ schema: 'topomind.smart-document', version: 1, blocks: [] }, 'F'), false)

  // 目录与正文同源：number 变化必须让目录重新发布
  assert.equal(isSameSmartDocumentToc(
    [{ id: 'a', level: 1, text: '标题', line: 1 }],
    [{ id: 'a', level: 1, text: '标题', line: 1, number: '1' }],
  ), false)

  // 动态样式表：按 block id 注入 content，非法 id / 实例 id 一律过滤
  const css = buildHeadingNumberStyles('r0', { a: '1.1', 'bad"id': '9' })
  assert.ok(css.includes('[data-tm-editor="r0"]'))
  assert.ok(css.includes('[data-id="a"]'))
  assert.ok(css.includes('content: "1.1" !important'))
  assert.equal(css.includes('bad'), false)
  assert.equal(buildHeadingNumberStyles('bad:id', { a: '1' }), '')
  assert.equal(buildHeadingNumberStyles('r0', {}), '')
  // 正文真正渲染的 content 必须来自同一份编号结果，单级带尾点、多级保持原样
  const realNumberCss = buildHeadingNumberStyles(
    'r0', computeHeadingNumbers([items[0], items[1], items[2]], decimal),
  )
  assert.ok(realNumberCss.includes('content: "1." !important'))
  assert.ok(realNumberCss.includes('content: "1.1" !important'))
  assert.ok(realNumberCss.includes('content: "1.1.1" !important'))
  assert.equal(isSameHeadingNumbers({ a: '1' }, { a: '1' }), true)
  assert.equal(isSameHeadingNumbers({ a: '1' }, { a: '2' }), false)
  assert.equal(isSameHeadingNumbers({ a: '1' }, { a: '1', b: '2' }), false)

  // 编号（::before）与末尾 H1~H6 层级水印（::after）必须共存：
  // 曾因「开启编号时隐藏水印」导致级标消失，这里锁死不允许再加按开关隐藏的规则。
  const headingCss = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url),
    'utf-8',
  )
  assert.ok(headingCss.includes('content: var(--tm-heading-badge'), 'H1~H6 层级水印规则必须保留')
  assert.equal(headingCss.includes('data-tm-heading-numbering'), false, '不得按编号开关隐藏层级水印')
  assert.equal(headingCss.includes('content: none'), false, '不得用 content: none 吞掉层级水印')

  // 编号字体样式必须与所在标题一致：旧版 muted 灰 + 400 字重，在 700/600 的深色
  // 粗体标题前像另一段文字。锁死「继承」，避免以后又给编号另起一套视觉。
  const numberRule = headingCss.match(
    /\.smart-document-content \.bn-block-content\[data-content-type="heading"\] > \.bn-inline-content::before \{([^}]*)\}/,
  )?.[1] ?? ''
  assert.ok(numberRule, '标题编号 ::before 规则必须存在')
  assert.ok(numberRule.includes('color: inherit'), '编号颜色必须继承标题')
  assert.ok(numberRule.includes('font-weight: inherit'), '编号字重必须继承标题')
  assert.ok(numberRule.includes('letter-spacing: inherit'), '编号字距必须继承标题')
  assert.equal(numberRule.includes('--color-text-muted'), false, '编号不得再用 muted 灰')
  assert.equal(/font-weight:\s*(400|normal)/.test(numberRule), false, '编号不得再改回常规字重')

  // 目录侧的编号同样不能压淡，否则与目录项文字又出现明显色差
  const tocLayoutSource = await readFile(
    new URL('../src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx', import.meta.url),
    'utf-8',
  )
  const tocNumberBlock = tocLayoutSource.match(/\{item\.number \? \([\s\S]{0,400}?\) : null\}/)?.[0] ?? ''
  assert.ok(tocNumberBlock, '目录编号渲染分支必须存在')
  assert.equal(tocNumberBlock.includes('opacity-'), false, '目录编号不得用 opacity 压淡')
}

// 代码块语法高亮：必须用 Oniguruma 引擎。
// createJavaScriptRegexEngine 把 TextMate grammar 编译成 JS 正则，下面这段真实 Go 代码
// 会触发灾难性回溯（单块 codeToTokens 实测 29~60s，整篇文档打开卡约 1 分钟）。
// 先做源码断言快速拦截「改回 JS 引擎」，再真跑项目自己的 highlighter，
// 顺带验证 wasm 加载 / 语言按需加载 / 双主题改写整条链路可用。
{
  const codeBlockSource = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/components/CustomCodeBlock.tsx', import.meta.url),
    'utf-8',
  )
  assert.ok(codeBlockSource.includes('createOnigurumaEngine'), '代码块高亮必须用 Oniguruma 引擎')
  // 只匹配真实引用，别把注释里解释原因时提到的名字也算成违规。
  assert.equal(/from ['"]shiki\/engine\/javascript['"]/.test(codeBlockSource), false,
    '不得重新引入 JS 正则引擎')
  assert.equal(/engine:\s*createJavaScriptRegexEngine/.test(codeBlockSource), false,
    '不得改回 JS 正则引擎：特定代码内容会灾难性回溯，打开文档卡约 1 分钟')

  // 配套：Oniguruma 用 WebAssembly.instantiate 编译内联 wasm，Chromium 的 CSP
  // 不在 script-src 放行 'wasm-unsafe-eval' 时会直接拒绝编译，高亮整体失效。
  const viteConfigSource = await readFile(new URL('../vite.config.js', import.meta.url), 'utf-8')
  const devCsp = viteConfigSource.match(/const DEV_CSP = "([^"]+)"/)?.[1] ?? ''
  const prodCsp = viteConfigSource.match(/const PROD_CSP = "([^"]+)"/)?.[1] ?? ''
  assert.ok(devCsp.includes("'wasm-unsafe-eval'"), 'DEV CSP 必须放行 wasm 编译')
  assert.ok(prodCsp.includes("'wasm-unsafe-eval'"), 'PROD CSP 必须放行 wasm 编译，否则 Oniguruma 高亮会被 CSP 拦截')

  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/features/documents/SmartDocumentEditor/components/CustomCodeBlock.tsx', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const codeBlockModule = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  ) as {
    customCodeBlockOptions: {
      createHighlighter: () => Promise<{
        loadLanguage: (lang: string) => Promise<unknown>
        codeToTokens: (code: string, options: Record<string, unknown>) => unknown
      }>
    }
  }
  const highlighter = await codeBlockModule.customCodeBlockOptions.createHighlighter()
  await highlighter.loadLanguage('go')
  await highlighter.loadLanguage('cpp')

  // 真实踩雷代码块（用户文档 doc_81a54ba7… 的第 6 个 Go 块）。空格已规范化为普通空格：
  // 原块含 U+00A0 不换行空格，但实测替换后 JS 引擎仍卡约 29s，所以它保留结构即可复现。
  const worstGoSnippet = `type mheap struct {
    // 堆的全局锁
    lock mutex


    // 空闲页分配器，底层是多棵基数树组成的索引，每棵树对应 16 GB 内存空间
    pages pageAlloc


    // 记录了所有的 mspan. 需要知道，所有 mspan 都是经由 mheap，使用连续空闲页组装生成的
    allspans []*mspan


    // heapAreana 数组，64 位系统下，二维数组容量为 [1][2^22]
    // 每个 heapArena 大小 64M，因此理论上，Golang 堆上限为 2^22*64M = 256T
    arenas [1 << arenaL1Bits]*[1 << arenaL2Bits]*heapArena


    // ...
    // 多个 mcentral，总个数为 spanClass 的个数
    central [numSpanClasses]struct {
        mcentral mcentral
        // 用于内存地址对齐
        pad      [cpu.CacheLinePadSize - unsafe.Sizeof(mcentral{})%cpu.CacheLinePadSize]byte
    }


    // ...
}`
  const started = performance.now()
  highlighter.codeToTokens(worstGoSnippet, { lang: 'go' })
  const elapsed = performance.now() - started
  assert.ok(elapsed < 3000, `代码块高亮耗时 ${elapsed.toFixed(1)}ms，疑似回退到 JS 正则引擎`)
}

// --- 粘贴内容探测：线性时间 + 与旧正则判定一致 ---
// 旧实现用跨行惰性量词，大量「有开头无闭合」的片段会让 pasteHandler 同步卡顿：
// 240KB 的 "$$abc\n" 重复 7.7s、"**abc\n" 重复 3.3s、"[abc" 重复 3.1s。
{
  const legacyMath = (sample: string) =>
    /(^|\n)\s*\$\$[\s\S]*?\$\$\s*($|\n)/m.test(sample) || /(^|[^\\])\$[^$\n]+\$(?!\$)/m.test(sample)
  const legacyMarkdown = (sample: string) =>
    /(\*\*|__)(?!\s)[\s\S]+?(?<!\s)\1/.test(sample) ||
    /(^|\n)#{1,6}\s/.test(sample) ||
    /(^|\n)\s*([*+-]|\d+\.)\s/.test(sample) ||
    /(^|\n)>\s/.test(sample) ||
    /`{1,3}[^`]+`{1,3}/.test(sample) ||
    /\[[^\]]+\]\([^)]+\)/.test(sample)
  const legacyStrict = (sample: string) =>
    /(\*\*|__)(?!\s)[\s\S]+?(?<!\s)\1/.test(sample) ||
    /`{1,3}[^`]+`{1,3}/.test(sample) ||
    /\[[^\]]+\]\([^)]+\)/.test(sample)

  const fixtures = [
    '', 'plain text', '**bold**', '__bold__', '** a**', '**a__b**',
    '$$\nx+y=1\n$$', '$$x$$', '$$abc', '$x$', '[链接](https://a.b)',
    '[abc]', '[a](b)', '[abc](', '- item', '# heading', '`code`',
    '100W * 50 B = 50 * 10^6 B = 50M', '> quote', '1. list',
  ]
  for (const sample of fixtures) {
    assert.equal(containsMathDelimiters(sample), legacyMath(sample), `math 探测语义变化: ${sample}`)
    assert.equal(containsMarkdownDelimiters(sample), legacyMarkdown(sample), `markdown 探测语义变化: ${sample}`)
    assert.equal(containsStrictMarkdownDelimiters(sample), legacyStrict(sample), `strict 探测语义变化: ${sample}`)
  }

  const adversarial: Array<[string, string, (sample: string) => boolean]> = [
    ['$$ 未闭合 240KB', '$$abc\n'.repeat(40000), containsMathDelimiters],
    ['** 未闭合 120KB', '**abc\n'.repeat(20000), containsMarkdownDelimiters],
    ['[ 未闭合 200KB', '[abc'.repeat(50000), containsMarkdownDelimiters],
    ['[a]( 未闭合 200KB', '[a]('.repeat(50000), containsStrictMarkdownDelimiters],
  ]
  for (const [name, sample, probe] of adversarial) {
    const started = performance.now()
    probe(sample)
    const elapsed = performance.now() - started
    assert.ok(elapsed < 100, `${name} 探测耗时 ${elapsed.toFixed(1)}ms，疑似回退到跨行惰性正则`)
  }
}

// --- 代码块语言覆盖：历史文档里的语言必须能识别，且 grammar 真能加载 ---
// 只查 supportedLanguages 字面量不够：langs 工厂漏一项时 getLanguageId 认得出来，
// 但 loadLanguage 会抛错，所以这里真跑一次加载。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/features/documents/SmartDocumentEditor/components/CustomCodeBlock.tsx', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const codeBlockModule = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  const { supportedLanguages, createHighlighter } = codeBlockModule.customCodeBlockOptions
  const historicalLanguages = ['csharp', 'http', 'lua', 'matlab', 'mermaid', 'objectivec', 'perl', 'ruby', 'scss']
  for (const language of historicalLanguages) {
    assert.ok(supportedLanguages[language], `代码块语言 ${language} 未注册，历史文档会失去高亮`)
  }
  const languageEntries = Object.values(supportedLanguages) as Array<{ aliases?: string[] }>
  for (const alias of ['shell', 'bash', 'plaintext']) {
    assert.ok(languageEntries.some((entry) => entry.aliases?.includes(alias)), `代码块语言别名 ${alias} 未映射`)
  }
  const codeHighlighter = await createHighlighter()
  for (const language of historicalLanguages) {
    await codeHighlighter.loadLanguage(language)
  }
}

// 编辑器版面：固定 px 上限 + min(可用宽度, 上限) 自适应 + 【真跑 writeConfig 写库入口】
// 铁律：只测 normalize / 类型声明不够，必须测到 backend.writeConfig 真正收到的对象。
// 之前连线曲线就是漏测写库入口，画面生效但重开知识库全部复位。
{
  // 1) 几何语义：右栏宽 → 铺到上限并按比例分留白；右栏窄 → 占满可用宽度、留白归零
  const cap = { maxWidth: 1200, marginRatio: 0.5 }
  assert.deepEqual(computeEditorLayoutPixels(1600, cap), { width: 1200, left: 200, right: 200 })
  assert.deepEqual(computeEditorLayoutPixels(900, cap), { width: 900, left: 0, right: 0 })
  assert.deepEqual(computeEditorLayoutPixels(1600, { maxWidth: 1200, marginRatio: 0 }), { width: 1200, left: 0, right: 400 })
  assert.deepEqual(computeEditorLayoutPixels(1600, { maxWidth: 1200, marginRatio: 1 }), { width: 1200, left: 400, right: 0 })
  assert.deepEqual(computeEditorLayoutPixels(1600, { maxWidth: 2000, marginRatio: 0.5 }), { width: 1600, left: 0, right: 0 })
  assert.deepEqual(computeEditorLayoutPixels(500, { maxWidth: 1200, marginRatio: 0.3 }), { width: 500, left: 0, right: 0 })
  for (const available of [320, 500, 900, 1200, 1400, 1600, 2400]) {
    for (const marginRatio of [0, 0.13, 0.5, 0.87, 1]) {
      for (const maxWidth of [400, 800, 1200, 2000]) {
        const p = computeEditorLayoutPixels(available, { maxWidth, marginRatio })
        assert.equal(p.width, Math.min(available, maxWidth), '内容宽必须 = min(右栏可用宽度, 配置上限)')
        assert.ok(Math.abs(p.width + p.left + p.right - available) < 1e-9, '内容宽 + 左留白 + 右留白必须恰好等于可用宽度')
        assert.ok(p.left >= 0 && p.right >= 0, '留白不得为负')
        if (available <= maxWidth) assert.equal(p.left + p.right, 0, '右栏比上限窄时不得留白')
      }
    }
  }
  assert.deepEqual(normalizeEditorLayout(undefined), DEFAULT_EDITOR_LAYOUT)
  assert.deepEqual(normalizeEditorLayout({ maxWidth: 99999, marginRatio: -3 }), { maxWidth: 2000, marginRatio: 0 })
  assert.deepEqual(normalizeEditorLayout({ maxWidth: Number.NaN, marginRatio: Number.NaN }), DEFAULT_EDITOR_LAYOUT)
  assert.deepEqual(buildEditorLayoutVars({ maxWidth: 1350, marginRatio: 0.25 }), { maxWidth: '1350px', marginRatio: '0.25' })
  assert.equal(DEFAULT_EDITOR_LAYOUT.maxWidth, 1200, '默认上限要够宽，右栏全屏时才能看得更多')

  // 2) 真跑写库入口：注入假 backend，断言 backend.writeConfig 收到的对象保留两个新字段
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/core/storage/service.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    banner: { js: 'globalThis.window = globalThis.window || {};' },
  })
  const storageService = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  ) as { createStore: (backend: unknown) => { writeConfig: (config: unknown) => Promise<void> } }
  const makeStore = () => {
    const calls: Array<Record<string, any>> = []
    const backend = { writeConfig: async (config: Record<string, any>) => { calls.push(config) } }
    return { store: storageService.createStore(backend), calls }
  }
  {
    const { store, calls } = makeStore()
    await store.writeConfig({ defaultEditorStyle: { contentWidth: 1350, contentMarginRatio: 0.25 } })
    const written = JSON.parse(JSON.stringify(calls[0])) as { defaultEditorStyle: Record<string, unknown> }
    assert.equal(written.defaultEditorStyle.contentWidth, 1350, '内容最大宽度必须真的写进配置')
    assert.equal(written.defaultEditorStyle.contentMarginRatio, 0.25, '左右留白比例必须真的写进配置')
  }
  {
    const { store, calls } = makeStore()
    await store.writeConfig({ defaultEditorStyle: { contentWidth: 99, contentMarginRatio: -1 } })
    assert.equal(calls[0].defaultEditorStyle.contentWidth, 400, '越界宽度必须钳制到下限')
    assert.equal(calls[0].defaultEditorStyle.contentMarginRatio, 0, '越界留白比例必须钳制')
  }
  {
    // 旧存档（含上一版已废弃的比例字段）：px 宽度直接沿用为上限，比例字段归一化时丢弃、不再写回。
    const { store, calls } = makeStore()
    await store.writeConfig({ defaultEditorStyle: { contentWidth: 700, contentWidthRatio: 0.63 } })
    assert.equal(calls[0].defaultEditorStyle.contentWidth, 700, '旧存档的 px 内容线宽直接沿用为上限')
    assert.equal(calls[0].defaultEditorStyle.contentMarginRatio, DEFAULT_EDITOR_LAYOUT.marginRatio)
    assert.equal('contentWidthRatio' in calls[0].defaultEditorStyle, false, '废弃的比例字段不得再写回配置')
  }
  {
    // 全新知识库：上限取较宽默认值、留白居中
    const { store, calls } = makeStore()
    await store.writeConfig({})
    assert.equal(calls[0].defaultEditorStyle.contentWidth, DEFAULT_EDITOR_LAYOUT.maxWidth)
  }

  // 3) 渲染层与入口：CSS 按「占满 + px 上限 + 留白比例」布局；旧入口与废弃字段已清理
  const editorCss = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url),
    'utf-8',
  )
  const containerRules = [...editorCss.matchAll(/\.smart-document-content \.bn-container \{([^}]*)\}/g)].map((m) => m[1])
  assert.ok(containerRules.length >= 2, '.bn-container 的宽度规则与盒模型重置都必须存在')
  const containerCss = containerRules.join('\n')
  assert.ok(containerCss.includes('width: 100% !important'), '内容框必须先占满右栏可用宽度')
  assert.ok(containerCss.includes('max-width: var(--topomind-smart-content-max-width'), '宽度上限必须由配置的 px 变量给出')
  assert.ok(
    containerCss.includes('max(0%, 100% - var(--topomind-smart-content-max-width'),
    '剩余留白必须按「可用宽度 − 上限」算，右栏比上限窄时自动归零',
  )
  assert.ok(containerCss.includes('* var(--topomind-smart-content-margin-split'), '剩余留白必须按比例分配')
  assert.ok(containerCss.includes('margin-right: auto'), '右侧留白交给 auto 吃下剩余')
  assert.equal(containerCss.includes('max-width: none'), false, '不得压掉配置上限')
  assert.equal(containerCss.includes('topomind-smart-content-width'), false, '不得退回按比例的百分比宽度变量')
  assert.equal(containerCss.includes('800px'), false, '旧的固定 800px 内容线宽必须移除')

  // 废弃的比例字段必须全链路清干净，避免配置里留两套互相覆盖的宽度语义
  const legacyFieldFiles = [
    '../src/domain/style/styleTypes.ts',
    '../src/domain/style/styleDefaults.ts',
    '../src/domain/style/styleConstraints.ts',
    '../src/domain/style/normalizeStyleConfig.ts',
    '../src/features/right-panel/model/stylePresets.ts',
    '../src/features/documents/SmartDocumentEditor/editorLayout.ts',
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx',
    '../src/features/documents/SmartDocumentEditor/model/useSmartDocumentEditorModel.ts',
    '../src/features/documents/SmartDocumentEditor/components/ContentLayoutControls.tsx',
  ]
  for (const rel of legacyFieldFiles) {
    const source = await readFile(new URL(rel, import.meta.url), 'utf-8')
    assert.equal(source.includes('contentWidthRatio'), false, `${rel} 不得残留废弃的比例字段`)
  }

  const editorStylePanel = await readFile(
    new URL('../src/features/right-panel/components/StyleTab/EditorStylePanel.tsx', import.meta.url),
    'utf-8',
  )
  assert.equal(editorStylePanel.includes('label="内容线宽"'), false, '右侧样式面板的旧配置入口必须移除')
  const vaultConfigTypes = await readFile(new URL('../src/core/storage/types.ts', import.meta.url), 'utf-8')
  assert.ok(
    vaultConfigTypes.includes('defaultEditorStyle?: Partial<DefaultEditorStyle>'),
    'VaultConfig 必须引用同一份定义，避免字段白名单漂移',
  )

  // 4) 滑杆提交时序：只接已提交值 + 松手才写。
  // 若把预览值回传，拖动中「外部配置变化」的同步 effect 会清掉 dirty 标记 → 松手不保存。
  const editorComponent = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url),
    'utf-8',
  )
  const toolbarCall = editorComponent.match(/<EditorTopToolbar[\s\S]{0,600}?\/>/)?.[0] ?? ''
  assert.ok(toolbarCall, '顶部工具栏调用必须存在')
  assert.ok(toolbarCall.includes('layout={committedLayout}'), '滑杆只能接收已提交配置，不能回传预览值')
  assert.ok(editorComponent.includes("'--topomind-smart-content-max-width': layout.maxWidth"), '必须注入 px 上限变量')
  assert.ok(editorComponent.includes("'--topomind-smart-content-margin-split': layout.marginRatio"), '必须注入留白比例变量')
  assert.ok(editorComponent.includes('maxWidth: defaultEditorStyle.contentWidth'), '已提交版面必须取自全局 contentWidth')

  const controls = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/components/ContentLayoutControls.tsx', import.meta.url),
    'utf-8',
  )
  assert.equal((controls.match(/onPointerUp=\{commit\}/g) ?? []).length, 2, '两个滑杆都要在松手时提交')
  assert.equal((controls.match(/onKeyUp=\{commit\}/g) ?? []).length, 2, '键盘调整结束也要提交')
  assert.equal((controls.match(/onBlur=\{commit\}/g) ?? []).length, 2, '失焦兜底提交')
  assert.equal((controls.match(/onCommit\(/g) ?? []).length, 1, '写盘只能发生在提交函数里，不能每帧调用')
  assert.ok(controls.includes('dirtyRef'), '必须有脏标记，避免无效写盘')
  assert.ok(controls.includes('aria-label="内容最大宽度"'), '宽度滑杆必须调固定 px 上限')
  assert.ok(controls.includes('{draft.maxWidth}px'), '宽度读数必须是 px')
  assert.equal(controls.includes('widthRatio'), false, '滑杆不得再按比例调宽度')

  const modelSource = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/model/useSmartDocumentEditorModel.ts', import.meta.url),
    'utf-8',
  )
  assert.ok(modelSource.includes('contentWidth: next.maxWidth'), '提交必须把 px 上限写进全局配置')
}

// 目录控件：宽度仍按内容自适应并封顶，但超长目录项用省略号截断，绝不出现横向滚动条。
// 关键结构：w-max 的离屏探针不能包住真实列表，否则真实行会被撑到自然宽度 → truncate 失效 +
// 列表出现横向滚动条（这正是旧实现的 bug）。
{
  const toc = await readFile(
    new URL('../src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx', import.meta.url),
    'utf-8',
  )
  assert.ok(toc.includes('overflow-x-hidden overflow-y-auto'), '目录列表必须禁止横向滚动')
  assert.equal(toc.includes('overflow-x-auto'), false, '不得再用横向滚动查看超长目录项')
  assert.ok(toc.includes('min-w-0 flex-1 truncate'), '超长目录项必须用省略号截断')
  assert.ok(toc.includes('title={item.number ? `${item.number} ${item.text}` : item.text}'), '截断后仍需 title 看全文')

  const listPos = toc.indexOf('ref={tocListRef}')
  const probePos = toc.indexOf('ref={tocWidthProbeRef}')
  assert.ok(listPos > 0 && probePos > listPos, '宽度探针必须独立于目录列表')
  assert.ok(toc.includes('h-0 w-0 overflow-hidden'), '探针包装必须是 0×0，不能产生滚动溢出或撑高内容层')
  assert.ok(toc.includes('invisible w-max'), '探针仍按最长目录项的自然宽度测量')
  assert.equal((toc.slice(listPos, probePos).match(/\{tocItems\.map/g) ?? []).length, 1,
    '真实目录项与探针必须各渲染一次，探针不得包住真实列表')
  assert.equal((toc.match(/\$\{TOC_ROW_CLASS\}/g) ?? []).length, 2,
    '真实行与探针必须共用同一套字号/缩进/间距，测量才准')
  // 尺寸是用户明确拍板的：最大宽度 320×1.5=480、触发条高度 104×2/3≈69、下限 240。
  // 下限曾设 320（≈24 个汉字）把常见标题全钳住 → 看着像固定宽度；改成 240 后短目录落在下限是预期行为。
  // 解析真实数值而非只查字面量，避免注释/字符串里的数字蒙混过关。
  const maxWidth = Number(toc.match(/^const TOC_PANEL_MAX_WIDTH = (\d+)/m)?.[1])
  const minWidth = Number(toc.match(/^const TOC_PANEL_MIN_WIDTH = (\d+)/m)?.[1])
  const railHeight = Number(toc.match(/^const TOC_RAIL_HEIGHT = (\d+)/m)?.[1])
  assert.equal(maxWidth, 480, '面板最大宽度必须是原 320 的 1.5 倍')
  assert.equal(minWidth, 240, '面板下限必须是用户拍板的 240')
  assert.equal(railHeight, 69, '触发条高度必须缩到原 104 的 2/3')
  assert.ok(maxWidth > minWidth, '最大宽度必须仍大于最小宽度')
  // 用解析出的常量真跑宽度公式：56/188/284/476 是真实 Chromium 在项目 Tailwind CSS 下测到的
  // 2/13/21/37 字目录项自然宽度。三档面板宽度必须各不相同，否则就是「自适应没生效」。
  const panelWidthFor = (natural: number) => Math.min(maxWidth, Math.max(minWidth, natural + 24))
  const widths = [56, 284, 476].map(panelWidthFor)
  assert.deepEqual(widths, [240, 308, 480], '面板宽度必须随最长目录项自然宽度在 min/max 之间变化')
  assert.equal(new Set(widths).size, 3, '窄/中/宽目录的面板宽度不得相同（下限不得把差异吃掉）')
  assert.ok(minWidth < 284 + 24, '约 21 字的标题必须能进入自适应区间')
  assert.equal(panelWidthFor(188), 240, '13 字左右的常见短标题落在 240 下限是用户拍板的预期，不是 bug')
  // 宽度必须真的「被最长目录项撑开」：公式用自然宽度，且测量要在首帧/字体/展开时兜底重测。
  assert.ok(toc.includes('tocNaturalWidth + TOC_LIST_PADDING_X'), '面板宽度必须由最长目录项自然宽度推导')
  assert.ok(toc.includes('Math.max(el.getBoundingClientRect().width, el.scrollWidth)'), '自然宽度测量要有 scrollWidth 兜底')
  assert.ok(toc.includes('data-toc-natural-width={tocNaturalWidth}'), '面板要暴露实测自然宽度便于排查')
  assert.ok(toc.includes('requestAnimationFrame(measure)'), '首帧后要重测一次自然宽度')
  assert.ok(toc.includes('document.fonts?.ready.then(measure)'), '字体加载完成后要重测一次自然宽度')
  assert.ok(toc.includes('}, [hasToc, tocItemsSignature, tocExpanded])'), '展开态变化时要重测自然宽度')
}

// P0 节点轻量化：新建节点只写父 _graph.json.children，绝不 mkdir / 写空 _graph.json。
// createCard / createCardDir 整条 Store→FSB→IPC→主进程链已删除；下面先在 fakeStorage 里
// 放一个会抛错的 createCard「诱饵」，再真跑 createChildCardNode 断言它一次都没被调用，
// 这样即使将来有人把接口加回来，也拦得住「新建节点又回去建目录」的退化。
{
  const cardSvcUrl = new URL('../src/application/graph/cardNodeService.ts', import.meta.url)
  const cardSvcSource = await readFile(cardSvcUrl, 'utf-8')
  assert.equal(cardSvcSource.includes('storage.createCard('), false, '新建节点不得再调用 createCard 建目录')
  assert.ok(cardSvcSource.includes('joinRefs(options.parentRef, cardKey)'), 'newRef 必须是逻辑路径，不能假装是磁盘目录')
  assert.ok(cardSvcSource.includes('parentLayout.nodes[cardKey]'), '必须用 cardId 作 key 并做冲突保护')

  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(cardSvcUrl)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const cardModule = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  ) as {
    createChildCardNode: (
      storage: Record<string, unknown>,
      options: Record<string, unknown>
    ) => Promise<{ newRef: string | null; reloadRef: string }>
  }

  const calls: string[] = []
  let written: any = null
  const fakeStorage = {
    // 诱饵：生产 Store 已无此成员；若新建节点退回去调它，这里立刻炸掉。
    createCard: async () => { calls.push('createCard'); throw new Error('P0 不应再调用 createCard') },
    deleteCard: async () => {},
    renameCard: async () => {},
    readLayout: async () => ({
      nodes: { existing: { id: 'existing', card: { ref: 'existing', name: '旧节点' }, position: { x: 1, y: 2 } } },
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }),
    writeLayout: async (_ref: string, meta: any) => { calls.push('writeLayout'); written = meta },
  }
  const result = await cardModule.createChildCardNode(fakeStorage, {
    name: '新节点',
    parentRef: '计算机',
    reloadRef: '计算机',
    cardId: 'card-abc',
    position: { x: 10, y: 20 },
    size: { width: 130, height: 60 },
  })
  assert.deepEqual(calls, ['writeLayout'], '新建节点必须只写一次父图，不产生任何目录操作')
  assert.equal(written.nodes['card-abc'].card.name, '新节点', '显示名必须写进父图 children')
  assert.deepEqual(written.nodes['card-abc'].position, { x: 10, y: 20 })
  assert.equal(written.nodes['card-abc'].width, 130)
  assert.equal(written.nodes.existing.card.name, '旧节点', '原有节点不能被覆盖')
  assert.equal(result.newRef, '计算机/card-abc', 'newRef 是逻辑路径')
  await assert.rejects(
    () => cardModule.createChildCardNode(fakeStorage, {
      name: '冲突', parentRef: '计算机', reloadRef: '计算机', cardId: 'existing',
    }),
    /节点 ID 冲突/,
    'cardId 撞车必须显式报错'
  )

  // 摘要短路：消除打开房间时每个节点 2 次同步读（readGraphMeta + listTopoDocuments）。
  const fileServiceSource = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  const summaryStart = fileServiceSource.indexOf('readRoomNodeSummaries: function')
  assert.ok(summaryStart > 0, '必须存在 readRoomNodeSummaries')
  const summaryBlock = fileServiceSource.slice(summaryStart, summaryStart + 1400)
  assert.ok(
    summaryBlock.includes('existsSync(_fs_resolveKbsPath(rootDir, roomPath))'),
    '未物化节点必须用 existsSync 短路'
  )
  assert.ok(summaryBlock.includes('childCount: 0, hasDetail: false'), '短路必须返回空摘要')
  // 跨房间移动：目标房间可能是尚未物化的轻量节点，不能再硬抛「目标房间不存在」。
  assert.equal(
    fileServiceSource.includes("throw new Error('目标房间不存在: ')"), false,
    '跨房间移动不得再要求目标目录已存在'
  )
  assert.ok(
    fileServiceSource.includes('if (!nodeFs.existsSync(targetDir)) _fs_ensureDir(targetDir)'),
    '目标房间未物化时按需建目录'
  )
  const deleteConfirm = await readFile(
    new URL('../src/features/graph/GraphPage/model/useNodeActions.ts', import.meta.url), 'utf-8'
  )
  assert.ok(deleteConfirm.includes('若该节点已有文档或子房间'), '删除确认文案必须反映按需物化语义')
}

// P0 后续清理：createCard / createCardDir 整条死链、3 个仅定义未调用的 _fs_ 函数、
// 4 处「渲染层永远拿不到」的 version? 死声明必须保持已删除状态。
// 逐文件按精确串断言，避免「接口里还留着成员」或「注释里保留字面量」蒙混过去。
{
  const forbiddenByFile: Array<[string, string[]]> = [
    ['../src/core/storage/types.ts', ['createCard:']],
    ['../src/core/storage/service.ts', ['createCard(', 'Store.createCard']],
    ['../src/core/storage/file.ts', ['createCard:', 'FSB.createCardDir', 'version?: number']],
    ['../src/core/fs-backend.ts', ['createCardDir', 'version?: number']],
    ['../src/types/graph.ts', ['version?: number']],
    ['../src/hooks/useGraph/useGraphStorageApi.ts', ['createCard']],
    ['../src/hooks/useGraph/graphOperations.ts', ['createCard']],
    ['../electron/preload.js', ['fs:createCardDir']],
    ['../electron/main.js', ['fs:createCardDir']],
    ['../electron/file-service.js', ['createCardDir', '_fs_createCardDir(', '_fs_deleteKbsDir(', '_fs_listAttachments(']],
    ['../electron/services/card-service.js', ['createCardDir']],
  ]
  for (const [rel, forbidden] of forbiddenByFile) {
    const source = await readFile(new URL(rel, import.meta.url), 'utf-8')
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${rel} 仍残留已退役的 ${token}`)
    }
  }
  // 保留的入口必须还在：删死链时不能误删 deleteCard / readCardChildren / createKbsDir。
  const liveFileService = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  assert.ok(liveFileService.includes('readCardChildren: function'), 'readCardChildren 仍须保留（首页 KB 计数入口）')
  assert.ok(liveFileService.includes('createKbsDir: function'), 'createKbsDir 仍须保留（新建知识库入口）')
  assert.ok(liveFileService.includes('deleteKbsDir: function'), 'deleteKbsDir 仍须保留（删除节点走回收站）')
}

// P1：_graph.json 固定分片 + version + kind schema。
// 铁律：格式改造只查源码字面量会被「类型里加了字段但 map 本体没写」蒙混，
// 因此这里用内存文件系统真跑分片读写、用 esbuild 打包真跑 kind 全链路往返。
{
  const nodePath = await import('node:path')
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const shardModule = await import(
    new URL('../electron/services/graph-meta-service.js', import.meta.url).href
  ) as Record<string, any>
  const { createGraphMetaService, graphShardIndexOf, graphMetaComparisonKey, GRAPH_SHARD_COUNT, GRAPH_FORMAT_VERSION } = shardModule

  assert.equal(GRAPH_FORMAT_VERSION, 2, '磁盘格式版本必须是 2')
  assert.equal(GRAPH_SHARD_COUNT, 16, '分片数必须固定为 16（不随节点规模增长、无需 rebalance）')

  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    if (value && typeof value === 'object') {
      return `{${Object.keys(value as object).sort().map((k) => `${k}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
    }
    return JSON.stringify(value)
  }

  const makeFs = () => {
    const files = new Map<string, string>()
    const writes: string[] = []
    const deps = {
      ensureDir: () => {},
      graphFilePath: (dir: string) => nodePath.join(dir, '_graph.json'),
      joinPath: (...parts: string[]) => nodePath.join(...parts),
      readJsonFile: (fp: string) => (files.has(fp) ? JSON.parse(files.get(fp) as string) : {}),
      requireValidWorkDir: (d: string) => d,
      resolveKbsPath: (_root: string, rel: string) => nodePath.join('/kb', rel || ''),
      writeJsonFile: (fp: string, data: unknown) => {
        files.set(fp, JSON.stringify(data ?? {}, null, 2))
        writes.push(fp)
      },
    }
    return { files, writes, deps, store: createGraphMetaService(deps) }
  }

  const meta: Record<string, any> = {
    children: {},
    edges: [
      {
        id: 'e1', source: 'n0', target: 'n1', relation: '相关', weight: 'minor',
        lineMode: 'curve', lineStyle: 'dashed', color: '#0969da', lineWidth: 2,
        arrow: true, arrowSize: 12, arrowShape: 'hollow', arrowPosition: 'both',
        curveControl: { u: 0.4, v: 0.2 },
        sourceAnchor: { u: 0, v: 0.5 }, targetAnchor: { u: 1, v: 0.5 },
        highlighted: true, faded: false,
      },
    ],
    zoom: 1.25,
    pan: { x: 10, y: 20 },
  }
  for (let i = 0; i < 40; i += 1) {
    meta.children[`n${i}`] = {
      name: `节点${i}`, kind: i % 2 ? 'shape' : 'knowledge', x: i, y: i * 2,
      width: 120, height: 52, widthMode: 'manual', expanded: i === 0,
      style: { borderColor: '#123456', borderRadius: 8 }, expandedWidth: 240,
      expandedHeight: 120, emojis: ['📌'],
    }
  }

  // 空房间首次写 → v2：索引只留 version + viewport，children/edges 落到分片。
  const fsA = makeFs()
  fsA.store.writeGraphMeta('/kb', 'room', meta)
  const indexPath = nodePath.join('/kb', 'room', '_graph.json')
  const index = JSON.parse(fsA.files.get(indexPath) as string)
  assert.equal(index.version, 2, '新房间必须写 v2 索引')
  assert.equal(index.children, undefined, 'v2 索引不得再带 children')
  assert.equal(index.edges, undefined, 'v2 索引不得再带 edges')
  assert.deepEqual({ zoom: index.zoom, pan: index.pan }, { zoom: 1.25, pan: { x: 10, y: 20 } }, 'viewport 必须留在索引')
  assert.equal(stable(fsA.store.readGraphMeta('/kb', 'room')), stable(meta), 'v2 分片组装必须与写入的完整 meta 一致')

  // 真跑「只写脏分片」：改 1 个节点，只应有 1 个 nodes 分片落盘，索引/edges 分片都不动。
  fsA.writes.length = 0
  const moved = { ...meta, children: { ...meta.children, n0: { ...meta.children.n0, x: 999 } } }
  fsA.store.writeGraphMeta('/kb', 'room', moved)
  assert.equal(fsA.writes.filter((p) => p.includes('nodes-')).length, 1, '改一个节点只能写 1 个节点分片')
  assert.equal(fsA.writes.filter((p) => p.includes('edges-')).length, 0, '未改边时不得写边分片')
  assert.equal(fsA.writes.filter((p) => p.endsWith('_graph.json')).length, 0, 'viewport 未变时不得重写索引')
  assert.equal((fsA.store.readGraphMeta('/kb', 'room') as any).children.n0.x, 999, '脏分片写回后逻辑读必须看到新值')

  // 删除节点必须覆盖所在分片（不能因为「桶变空就跳过写」而留下幽灵节点）。
  const withoutN0 = { ...moved, children: { ...moved.children } }
  delete withoutN0.children.n0
  fsA.store.writeGraphMeta('/kb', 'room', withoutN0)
  assert.equal((fsA.store.readGraphMeta('/kb', 'room') as any).children.n0, undefined, '删除的节点不得从分片里复活')

  // 旧库零改写：v1 有数据的房间继续单文件，绝不自动变成分片。
  const legacy = { children: { a: { name: '旧节点', kind: 'knowledge' } }, edges: [], zoom: 1, pan: { x: 0, y: 0 } }
  const fsB = makeFs()
  const legacyIndex = nodePath.join('/kb', 'legacy', '_graph.json')
  fsB.deps.writeJsonFile(legacyIndex, legacy)
  fsB.writes.length = 0
  fsB.store.writeGraphMeta('/kb', 'legacy', legacy)
  const legacyAfter = JSON.parse(fsB.files.get(legacyIndex) as string)
  assert.equal(legacyAfter.version, undefined, '旧库不得被自动加上 version')
  assert.ok(Array.isArray(legacyAfter.edges), '旧库必须保持单文件里的 edges')
  assert.equal([...fsB.files.keys()].some((p) => p.includes('_graph') && p.includes('nodes-')), false, '旧库不得凭空出现分片目录')

  // 显式迁移：v1 → v2 后往返必须完全一致（含 kind 与所有边样式字段）。
  assert.equal(fsB.store.migrateRoom('/kb', 'legacy'), true, 'migrateRoom 必须执行 v1→v2')
  assert.equal(JSON.parse(fsB.files.get(legacyIndex) as string).version, 2, '迁移后索引必须标 v2')
  assert.equal(graphMetaComparisonKey(fsB.store.readGraphMeta('/kb', 'legacy')), graphMetaComparisonKey(legacy), '迁移往返不得丢任何字段')
  assert.equal(fsB.store.migrateRoom('/kb', 'legacy'), false, '已是 v2 的房间不得重复迁移')

  // 全库格式统一：{} 空档（version=0）也必须能升级成 v2 索引，且空桶不产生分片文件。
  // 真实库里有 165 个这样的房间（有文档/附件、无子节点），升级前后逻辑读都必须是空图。
  const fsBlank = makeFs()
  const blankIndex = nodePath.join('/kb', 'blank', '_graph.json')
  fsBlank.deps.writeJsonFile(blankIndex, {})
  assert.equal(fsBlank.store.detectVersion('/kb', 'blank'), 0, '{} 空档必须被识别为 version=0')
  assert.equal(fsBlank.store.migrateRoom('/kb', 'blank'), true, '空档必须也能显式升级')
  assert.deepEqual(JSON.parse(fsBlank.files.get(blankIndex) as string), { version: 2 }, '空档升级后索引只留 version')
  assert.equal([...fsBlank.files.keys()].some((p) => p.includes('nodes-') || p.includes('edges-')), false, '空档不得产生任何分片文件')
  assert.deepEqual(fsBlank.store.readGraphMeta('/kb', 'blank'), { children: {}, edges: [] }, '空档升级后逻辑读仍须是空图')
  assert.equal(fsBlank.store.detectVersion('/kb', 'blank'), 2, '升级后必须能被识别为 v2')
  assert.equal(fsBlank.store.migrateRoom('/kb', 'blank'), false, '升级后不得重复迁移')

  // 带 viewport 的空档：顶层非节点字段必须原样留在索引里，不能被升级吞掉。
  const fsViewport = makeFs()
  const viewportIndex = nodePath.join('/kb', 'viewport', '_graph.json')
  fsViewport.deps.writeJsonFile(viewportIndex, { zoom: 0.8, pan: { x: 3, y: 4 } })
  assert.equal(fsViewport.store.migrateRoom('/kb', 'viewport'), true, '带 viewport 的空档也应升级')
  assert.deepEqual(
    JSON.parse(fsViewport.files.get(viewportIndex) as string),
    { zoom: 0.8, pan: { x: 3, y: 4 }, version: 2 },
    '空档升级不得丢 zoom/pan'
  )
  assert.equal(graphMetaComparisonKey(fsViewport.store.readGraphMeta('/kb', 'viewport')), graphMetaComparisonKey({
    zoom: 0.8, pan: { x: 3, y: 4 }, children: {}, edges: [],
  }), '带 viewport 的空档往返必须一致')

  // 真实事故回归：v1 房间有多条边且跨多个分片时，v2 读回顺序必然与原始数组不同。
  // 旧版 migrateRoom 用严格数组顺序比较，导致真实知识库首轮 26 个房间中 6 个多边房间
  // 全部误报「往返校验失败」（数据其实一条没丢），并留下 148 个残留分片卡住后续迁移。
  const fsMulti = makeFs()
  const multiEdges = Array.from({ length: 24 }, (_, i) => ({
    id: `edge-${String(i).padStart(2, '0')}`,
    source: `n${i % 7}`,
    target: `n${(i + 3) % 7}`,
    lineMode: 'curve',
    curveControl: { u: 0.3, v: 0.6 },
    lineWidth: 2,
  }))
  const multiChildren: Record<string, any> = {}
  for (let i = 0; i < 7; i += 1) multiChildren[`n${i}`] = { name: `节点${i}`, kind: 'knowledge', x: i, y: i }
  const multiLegacy = { children: multiChildren, edges: multiEdges, zoom: 1, pan: { x: 0, y: 0 } }
  fsMulti.deps.writeJsonFile(nodePath.join('/kb', 'multi', '_graph.json'), multiLegacy)
  assert.ok(new Set(multiEdges.map((e) => graphShardIndexOf(e.id))).size > 1, '样本边必须跨多个分片，否则测不到顺序重排')
  assert.equal(fsMulti.store.migrateRoom('/kb', 'multi'), true, '多边房间迁移必须成功（边按分片桶序重排属正常）')
  const multiBack = fsMulti.store.readGraphMeta('/kb', 'multi') as any
  assert.notDeepEqual(
    multiBack.edges.map((e: any) => e.id),
    multiEdges.map((e) => e.id),
    '样本必须真的发生顺序重排，否则这条断言形同虚设'
  )
  assert.equal(graphMetaComparisonKey(multiBack), graphMetaComparisonKey(multiLegacy), '顺序无关比较必须判定往返完全一致')
  // 顺序无关 ≠ 忽略边：丢边、改字段都必须仍被检出。
  const lostEdge = { ...multiBack, edges: multiBack.edges.slice(1) }
  assert.notEqual(graphMetaComparisonKey(lostEdge), graphMetaComparisonKey(multiLegacy), '丢一条边必须被比较键检出')
  const lostField = {
    ...multiBack,
    edges: multiBack.edges.map((e: any, i: number) => (i === 0 ? { ...e, lineWidth: 99 } : e)),
  }
  assert.notEqual(graphMetaComparisonKey(lostField), graphMetaComparisonKey(multiLegacy), '改一个边字段必须被比较键检出')

  // 未知版本必须拒绝读写，防止旧程序把新格式当空图或降级覆盖。
  const fsC = makeFs()
  fsC.deps.writeJsonFile(nodePath.join('/kb', 'future', '_graph.json'), { version: 99, zoom: 1 })
  assert.throws(() => fsC.store.readGraphMeta('/kb', 'future'), /不支持的 _graph.json 版本/, '未知版本读侧必须抛错')
  assert.throws(() => fsC.store.writeGraphMeta('/kb', 'future', meta), /不支持的 _graph.json 版本/, '未知版本写侧必须抛错')

  // 分片 hash 稳定且恒定落在 16 个桶内。
  for (let i = 0; i < 1000; i += 1) {
    const idx = graphShardIndexOf(`card-${i}`)
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < GRAPH_SHARD_COUNT, '分片下标越界')
    assert.equal(graphShardIndexOf(`card-${i}`), idx, '同一 id 必须恒定落在同一分片')
  }

  // kind 端到端真跑：React Flow → buildMeta → normalize → 磁盘 JSON → convert → normalize → RoomGraph → buildNodes。
  // 任一白名单漏写都会在这条链上暴露（历史踩过：只在返回类型加字段、convertGraphToFSB 的 map 本体没写）。
  const bundle = async (rel: string) => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(rel, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
      banner: { js: 'globalThis.window = globalThis.window || {};' },
    })
    return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  }
  const fileAdapter = await bundle('../src/core/storage/file.ts')
  const normalizer = await bundle('../src/domain/graph/normalizeGraphMeta.ts')
  const mapper = await bundle('../src/domain/graph/graphMapper.ts')
  const builder = await bundle('../src/hooks/useGraph/graphBuilder.ts')

  const rfInput = [
    { id: 'n-shape', position: { x: 1, y: 2 }, width: 120, height: 52, data: { label: '开始', kind: 'shape', nodeStyle: { borderRadius: 4 } } },
    { id: 'n-know', position: { x: 9, y: 9 }, width: 120, height: 52, data: { label: '知识', kind: 'knowledge' } },
  ]
  const built = builder.buildMetaFromNodesEdges(rfInput, [], { zoom: 1, pan: { x: 0, y: 0 } })
  assert.equal(built.nodes['n-shape'].kind, 'shape', 'buildMetaFromNodesEdges 必须写出 kind')
  const normalizedOut = normalizer.normalizeGraphMeta(built)
  assert.equal(normalizedOut.nodes['n-shape'].kind, 'shape', 'normalizeGraphMeta（写侧最后一道）不得吞掉 kind')
  const disk = JSON.parse(JSON.stringify(fileAdapter.convertGraphToFSB(normalizedOut, '')))
  assert.equal(disk.children['n-shape'].kind, 'shape', 'kind 必须真的出现在 _graph.json 序列化结果里')
  assert.equal(disk.children['n-know'].kind, 'knowledge', '显式 knowledge 也必须落盘')
  const restored = normalizer.normalizeGraphMeta(fileAdapter.convertFSBToGraph(disk, ''))
  assert.equal(restored.nodes['n-shape'].kind, 'shape', 'convertFSBToGraph → normalize 读回不得丢 kind')
  const room = mapper.graphMetaToRoomGraph('', restored)
  assert.equal(room.nodes['n-shape'].kind, 'shape', 'graphMetaToRoomGraph 不得丢 kind')
  assert.equal(mapper.roomGraphToGraphMeta(room).nodes['n-shape'].kind, 'shape', 'roomGraphToGraphMeta 不得丢 kind')
  const rfOutput = builder.buildNodes('', mapper.roomGraphToGraphMeta(room), {}, '')
  assert.equal(rfOutput.find((n: any) => n.id === 'n-shape').data.kind, 'shape', 'buildNodes 必须把 kind 放回 node.data')
  assert.equal(rfOutput[0].type, 'knowledgeCard', '本轮只做 schema 预留，nodeTypes 仍统一为 knowledgeCard')

  // 真跑「读库入口」：只测 graphMetaService 不够，readCardChildren 若偷偷改回直接读
  // _graph.json 索引，v2 房间就会返回空子树（历史踩过：只测序列化往返放过了写库入口）。
  const cardModule = await import(new URL('../electron/services/card-service.js', import.meta.url).href) as Record<string, any>
  const cardService = cardModule.createCardService({
    ensureDir: fsA.deps.ensureDir,
    graphFilePath: fsA.deps.graphFilePath,
    joinPath: fsA.deps.joinPath,
    readGraphMeta: fsA.store.readGraphMeta,
    readJsonFile: fsA.deps.readJsonFile,
    relativeToKbs: () => '',
    requireValidWorkDir: fsA.deps.requireValidWorkDir,
    resolveKbsPath: fsA.deps.resolveKbsPath,
    safeSegment: (s: string) => s,
    writeJsonFile: fsA.deps.writeJsonFile,
  })
  const logicalChildren = (fsA.store.readGraphMeta('/kb', 'room') as any).children
  assert.equal(
    Object.keys(cardService.readCardChildren('/kb', 'room')).length,
    Object.keys(logicalChildren).length,
    'readCardChildren 必须能从 v2 分片房间读出全部子节点（不能只读索引）'
  )

  // 主进程里所有「直接读 _graph.json.children」的地方都必须改走逻辑读，否则分片房间会被读成空图。
  const cardServiceSource = await readFile(new URL('../electron/services/card-service.js', import.meta.url), 'utf-8')
  assert.ok(cardServiceSource.includes('readGraphMeta(rootDir, cardPath)'), 'readCardChildren 必须走 graphMetaService 逻辑读')
  const fileServiceSource = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  assert.equal(fileServiceSource.includes('graphFileOf'), false, '跨房间移动不得再直接读写 _graph.json')
  assert.ok(fileServiceSource.includes('joinPath: nodePath.join'), 'graphMetaService 必须注入 joinPath 才能定位分片目录')
  const migrationSource = await readFile(new URL('../scripts/migrate-graph-shards.mts', import.meta.url), 'utf-8')
  assert.ok(migrationSource.includes("const apply = args.includes('--apply')"), '迁移脚本必须默认 dry-run')
  assert.ok(migrationSource.includes('store.migrateRoom('), '迁移脚本必须复用主进程同一份分片实现')
  assert.ok(migrationSource.includes('fs.copyFileSync(room.graphFile, backupFile)'), '落盘前必须备份原始 _graph.json')
  const shardServiceSource = await readFile(new URL('../electron/services/graph-meta-service.js', import.meta.url), 'utf-8')
  assert.ok(shardServiceSource.includes('export function graphMetaComparisonKey'), '顺序无关比较键必须单一实现在主进程模块')
  assert.ok(
    shardServiceSource.includes('graphMetaComparisonKey(expected) !== graphMetaComparisonKey(roundTrip)'),
    'migrateRoom 必须用顺序无关比较键，否则所有多边房间都会被误判失败'
  )
  assert.ok(migrationSource.includes('graphMetaComparisonKey('), '迁移脚本 --verify 必须复用主进程比较键，不得自己写第二套')
  assert.ok(migrationSource.includes('quarantineShards'), '迁移失败后必须隔离残留 _graph/ 分片，否则房间会被永久拒绝迁移')
  // 全库格式统一：迁移脚本必须把 version=0 的 {} 空档也纳入升级，只迁 v1 会永远留 165 个旧格式房间。
  assert.ok(migrationSource.includes('[...v1, ...empty]'), '待升级列表必须同时包含 v1 有数据房间与 version=0 空档')
  // 应用可能在运行：落盘前必须复核扫描时记录的 sha256，防止覆盖用户刚保存的数据。
  // 不能只查字面量：把判断写成 `false && currentHash !== ...` 也能蒙混过去。
  // 断言「if 块里紧接着真的 throw」，把「条件被禁用」这类退化也拦住。
  assert.ok(
    /if \(currentHash !== room\.contentHash\) \{\s*throw new Error\('扫描后/.test(migrationSource),
    '落盘前必须真的执行 TOCTOU 哈希复核，且 hash 不符时必须抛错中止'
  )
  assert.ok(migrationSource.includes('backupCreated'), 'TOCTOU 提前中止时不得回滚/隔离分片（只能在实际写盘后）')
}

console.log('Critical regression checks verified')
