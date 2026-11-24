import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { getRemoteImageRequestHeaders } from '../electron/services/attachment-service.js'
import { getImagePreviewScale } from '../src/features/documents/SmartDocumentEditor/imagePreview.ts'
import { quoteEnterPayload, shouldHandleQuoteEnter } from '../src/features/documents/SmartDocumentEditor/quoteEnter.ts'
import { containsMarkdownFence, normalizeFenceIndentation } from '../src/features/documents/SmartDocumentEditor/fenceNormalize.ts'
import { isValidHexColor, resolveDocumentIcon } from '../src/features/documents/components/documentMeta.ts'
import {
  ACCENT_POLICIES,
  ACCENT_TOKEN_NAMES,
  DEFAULT_ACCENT_COLOR,
  buildAccentTokens,
  harmonizeAccentColor,
  normalizeAccentColor,
  resolveAccentPolicy,
} from '../src/domain/theme/accentColor.ts'
import { ACCENT_PRESETS } from '../src/domain/theme/accentPresets.ts'
import {
  THEME_CONFIG_VERSION,
  parseThemeConfig,
  serializeThemeConfig,
} from '../src/domain/theme/themeConfig.ts'
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
import { TOPO_DOCUMENT_TYPES, TOPO_PANEL_DOCUMENT_TYPES, isTopoDocumentType, isPanelDocumentType } from '../src/core/topoDocumentTypes.ts'
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
import {
  normalizeMathSource,
  renderMathToHtml,
} from '../src/features/documents/SmartDocumentEditor/mathRender.ts'
import { SaveCoordinator } from '../src/domain/persistence/saveCoordinator.ts'
import {
  flushTabs,
  getDirtyState,
  registerTabSaver,
} from '../src/core/close-guard.ts'
import { normalizeDefaultEdgeStyle } from '../src/domain/style/normalizeStyleConfig.ts'
import { normalizeGraphMeta } from '../src/domain/graph/normalizeGraphMeta.ts'
import {
  BUILTIN_EDGE_RELATIONS,
  DEFAULT_EDGE_RELATION_ID,
  SUBORDINATE_EDGE_RELATION_ID,
  DEFAULT_RELATED_DISPLAY_NAME,
  EDGE_RELATION_IDS,
  LEGACY_EDGE_RELATION_MAP,
  assertEdgeRelationForCreate,
  describeEdgeSemantic,
  edgeRelationStylePatch,
  normalizeEdgeRelationDefinitions,
  normalizeEdgeRelationLabel,
  parseStrictEdgeRelation,
  readEdgeRelationId,
  resolveEdgeRelationId,
  isSubordinate,
} from '../src/domain/graph/edgeRelations.ts'
import {
  VIEWPORT_RETURN_TTL_MS,
  VIEWPORT_RETURN_ANIMATION_MS,
  hasUserMovedAway,
  isViewportReturnExpired,
  shouldOfferViewportReturn,
  viewportJumpDistance,
  viewportPanDistance,
  viewportReturnRemainingMs,
  viewportZoomDistance,
} from '../src/domain/graph/viewportReturn.ts'
import {
  buildHierarchy,
  normalizeTree,
  planEdgeRelationMigration,
  validateSubordinateEdge,
  toHierarchyEdge,
  MAX_HIERARCHY_DEPTH,
  SUBORDINATE_EDGE_DIRECTION,
} from '../src/domain/graph/graphHierarchy.ts'
import { normalizeConfig } from '../src/core/storage/normalizeConfig.ts'
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

{
  // 【P1】X6 flowchart 退场 + Excalidraw 容器载荷接入。
  // 旧的 flowchartCellSync / normalizeFlowchartDocumentContent 断言随编辑器目录一并删除，
  // 改为守住「旧数据零丢失 + 容器载荷零暴露」这两条新的回归红线。
  assert.deepEqual([...TOPO_DOCUMENT_TYPES], ['smart', 'mindmap', 'excalidraw', 'cardspec'],
    '【P1】落盘类型全集必须包含 excalidraw 与 cardspec、移除 flowchart')
  assert.deepEqual([...TOPO_PANEL_DOCUMENT_TYPES], ['smart', 'mindmap'],
    '【P1】右栏 surface 只能有智能文档与思维导图')

  const [
    fileServiceSource, docIdSource, hostSource, editorRegistrySource,
    treeSource, sidebarSource, packageSource, typeRegistrySource,
  ] = await Promise.all([
    readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8'),
    readFile(new URL('../electron/services/document-id-service.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/DocumentEditorHost.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/services/documentEditorRegistry.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/types/documentTypes.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/model/useDocumentSidebarModel.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../package.json', import.meta.url), 'utf-8'),
    // Node 的 strip-types 不解析无扩展名相对导入，注册表只做静态门禁。
    readFile(new URL('../src/features/documents/services/documentTypeRegistry.ts', import.meta.url), 'utf-8'),
  ])

  assert.equal(isTopoDocumentType('excalidraw'), true, '【P1】容器载荷必须能通过落盘类型校验')
  assert.equal(isTopoDocumentType('cardspec'), true, '【P1】知识卡片载荷必须能通过落盘类型校验')
  assert.equal(isTopoDocumentType('flowchart'), false, '【P1】旧 flowchart 不得再进渲染层枚举')
  assert.equal(isPanelDocumentType('excalidraw'), false, '【P1】容器载荷不得出现在右栏新建菜单/文档树')
  assert.equal(isPanelDocumentType('cardspec'), false, '【P1】知识卡片载荷不得出现在右栏新建菜单/文档树')
  assert.ok(typeRegistrySource.includes("surface: 'panel' | 'container-only'")
    && typeRegistrySource.includes("surface: 'container-only'")
    && typeRegistrySource.includes('export function getPanelDocumentTypes()')
    && typeRegistrySource.includes('return TOPO_PANEL_DOCUMENT_TYPES'),
  '【P1】注册表必须区分 panel/container-only surface，并提供右栏专用类型列表')

  // 主进程 compat：flowchart 必须继续被归一化 / 扫描 / 重映射，否则 tree.json 条目会被静默删除。
  assert.ok(fileServiceSource.includes("excalidraw: '.exdraw.json'")
    && fileServiceSource.includes("cardspec: '.cardspec.json'")
    && fileServiceSource.includes("flowchart: '.tflow.json'")
    && fileServiceSource.includes("excalidraw: 'topomind.excalidraw-document'")
    && fileServiceSource.includes("cardspec: 'topomind.card-spec'")
    && fileServiceSource.includes("flowchart: 'topomind.flowchart-document'"),
  '【P1】主进程扩展名表/schema 表必须同时包含新载荷与旧 flowchart compat 类型')
  const creatableBlock = fileServiceSource.slice(
    fileServiceSource.indexOf('const TOPO_CREATABLE_DOCUMENT_TYPES'),
    fileServiceSource.indexOf('function _fs_isPlainObject'),
  )
  assert.ok(creatableBlock.includes('excalidraw: true') && creatableBlock.includes('cardspec: true') && !creatableBlock.includes('flowchart'),
    '【P1】可新建类型白名单必须放行 excalidraw/cardspec 并排除 flowchart')
  assert.ok(fileServiceSource.includes('hasOwnProperty.call(TOPO_CREATABLE_DOCUMENT_TYPES, type)'),
    '【P1】_fs_createTopoDocument 必须有 creatable 守卫，否则旧流程图还能被新建')
  assert.ok(fileServiceSource.includes("if (type === 'excalidraw')")
    && fileServiceSource.includes('TOPO_DOCUMENT_SCHEMAS.excalidraw'),
  '【P1】新建容器载荷必须生成 excalidraw 空场景，不能落到 X6 分支')
  assert.ok(fileServiceSource.includes("if (type === 'cardspec')")
    && fileServiceSource.includes('TOPO_DOCUMENT_SCHEMAS.cardspec')
    && fileServiceSource.includes("layout: 'stack'"),
  '【P1】新建知识卡片载荷必须生成 cardspec 空卡片（stack 布局 + 空组件表）')
  assert.ok(fileServiceSource.includes('documentExtensions: Object.values(TOPO_DOCUMENT_EXTENSIONS)'),
    '【P1】roomSummary hasDetail 必须自动跟随扩展名表，容器节点才会被判定为有详情')

  assert.ok(docIdSource.includes("excalidraw: '.exdraw.json'")
    && docIdSource.includes("cardspec: '.cardspec.json'")
    && docIdSource.includes("flowchart: '.tflow.json'")
    && docIdSource.includes('(tdoc|tmind|exdraw|cardspec|tflow)')
    && docIdSource.includes('.json$/i.test(entry.name)'),
  '【P1】全库扫描正则必须认 .exdraw.json / .cardspec.json 且继续认 .tflow.json，否则旧条目会丢')

  assert.ok(hostSource.includes('getPanelDocumentTypes()')
    && hostSource.includes('!adapter')
    && hostSource.includes('retiredContent'),
  '【P1】右栏必须隐藏容器载荷，并在 adapter 缺失时显示下线占位而不是崩溃')
  assert.ok(hostSource.includes('adapter?.hasToc') && hostSource.includes('adapter?.hasStats'),
    '【P1】下线占位仍会走 DocumentWorkspaceLayout，TOC/统计读取 adapter 必须判空')
  assert.ok(!editorRegistrySource.includes('FlowchartDocumentAdapter')
    && !editorRegistrySource.includes('@antv/x6')
    && editorRegistrySource.includes('Partial<Record<TopoDocumentType, DocumentEditorTypeAdapter>>')
    && editorRegistrySource.includes('DocumentEditorTypeAdapter | undefined'),
  '【P1】编辑器注册表必须移除 X6 适配器，并把查找结果声明为可空')
  assert.ok(treeSource.includes('isPanelDocumentType(doc.type)')
    && sidebarSource.includes('isPanelDocumentType(createType)'),
  '【P1】文档树与右键创建动作都必须按 surface 过滤，不能只靠菜单隐藏')
  assert.ok(!packageSource.includes('@antv/x6'), '【P1】X6 依赖必须全部移除')
}

{
  // 【P2/P3/P4】容器载荷纯函数真跑 + 注册表 / 预览队列 / 两态接线静态门禁。
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const { readdir } = await import('node:fs/promises')
  const bundle = async (rel: string) => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(rel, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
      banner: { js: 'globalThis.window = globalThis.window || {};' },
    })
    return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  }

  const doc = await bundle('../src/features/documents/ExcalidrawDocument/excalidrawDocumentTypes.ts')
  const empty = doc.createEmptyExcalidrawDocumentContent('空板')
  assert.equal(empty.schema, 'topomind.excalidraw-document', '【P2】空载荷必须带正确 schema')
  assert.deepEqual(empty.scene.elements, [], '【P2】空载荷必须是空场景')
  const normalized = doc.normalizeExcalidrawDocumentContent({
    title: ' 白板 ', version: 1,
    scene: {
      elements: [
        { id: 'a', type: 'rectangle', version: 2, x: 1 },
        { id: 'b', type: 'rectangle', isDeleted: true },
        { id: 'a', type: 'rectangle' },
      ],
      appState: { viewBackgroundColor: '#ffffff', zoom: 999, scrollX: 5, selectedElementIds: { a: true } },
    },
  }, '回退标题')
  assert.equal(normalized.scene.elements.length, 1, '【P2】删除元素与重复 id 必须被过滤')
  assert.equal(normalized.title, '白板', '【P2】标题必须去空白')
  assert.equal(normalized.scene.appState.zoom, 30, '【P2】zoom 必须有界归一化')
  assert.equal(normalized.scene.appState.selectedElementIds, undefined,
    '【P2】绝不落完整 AppState（选中态 / UI 状态不得持久化）')
  assert.throws(() => doc.normalizeExcalidrawDocumentContent({ version: 2 }, 'x'),
    '【P2】未知 version 必须抛错，绝不静默覆盖看不懂的数据')
  assert.equal(doc.normalizeExcalidrawDocumentContent(null, '回退标题').title, '回退标题',
    '【P2】缺失载荷必须回落空场景')
  const versionA = doc.excalidrawSceneVersion(normalized)
  const versionB = doc.excalidrawSceneVersion({
    ...normalized, scene: { ...normalized.scene, elements: [{ id: 'a', type: 'rectangle', version: 3 }] },
  })
  assert.notEqual(versionA, versionB, '【P2】scene version 变化必须让预览缓存失效')
  // 2026-11-23：内容版本同时被「全屏宿主写盘去重」和「SVG 预览缓存键」复用。
  // 只统计元素时，改画布背景既不会落盘、也不会重新导出 SVG，退出后设置全丢。
  const versionBg = doc.excalidrawSceneVersion({
    ...normalized,
    scene: {
      ...normalized.scene,
      appState: { ...normalized.scene.appState, viewBackgroundColor: '#ff0000' },
    },
  })
  assert.notEqual(versionA, versionBg,
    '【画布背景】只改 viewBackgroundColor 也必须改变内容版本（写盘去重 + 预览缓存共用）')
  const versionGrid = doc.excalidrawSceneVersion({
    ...normalized,
    scene: { ...normalized.scene, appState: { ...normalized.scene.appState, gridSize: 20 } },
  })
  assert.notEqual(versionA, versionGrid,
    '【画布背景】网格开关同属可持久化外观，必须让预览缓存失效')
  const versionViewport = doc.excalidrawSceneVersion({
    ...normalized,
    scene: {
      ...normalized.scene,
      appState: {
        ...normalized.scene.appState,
        scrollX: 9999, scrollY: -3, zoom: 2, selectedElementIds: { a: true },
      },
    },
  })
  assert.equal(versionA, versionViewport,
    '【画布背景】平移 / 缩放 / 选中态是视口瞬态，不得触发写盘与预览重导出')

  // 【P5】CardSpec 纯函数真跑：schema / 去重 / 脏值 / src 安全 / 未知类型保留 / hash 失效。
  const card = await bundle('../src/features/documents/CardSpecDocument/cardSpecTypes.ts')
  assert.equal(card.CARDSPEC_DOCUMENT_SCHEMA, 'topomind.card-spec', '【P5】CardSpec 载荷必须带正确 schema')
  const emptyCard = card.createEmptyCardSpecContent('空卡')
  assert.equal(emptyCard.layout, 'stack', '【P5】空卡片必须是 stack 布局')
  assert.deepEqual(emptyCard.components, [], '【P5】空卡片必须是空组件表')
  const normalizedCard = card.normalizeCardSpecContent({
    version: 1, title: '  卡片  ', layout: 'grid',
    components: [
      { id: 'a', type: 'title', props: { text: '标题', level: 2 } },
      { id: 'a', type: 'text', props: { text: '重复 id' } },
      { id: 'b', type: 'badge', props: { text: 'ok', tone: 'zzz' } },
      { id: 'c', type: 'image', props: { src: '../secret.png' } },
      { id: 'd', type: 'future', props: { x: 1 } },
      { id: 'e', type: 'progress', props: { value: 999 } },
    ],
  }, '回退标题')
  assert.equal(normalizedCard.title, '卡片', '【P5】标题必须去空白')
  assert.equal(normalizedCard.layout, 'grid', '【P5】布局必须按枚举归一化')
  assert.equal(normalizedCard.components.length, 5, '【P5】重复 id 组件必须被丢弃')
  assert.equal(normalizedCard.components.find((c: any) => c.id === 'b').props.tone, 'neutral',
    '【P5】非法 tone 必须回落默认值')
  assert.equal(normalizedCard.components.find((c: any) => c.id === 'c').degraded, 'invalid-src',
    '【P5】越界资源路径必须标记降级')
  assert.equal(normalizedCard.components.find((c: any) => c.id === 'c').props.src, '../secret.png',
    '【P5】非法 src 必须保留原值但不渲染')
  assert.equal(normalizedCard.components.find((c: any) => c.id === 'd').degraded, 'unknown-type',
    '【P5】未知组件类型必须保留并降级占位')
  assert.equal(normalizedCard.components.find((c: any) => c.id === 'd').props.x, 1,
    '【P5】未知组件 props 不得被抹除')
  assert.equal(normalizedCard.components.find((c: any) => c.id === 'e').props.value, 100,
    '【P5】progress 必须有界归一化')
  assert.throws(() => card.normalizeCardSpecContent({ version: 2 }, 'x'),
    '【P5】未知 version 必须抛错，绝不静默覆盖看不懂的数据')
  const imageExts = card.CARD_IMAGE_EXTENSIONS
  assert.equal(card.isValidCardAssetSrc('assets/a.png', imageExts), true, '【P5】合法图片相对路径必须放行')
  assert.equal(card.isValidCardAssetSrc('assets/../a.png', imageExts), false, '【P5】.. 必须拒绝')
  assert.equal(card.isValidCardAssetSrc('/abs/a.png', imageExts), false, '【P5】绝对路径必须拒绝')
  assert.equal(card.isValidCardAssetSrc('http://x/a.png', imageExts), false, '【P5】远程 URL 必须拒绝')
  assert.equal(card.isValidCardAssetSrc('assets/a.exe', imageExts), false, '【P5】非法扩展名必须拒绝')
  const roundTrip = card.normalizeCardSpecContent(JSON.parse(card.serializeCardSpecContent(normalizedCard)), '回退标题')
  assert.deepEqual(roundTrip.components, normalizedCard.components, '【P5】serialize → normalize 往返组件不丢')
  assert.notEqual(card.cardSpecContentVersion(normalizedCard), card.cardSpecContentVersion(emptyCard),
    '【P5】内容变化必须让预览缓存失效')

  const registry = await bundle('../src/domain/container/containerTypes.ts')
  assert.equal(registry.getContainerType('probe'), undefined, '【P2】未注册类型必须返回 undefined 而不是抛错')
  registry.registerContainerType({
    id: 'probe', documentType: 'smart', schema: 'x', version: 1,
    createEmpty: () => ({}), normalize: () => ({}), serialize: () => '{}',
  })
  assert.equal(registry.getContainerType('probe').id, 'probe', '【P2】注册项必须按 container.type 可查')
  assert.equal(registry.listContainerTypes().length, 1, '【P2】注册表必须可枚举，供后续扩展')
  assert.throws(() => registry.registerContainerType({ id: '' }), '【P2】非法 spec 必须拒绝注册')

  const queue = await bundle('../src/features/graph/GraphCanvas/containers/svgPreviewQueue.ts')
  let running = 0
  let peak = 0
  await Promise.all(Array.from({ length: 9 }, () => queue.enqueueSvgRender(async () => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 4))
    running -= 1
    return {}
  })))
  assert.ok(peak <= queue.SVG_PREVIEW_MAX_CONCURRENCY && peak > 1,
    `【P2】SVG 导出必须有并发闸门且确实并发（peak=${peak}）`)
  queue.clearSvgPreviewCache()
  for (let i = 0; i < queue.SVG_PREVIEW_CACHE_LIMIT + 12; i += 1) {
    queue.putCachedSvg(`key-${i}`, { cloneNode: () => ({ tag: i }) })
  }
  assert.equal(queue.svgPreviewCacheSize(), queue.SVG_PREVIEW_CACHE_LIMIT, '【P2】预览缓存必须有界 LRU')
  assert.equal(queue.getCachedSvg('key-0'), undefined, '【P2】最久未用条目必须被淘汰')
  assert.ok(queue.cloneCachedSvg(`key-${queue.SVG_PREVIEW_CACHE_LIMIT + 11}`) !== null,
    '【P2】缓存命中必须返回可挂载的副本，不能复用同一个 DOM 节点')
  queue.clearSvgPreviewCache()
  assert.equal(queue.svgPreviewCacheSize(), 0)

  const [
    canvasSrc, registerSrc, cardSrc, editorSrc, assetsSrc, builderSrc,
    menuSrc, actionsSrc, modelSrc, pkgSrc, viteSrc,
    syncSrc, buildEntrySrc, gitignoreSrc, mainSrc,
    hostSrc, graphPageSrc, storeSrc, previewSrc,
  ] = await Promise.all([
    readFile(new URL('../src/features/graph/GraphCanvas/GraphCanvas.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/containers/registerContainers.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/nodes/ContainerCard/ContainerCard.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/containers/ExcalidrawContainerEditor.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/containers/excalidrawAssets.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../src/hooks/useGraph/graphBuilder.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphPage/components/GraphPageContextMenu.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphPage/model/useNodeActions.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../package.json', import.meta.url), 'utf-8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf-8'),
    readFile(new URL('../scripts/sync-excalidraw-assets.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../.gitignore', import.meta.url), 'utf-8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/containers/ContainerFullscreenEditorHost.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphPage/GraphPage.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/containers/activeContainerStore.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/graph/GraphCanvas/containers/ContainerSvgPreview.tsx', import.meta.url), 'utf-8'),
  ])
  assert.ok(viteSrc.includes("id.includes('/jotai/')")
    && viteSrc.includes("id.includes('/jotai-scope/')")
    && viteSrc.includes('return \'react-vendor\''),
  '【P3】Excalidraw 的 jotai 依赖必须并入 react-vendor；拆成 lib-jotai 会造成跨 chunk 循环 init 并白屏')
  assert.ok(canvasSrc.includes('containerCard: ContainerCard')
    && builderSrc.includes("roomNode.kind === 'container' ? 'containerCard' : 'knowledgeCard'"),
  '【P2】nodeTypes 与 graphBuilder 必须同时按 kind 映射 containerCard')
  assert.ok(registerSrc.includes('lazy(() => import(') && registerSrc.includes('Preview: ContainerSvgPreview'),
    '【P3】Editor 必须 lazy，预览必须是独立渲染器，主 chunk 不得含 Excalidraw')
  assert.ok(registerSrc.includes("import './excalidrawContainerType'"),
    '【P2】领域 spec 必须在宿主装配时完成注册')
  // ---- v1.4：编辑从「节点内嵌」改为「全屏覆盖」，节点永久只读预览 ----
  assert.ok(!cardSrc.includes('<Editor')
    && !cardSrc.includes('registerTabSaver')
    && !cardSrc.includes('minEditDisplayPercent')
    && cardSrc.includes('<Preview')
    && cardSrc.includes('activate({')
    && cardSrc.includes('displayPercent >= PREVIEW_MIN_DISPLAY_PERCENT'),
  '【P4-v1.4】节点必须退化为只读预览：零编辑器实例、零 saver、零缩放编辑门槛')
  assert.ok(cardSrc.includes('isCanvasReadOnly') === false,
    '【P4】容器内容编辑不得绑画布只读闸门（大房间 LOD hidden>0 会永远只读）')
  // ---- 2026-11-23：容器节点默认不展示标题栏，整块区域只放内容预览 ----
  assert.ok(!cardSrc.includes('h-7 shrink-0')
    && !cardSrc.includes('全屏编辑中')
    && cardSrc.includes('className="relative h-full w-full"')
    && cardSrc.includes('${title} · 双击进入全屏编辑')
    && cardSrc.includes('aria-label={title}')
    && cardSrc.includes('data-tm-container-active={isEditingThis'),
  '【容器外观】默认不渲染占位 header：节点只展示预览，节点名走 title / aria-label，编辑态仍由 data 属性暴露')
  assert.ok(hostSrc.includes('createPortal(')
    && hostSrc.includes('document.body')
    && hostSrc.includes("position: 'fixed'")
    && hostSrc.includes('data-tm-fullscreen-editor')
    && hostSrc.includes('registerTabSaver')
    && hostSrc.includes('bumpRevision()')
    && hostSrc.includes('writeTopoDocument')
    && hostSrc.includes('readTopoDocument'),
  '【P4-v1.4】全屏宿主必须 portal 到 body、独占读写与 close-guard、并广播预览刷新')
  assert.ok(graphPageSrc.includes('ContainerFullscreenEditorHost')
    && graphPageSrc.includes('isActive={isActive}'),
  '【P4-v1.4】宿主必须挂在 GraphPage 且与 GraphCanvas 同级，滚轮/按键不回流画布')
  assert.ok(storeSrc.includes('tabId') && storeSrc.includes('cardPath')
    && storeSrc.includes('revision') && storeSrc.includes('bumpRevision'),
  '【P4-v1.4】会话必须携带完整读写上下文 + 预览刷新信号')
  assert.ok(editorSrc.includes('data-shortcut-scope="excalidraw"')
    && editorSrc.includes('data-tm-container-surface={active ?')
    && editorSrc.includes('viewModeEnabled={!active}')
    && editorSrc.includes('event.stopPropagation()')
    && editorSrc.includes("UIOptions={{ tools: { image: false } }}")
    && editorSrc.includes('handleKeyboardGlobally'),
  '【P4】编辑态必须隔离快捷键、阻断滚轮、禁图片、并用 viewMode/全局键盘双保险')
  assert.ok(canvasSrc.includes('[data-tm-container-surface="active"]')
    && canvasSrc.includes('deactivateActiveContainer')
    && !canvasSrc.includes('!isAtMaxZoom(zoomLevel)'),
  '【P4-v1.4】外层保留 active-surface 防御与切房间收口，但不得再按缩放强制失活')

  // ---- 2026-11-24：智能文档「手绘流程图」块。场景内联在块 props.scene，
  // 与画布容器是两条独立链路；这里只锁结构，运行时交互由 verify-excalidraw-block-gui 覆盖。
  const [
    blockSchemaSrc, blockConstantsSrc, blockInsertMenuSrc, smartEditorSrcForBlock,
    blockSupportSrc, blockFullscreenSrc, blockStylesSrc,
  ] = await Promise.all([
    readFile(new URL('../src/features/documents/SmartDocumentEditor/smartDocumentSchema.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/SmartDocumentEditor/constants.ts', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/SmartDocumentEditor/components/SmartDocumentBlockMenu.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/SmartDocumentEditor/excalidrawBlockSupport.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/SmartDocumentEditor/ExcalidrawBlockFullscreenEditor.tsx', import.meta.url), 'utf-8'),
    readFile(new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url), 'utf-8'),
  ])
  assert.ok(blockSchemaSrc.includes('excalidraw: ExcalidrawBlock()')
    && blockConstantsSrc.includes("type: 'excalidraw'")
    && blockInsertMenuSrc.includes("action.type !== 'excalidraw'")
    && smartEditorSrcForBlock.includes('excalidrawItem')
    && smartEditorSrcForBlock.includes("type: 'excalidraw'"),
  '【文档流程图块】块规格、块菜单动作、content:none 插入例外、斜杠菜单入口必须四处齐备')
  assert.ok(blockSupportSrc.includes('createReactBlockSpec')
    && blockSupportSrc.includes("scene: { default: '' }")
    && blockSupportSrc.includes("content: 'none'")
    && blockSupportSrc.includes('createPortal(')
    && blockSupportSrc.includes('document.body')
    && blockSupportSrc.includes('lazy(() =>')
    && blockSupportSrc.includes('beginMathEditing()')
    && blockSupportSrc.includes('updateBlock(')
    && blockSupportSrc.includes('onDoubleClick'),
  '【文档流程图块】场景内联 props.scene；全屏编辑期间不 updateBlock（setNodeMarkup 会重建节点视图卸载 portal），退出时一次性写回；编辑器必须 lazy')
  // 两个新文件的头部注释都写了「刻意不复用 data-tm-container-* 契约」这句说明，
  // 直接 includes 会把注释当成真实 DOM 契约误报（C14 同款坑），先剥注释再查代码。
  const stripBlockComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const blockSupportCode = stripBlockComments(blockSupportSrc)
  const blockFullscreenCode = stripBlockComments(blockFullscreenSrc)
  assert.ok(!blockSupportCode.includes('data-tm-container-')
    && !blockFullscreenCode.includes('data-tm-container-')
    && blockFullscreenCode.includes('data-shortcut-scope="excalidraw"')
    && blockFullscreenCode.includes('ensureExcalidrawAssets()')
    && blockFullscreenCode.includes('handleKeyboardGlobally')
    && blockStylesSrc.includes('.tm-excalidraw-block-preview'),
  '【文档流程图块】不得复用画布容器的 DOM 契约；快捷键隔离、自托管资源与预览样式必须齐备')

  // ---- 2026-11-24：流程图块「拖边框调尺寸 / 去说明文字 / hover tooltip / 点击后对齐浮层」----
  // 尺寸与对齐都必须存进块 props（重开文档不丢）；拖动期间只改本地 CSS，松手一次提交。
  const exdrawAlignToolbarSrc = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/components/ExcalidrawBlockToolbar.tsx', import.meta.url,
  ), 'utf-8')
  assert.ok(!blockSupportSrc.includes('tm-excalidraw-block-hint')
    && !blockStylesSrc.includes('.tm-excalidraw-block-hint')
    && blockSupportSrc.includes('data-tm-excalidraw-block-tooltip="双击进入编辑"')
    && blockSupportSrc.includes('displayWidth: { default: 0 }')
    && blockSupportSrc.includes('displayHeight: { default: DEFAULT_PREVIEW_HEIGHT }')
    && blockSupportSrc.includes("textAlignment: { default: 'left'")
    && blockSupportSrc.includes('data-tm-excalidraw-block-resize=')
    && blockSupportSrc.includes('setPointerCapture(')
    && blockSupportSrc.includes('releasePointerCapture(')
    && blockStylesSrc.includes('[data-tm-excalidraw-block-align="right"]')
    && blockStylesSrc.includes('body.tm-excalidraw-block-is-resizing'),
  '【文档流程图块】必须移除预览下方说明文字、提供 hover tooltip、把尺寸/对齐落进块 props，并支持拖动边框一次提交')
  assert.ok(exdrawAlignToolbarSrc.includes('createPortal(')
    && exdrawAlignToolbarSrc.includes('editor.getBlock(id)')
    && exdrawAlignToolbarSrc.includes('editor.updateBlock(block, { props: { textAlignment: value } })')
    && ["value: 'left'", "value: 'center'", "value: 'right'"].every((s) => exdrawAlignToolbarSrc.includes(s))
    && exdrawAlignToolbarSrc.includes("document.querySelector('[data-tm-excalidraw-block-editor]')")
    && smartEditorSrcForBlock.includes('<ExcalidrawBlockToolbar />')
    && blockStylesSrc.includes('.tm-excalidraw-block-toolbar')
    && blockStylesSrc.includes('z-index: 4000'),
  '【文档流程图块】点击后上方浮层须含三对齐按钮、全屏编辑期间隐藏，并挂进编辑器')

  // ---- 2026-11-24：Excalidraw 跟随软件明暗主题（纯 UI 层，绝不写进文档数据）----
  const excalidrawThemeSrc = await readFile(
    new URL('../src/features/documents/ExcalidrawDocument/excalidrawTheme.ts', import.meta.url), 'utf-8',
  )
  const containerEditorCode = stripBlockComments(editorSrc)
  const containerPreviewCode = stripBlockComments(previewSrc)
  // 模块头注释里写了「来自 @excalidraw/excalidraw 源码」，同样要先剥注释再查依赖。
  const excalidrawThemeCode = stripBlockComments(excalidrawThemeSrc)
  assert.ok(excalidrawThemeCode.includes('useThemeStore')
    && excalidrawThemeCode.includes('toExcalidrawColorMode')
    && excalidrawThemeCode.includes("'invert(93%) hue-rotate(180deg)'")
    && !excalidrawThemeCode.includes('@excalidraw/excalidraw'),
  '【Excalidraw 主题】唯一映射必须订阅软件主题、与 Excalidraw THEME_FILTER 一致，且不依赖编辑器包')
  assert.ok(blockFullscreenCode.includes('theme={colorMode}')
    && containerEditorCode.includes('theme={colorMode}')
    && !blockFullscreenCode.includes('theme="light"')
    && !containerEditorCode.includes('theme="light"')
    && blockFullscreenCode.includes('useExcalidrawColorMode()')
    && containerEditorCode.includes('useExcalidrawColorMode()'),
  '【Excalidraw 主题】两处编辑器的 theme prop 必须跟随软件主题，禁止硬编码 light')
  assert.ok(blockSupportCode.includes('excalidrawPreviewFilter(colorMode)')
    && containerPreviewCode.includes('excalidrawPreviewFilter(colorMode)')
    && !blockSupportCode.includes('exportWithDarkMode')
    && !containerPreviewCode.includes('exportWithDarkMode'),
  '【Excalidraw 主题】两处只读预览用容器 CSS filter 反转，禁止 exportWithDarkMode 造成双重反转')
  assert.ok(blockFullscreenCode.includes("theme: 'light'")
    && containerEditorCode.includes("theme: 'light'"),
  '【Excalidraw 主题】落盘 appState.theme 保持场景值，软件主题不得写进文档数据')
  // 回归锁：显示 100% 的 raw zoom 是 ZOOM_REFERENCE=0.65，拿裸 transform[2] 跟 1 比
  // 会让预览 LOD 判定错位；编辑入口则已彻底与缩放解耦。
  assert.ok(cardSrc.includes('toDisplayPercent(zoom)')
    && cardSrc.includes('PREVIEW_MIN_DISPLAY_PERCENT')
    && !cardSrc.includes('minEditDisplayPercent')
    && !registerSrc.includes('minEditDisplayPercent')
    && !cardSrc.includes('minEditZoom')
    && !cardSrc.includes('zoom >= 1')
    && !canvasSrc.includes('zoomLevel < 1'),
  '【P4-v1.4】预览 LOD 仍按显示百分比；编辑入口与缩放彻底解耦，禁止裸 zoom 比较')
  // ---- v1.5：节点边框可拖拽 resize，SVG 预览按节点内容区实测尺寸等比适配 ----
  assert.ok(cardSrc.includes('<NodeResizer')
    && cardSrc.includes('overflow-visible')
    && cardSrc.includes('overflow-hidden')
    && cardSrc.includes('useActiveCanvasReadOnly()')
    && cardSrc.includes('closest') && cardSrc.includes('.react-flow__resize-control')
    && cardSrc.includes('nodeSizeLimits'),
  '【P4-v1.5】容器必须可拖拽边框：双层壳不裁手柄、遵守画布只读、双击不被手柄误触发、尺寸上限同源')
  assert.ok(previewSrc.includes('ResizeObserver')
    && previewSrc.includes('preserveAspectRatio')
    && previewSrc.includes('xMidYMid meet')
    && previewSrc.includes('data-tm-container-preview-fit="node"')
    && previewSrc.includes('syncSvgSize')
    && previewSrc.includes("removeAttribute('width')"),
  '【P4-v1.5】SVG 预览必须去掉固定尺寸、按内容区实测尺寸等比适配并随 resize 实时同步')
  assert.ok(hostSrc.includes('getSceneVersion')
    && previewSrc.includes('excalidrawSceneVersion(normalized)'),
  '【画布背景】写盘去重与 SVG 预览缓存必须共用同一内容版本，只改背景不得被跳过')
  assert.ok(previewSrc.includes('backgroundColor={normalizedBackground}')
    && previewSrc.includes('style={backgroundColor ? { backgroundColor } : undefined}'),
  '【画布背景】空白白板 / LOD 占位分支也必须渲染用户设置的画布背景色')
  assert.ok(modelSrc.includes('data-tm-container-surface="active"'),
    '【P4】全局捕获阶段的 Ctrl+F 必须自行让位给活跃容器')
  assert.ok(assetsSrc.includes('document.baseURI') && assetsSrc.includes('EXCALIDRAW_ASSET_PATH'),
    '【P3】file:// 下必须给绝对 asset URL，不能有 CDN 回落')
  assert.ok(mainSrc.includes('ensureExcalidrawAssets()')
    && editorSrc.includes('ensureExcalidrawAssets()'),
  '【P3】asset path 必须在主入口同步设置（Excalidraw 子 effect 早于容器父 effect，晚设置会全量回落 esm.sh CDN）')
  assert.ok(syncSrc.includes("'fonts'") && syncSrc.includes("'locales'")
    && syncSrc.includes('cpSync') && syncSrc.includes('.sync-stamp.json'),
  '【P3】字体/语言包必须由同步脚本从依赖包复制，且带版本 stamp 保证幂等')
  assert.ok(buildEntrySrc.includes('sync-excalidraw-assets.mjs')
    && pkgSrc.includes('"predev"')
    && gitignoreSrc.includes('/public/excalidraw-assets/'),
  '【P3】15MB 自托管资源不入库，但 predev / build 必须能自动补齐，否则干净 clone 会离线缺字')
  // 已同步过的工作区顺带校验内容；干净 clone 未跑同步时由上面的挂钩断言兜底。
  try {
    const fontDirs = await readdir(fileURLToPath(new URL('../public/excalidraw-assets/fonts', import.meta.url)))
    assert.ok(fontDirs.includes('Excalifont') && fontDirs.includes('Virgil'),
      '【P3】自托管字体必须含 Excalifont / Virgil')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  assert.ok(pkgSrc.includes('"@excalidraw/excalidraw"'), '【P3】编辑器依赖必须锁定在 dependencies')
  assert.ok(menuSrc.includes('新建流程图容器')
    && menuSrc.includes('新建知识卡片容器')
    // 创建入口已按容器变体参数化：两种载荷共用同一条「建节点 → 建载荷 → 更新单节点 → 原地刷新」链路。
    && actionsSrc.includes("excalidraw: { name: '流程图容器'")
    && actionsSrc.includes("cardspec: { name: '知识卡片容器'")
    && actionsSrc.includes('createContainerChild(position,')
    && actionsSrc.includes('type: config.documentType')
    && actionsSrc.includes('updateNode(cardId')
    && actionsSrc.includes('graph.refreshCurrentRoom()')
    && actionsSrc.includes('isActiveCanvasReadOnly()'),
  '【P2】创建入口必须是唯一路径：只读校验 → 建载荷 → 更新单节点 → 原地刷新（excalidraw / cardspec 共用）')
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
  // 新建连线必须显式带关系类型（用户决策：每次新建强制选择，未选不落盘）。
  const created = await ops.addEdge({ source: 'x', target: 'y' }, 'e-new', { lineMode: 'curve' }, 'related')
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
  {
    // 顶部工具栏样式浮层的 10 个字段必须能经 writeConfig 完整往返。
    // 只查源码字面量会被字段白名单漂移蒙混：某天漏列 normalizeConfig 一项，UI 生效但永远不落盘。
    const { store, calls } = makeStore()
    const patch = {
      fontSize: 19,
      fontFamily: 'lxgw',
      lineHeight: 1.9,
      letterSpacing: 0.02,
      fontWeight: 500,
      headingSpacingRatio: 1.8,
      blockSpacing: 9,
      textColor: '#123456',
      backgroundColor: '#abcdef',
      paperBackground: 'ruled',
    }
    await store.writeConfig({ defaultEditorStyle: patch })
    const written = calls[0].defaultEditorStyle as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      assert.deepEqual(written[key], value, `编辑器样式字段 ${key} 必须真的写进配置`)
    }
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

  // 4b) 顶部工具栏折叠/展开：按钮常驻最右侧、偏好持久化、控件层只隐藏不卸载。
  // 断言的是具体字段与 DOM 顺序，不是「文件里出现过折叠两个字」——按钮挪到左侧、
  // 状态不落盘、折叠时把编辑器整条干掉都会在这里挂掉。
  const topToolbar = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/components/EditorTopToolbar.tsx', import.meta.url),
    'utf-8',
  )
  // 精确到带引号的完整属性：只查前缀会被 `...-toggle-legacy` 之类的改名蒙混过去
  assert.ok(topToolbar.includes('data-tm-editor-top-toolbar-toggle=""'), '顶部工具栏必须有折叠/展开按钮')
  assert.ok(topToolbar.includes('data-collapsed={collapsed'), '折叠态必须暴露可断言的状态属性')
  assert.ok(topToolbar.includes("'topomind_editor_top_toolbar_collapsed'"), '折叠偏好必须持久化到 localStorage')
  assert.ok(topToolbar.includes('useSyncExternalStore'), '折叠偏好必须在同窗口多编辑器实例间同步')
  assert.ok(topToolbar.includes('setCollapsed(!collapsedState)'), '点击按钮必须真的切换并广播折叠状态')
  assert.ok(topToolbar.includes('aria-expanded={!collapsed}'), '折叠按钮必须暴露 aria-expanded')
  assert.ok(topToolbar.includes('height: collapsed ? 0 : 36'), '折叠必须收成 0 高度（不留控件条），只留贴边界的展开按钮')
  assert.ok(topToolbar.includes('aria-hidden={collapsed || undefined}'), '折叠时控件层必须对辅助技术隐藏')
  const toolbarContentIndex = topToolbar.indexOf('tm-editor-top-toolbar__content')
  const toolbarToggleIndex = topToolbar.indexOf('data-tm-editor-top-toolbar-toggle=""')
  assert.ok(
    toolbarContentIndex > 0 && toolbarToggleIndex > toolbarContentIndex,
    '折叠按钮必须排在控件层之后（视觉上落在最右侧）',
  )
  const toolbarCollapseCss = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url),
    'utf-8',
  )
  assert.ok(toolbarCollapseCss.includes('transition: height 220ms'), '工具栏高度必须带过渡')
  assert.ok(
    toolbarCollapseCss.includes("[data-collapsed='true'] .tm-editor-top-toolbar__content"),
    '折叠态必须隐藏控件层而不是把它从 DOM 里删掉',
  )

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

  // 4c) 编辑器样式设置迁移到顶部工具栏：字段齐全、单一来源、右栏去重复、写盘接线。
  const stylePopover = await readFile(
    new URL('../src/features/documents/SmartDocumentEditor/components/EditorStylePopover.tsx', import.meta.url),
    'utf-8',
  )
  const migratedFields = [
    'fontSize', 'fontFamily', 'lineHeight', 'letterSpacing', 'fontWeight',
    'headingSpacingRatio', 'blockSpacing', 'textColor', 'backgroundColor', 'paperBackground',
  ]
  // 数字/颜色项是通用行组件，运行时才把 field 写成 data 属性（源码里是 {field}）；
  // 字体/纸张是静态 JSX，直接写死字面量。真实 DOM 的字段完整性由 GUI 用例再验一遍。
  for (const field of migratedFields) {
    assert.ok(
      stylePopover.includes(`field="${field}"`) || stylePopover.includes(`data-tm-editor-style-field="${field}"`),
      `顶部工具栏样式浮层必须提供 ${field} 设置项`,
    )
  }
  assert.ok(
    stylePopover.includes('createPortal(') && stylePopover.includes('document.body'),
    '样式浮层必须 portal 到 body（工具栏 overflow-hidden 会裁掉它）',
  )
  assert.ok(stylePopover.includes('data-tm-editor-style-preset={preset.label}'), '风格预设必须迁到浮层')
  assert.ok(stylePopover.includes('data-tm-editor-style-paper={option.value}'), '纸张背景必须迁到浮层')
  assert.ok(stylePopover.includes('onBlur={commit}'), '数字项必须失焦一次提交，不能逐字写盘')
  assert.ok(stylePopover.includes('EDITOR_STYLE_PRESETS'), '预设必须引用 domain 单一来源')

  const styleOptions = await readFile(
    new URL('../src/domain/style/editorStyleOptions.ts', import.meta.url), 'utf-8',
  )
  assert.ok(styleOptions.includes('export const EDITOR_STYLE_PRESETS'), '编辑器预设必须下沉到 domain')
  assert.ok(styleOptions.includes('export const PAPER_BACKGROUND_OPTIONS'), '纸张选项必须下沉到 domain')
  const rightPresets = await readFile(
    new URL('../src/features/right-panel/model/stylePresets.ts', import.meta.url), 'utf-8',
  )
  assert.ok(rightPresets.includes("export { EDITOR_STYLE_PRESETS }"), '右栏必须复用 domain 预设，不得再复制一份')
  assert.equal(rightPresets.includes('paperBackground:'), false, '右栏不得再残留编辑器预设的重复内容')
  const styleControls = await readFile(
    new URL('../src/features/right-panel/components/StyleTab/StyleControls.tsx', import.meta.url), 'utf-8',
  )
  assert.ok(styleControls.includes("export { PAPER_BACKGROUND_OPTIONS }"), '纸张选项必须只有一份定义')

  const styleSection = await readFile(
    new URL('../src/features/right-panel/components/StyleTab/StyleSection.tsx', import.meta.url), 'utf-8',
  )
  assert.equal(styleSection.includes("'文档编辑器'"), false, '右栏样式面板必须移除「文档编辑器」分区入口')
  assert.equal(styleSection.includes('EditorStylePanel'), false, '右栏不得再引用已删除的 EditorStylePanel')
  assert.equal(styleSection.includes("activeTab === 'editor'"), false, '右栏不得再渲染编辑器样式面板')

  assert.ok(topToolbar.includes('data-tm-editor-style-trigger=""'), '顶部工具栏必须有样式入口按钮')
  assert.ok(topToolbar.includes('onChange={onStyleChange}'), '样式浮层必须接到全局写盘回调')
  assert.ok(topToolbar.includes('editorStyle={editorStyle}'), '浮层必须接收当前全局样式')
  assert.ok(
    topToolbar.indexOf('data-tm-editor-style-trigger=""') < topToolbar.indexOf('data-tm-editor-top-toolbar-toggle=""'),
    '折叠按钮必须仍在最右侧，样式按钮排在它左边',
  )
  assert.ok(
    editorComponent.includes('editorStyle={defaultEditorStyle}') && editorComponent.includes('onStyleChange={commitEditorStyle}'),
    '编辑器必须把全局样式与写盘回调传给工具栏',
  )
  assert.ok(modelSource.includes('const commitEditorStyle = useCallback('), '必须复用同一条 writeConfig 链路，不另建存储')
  assert.ok(modelSource.includes('storage.writeConfig({ defaultEditorStyle: { ...current, ...patch } })'), '样式提交必须真写盘')
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

  // 摘要短路（2026-11-15 升级）：旧实现逐节点 existsSync + 完整 readGraphMeta
  // + 文档清单对账，在 1469 节点房间同步阻塞主进程数百毫秒。现在委托
  // room-summary-service：一次父目录 readdir 判物化、只数 nodes 分片、
  // hasDetail 只看 _docs 文件名。语义与 IO 次数由第 48 组内存文件系统真跑验证。
  const fileServiceSource = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  const summaryStart = fileServiceSource.indexOf('readRoomNodeSummaries: function')
  assert.ok(summaryStart > 0, '必须存在 readRoomNodeSummaries')
  const summaryBlock = fileServiceSource.slice(summaryStart, summaryStart + 1400)
  assert.ok(
    summaryBlock.includes('roomSummaryService.readRoomNodeSummaries(rootDir, roomPaths)'),
    '摘要读取必须委托轻量只读层，不得回到逐节点同步 IO'
  )
  assert.ok(fileServiceSource.includes('createRoomSummaryService({'), '轻量层必须用 IO 注入接线')
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

// P0 后续清理：createCard / createCardDir 整条死链、全部仅定义未调用的 _fs_ 函数、
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
    ['../electron/file-service.js', ['createCardDir', '_fs_createCardDir(', '_fs_deleteKbsDir(', '_fs_listAttachments(',
      '_fs_logsDir(', '_fs_isDirEmpty(', '_fs_isValidWorkDir(', '_fs_kbRelativePath(',
      '_fs_roomRelativePath(', '_fs_restoreTrashAttachment(', '_fs_listTrashAttachments(',
      'pathGuardLogsDir', 'pathGuardIsValidWorkDir']],
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
  assert.equal(rfOutput[0].type, 'knowledgeCard', '普通 / shape 节点仍统一为 knowledgeCard，容器不回归')
  const containerKindMeta = builder.buildMetaFromNodesEdges([
    {
      id: 'n-container', position: { x: 3, y: 4 }, width: 360, height: 240,
      data: { label: '白板', kind: 'container', container: { type: 'excalidraw', documentId: 'doc_a' } },
    },
  ], [], { zoom: 1, pan: { x: 0, y: 0 } })
  const rfContainerKind = builder.buildNodes('', normalizer.normalizeGraphMeta(containerKindMeta), {}, '')
  assert.equal(rfContainerKind[0].type, 'containerCard', '【P2】kind=container 必须映射到 containerCard')
  assert.equal(rfContainerKind[0].data.kind, 'container', '【P2】容器节点 kind 必须随 data 往返')
  assert.deepEqual(rfContainerKind[0].data.container, { type: 'excalidraw', documentId: 'doc_a' },
    '【P2】容器载荷指针必须与 nodeTypes 一起从磁盘恢复')

  // 容器载荷指针：与 kind / linkedDocuments 同一条端到端链，7 处白名单任一漏写都会暴露。
  // 静态计数专门防「只在类型里加字段、map 本体没写」这种历史踩过的坑。
  const containerWhitelist = [
    ['../src/types/graph.ts', 'container?: ContainerRef', 2],
    ['../src/domain/graph/model.ts', 'container?: ContainerRef', 2],
    ['../src/domain/graph/graphMapper.ts', 'container: normalizeContainerRef(', 2],
    ['../src/domain/graph/normalizeGraphMeta.ts', 'container: normalizeContainerRef(', 1],
    ['../src/core/storage/file.ts', 'container: normalizeContainerRef(', 2],
    ['../src/core/fs-backend.ts', 'container?: ContainerRef', 1],
    ['../src/hooks/useGraph/graphBuilder.ts', 'container: normalizeContainerRef(', 1],
  ] as const
  for (const [rel, needle, expected] of containerWhitelist) {
    const source = await readFile(new URL(rel, import.meta.url), 'utf-8')
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.equal((source.match(new RegExp(escaped, 'g')) ?? []).length, expected,
      `【容器节点】${rel} 必须真实透传 container（7 处白名单）`)
  }
  const containerModule = await bundle('../src/domain/graph/containerRef.ts')
  assert.equal(containerModule.normalizeContainerRef({ type: 'excalidraw' }), undefined,
    '【容器节点】缺少 documentId 的指针不得落盘')
  assert.equal(containerModule.normalizeContainerRef('excalidraw'), undefined,
    '【容器节点】非对象指针不得落盘')
  assert.deepEqual(containerModule.normalizeContainerRef({ type: '  excalidraw  ', documentId: ' doc_a ', evil: 1 }),
    { type: 'excalidraw', documentId: 'doc_a' },
    '【容器节点】归一化必须去空白、丢未知字段')

  const sampleContainer = { type: 'excalidraw', documentId: 'doc_0123456789abcdef0123456789abcdef' }
  const rfWithContainer = rfInput.map((node, i) => ({
    ...node,
    data: { ...node.data, container: i === 0 ? sampleContainer : undefined },
  }))
  const builtContainer = builder.buildMetaFromNodesEdges(rfWithContainer, [], { zoom: 1, pan: { x: 0, y: 0 } })
  assert.deepEqual(builtContainer.nodes['n-shape'].container, sampleContainer, 'buildMetaFromNodesEdges 必须写出 container')
  const normalizedContainer = normalizer.normalizeGraphMeta(builtContainer)
  assert.deepEqual(normalizedContainer.nodes['n-shape'].container, sampleContainer, 'normalizeGraphMeta 不得吞掉 container')
  const diskContainer = JSON.parse(JSON.stringify(fileAdapter.convertGraphToFSB(normalizedContainer, '')))
  assert.deepEqual(diskContainer.children['n-shape'].container, sampleContainer, 'container 必须真的出现在 _graph.json 序列化结果里')
  assert.equal(diskContainer.children['n-know'].container, undefined, '普通节点不得写入空 container（旧档零迁移）')
  const restoredContainer = normalizer.normalizeGraphMeta(fileAdapter.convertFSBToGraph(diskContainer, ''))
  assert.deepEqual(restoredContainer.nodes['n-shape'].container, sampleContainer, 'convertFSBToGraph 读入不得丢 container')
  const roomContainer = mapper.graphMetaToRoomGraph('', restoredContainer)
  assert.deepEqual(roomContainer.nodes['n-shape'].container, sampleContainer, 'graphMetaToRoomGraph 不得丢 container')
  const metaContainer = mapper.roomGraphToGraphMeta(roomContainer)
  assert.deepEqual(metaContainer.nodes['n-shape'].container, sampleContainer, 'roomGraphToGraphMeta 不得丢 container')
  const rfContainerBack = builder.buildNodes('', metaContainer, {}, '')
  assert.deepEqual(rfContainerBack.find((n: any) => n.id === 'n-shape').data.container, sampleContainer, 'buildNodes 必须把 container 放回 node.data')
  assert.equal(normalizer.normalizeGraphMeta({ nodes: { old: { id: 'old', card: { ref: 'old', name: '旧' }, kind: 'unknown-kind' } } }).nodes.old.kind, undefined,
    '【容器节点】未知 kind 必须降级为 knowledge，旧档零迁移')

  // 节点关联文档：与 kind 同一条端到端链，7 处白名单任一漏写都会在这里暴露。
  const linksModule = await bundle('../src/domain/graph/linkedDocuments.ts')
  const sampleLinks = [
    { docId: 'doc_a', cardRef: 'KB1/room/card-a', title: '关联 A' },
    { docId: 'doc_b', cardRef: 'KB2/room2/card-b', title: '关联 B' },
  ]
  const rfWithLinks = rfInput.map((node, i) => ({
    ...node,
    data: { ...node.data, linkedDocuments: i === 0 ? sampleLinks : undefined },
  }))
  const builtLinks = builder.buildMetaFromNodesEdges(rfWithLinks, [], { zoom: 1, pan: { x: 0, y: 0 } })
  assert.deepEqual(builtLinks.nodes['n-shape'].linkedDocuments, sampleLinks, 'buildMetaFromNodesEdges 必须写出 linkedDocuments')
  const normalizedLinks = normalizer.normalizeGraphMeta(builtLinks)
  assert.deepEqual(normalizedLinks.nodes['n-shape'].linkedDocuments, sampleLinks, 'normalizeGraphMeta 不得吞掉 linkedDocuments')
  const diskLinks = JSON.parse(JSON.stringify(fileAdapter.convertGraphToFSB(normalizedLinks, '')))
  assert.deepEqual(diskLinks.children['n-shape'].linkedDocuments, sampleLinks, 'linkedDocuments 必须真的出现在 _graph.json 序列化结果里')
  assert.equal(diskLinks.children['n-know'].linkedDocuments, undefined, '无关联的节点不得写入空数组（旧档零迁移）')
  const restoredLinks = normalizer.normalizeGraphMeta(fileAdapter.convertFSBToGraph(diskLinks, ''))
  assert.deepEqual(restoredLinks.nodes['n-shape'].linkedDocuments, sampleLinks, 'convertFSBToGraph 读入不得丢 linkedDocuments')
  const roomLinks = mapper.graphMetaToRoomGraph('', restoredLinks)
  assert.deepEqual(roomLinks.nodes['n-shape'].linkedDocuments, sampleLinks, 'graphMetaToRoomGraph 不得丢 linkedDocuments')
  const metaLinks = mapper.roomGraphToGraphMeta(roomLinks)
  assert.deepEqual(metaLinks.nodes['n-shape'].linkedDocuments, sampleLinks, 'roomGraphToGraphMeta 不得丢 linkedDocuments')
  const rfLinksBack = builder.buildNodes('', metaLinks, {}, '')
  assert.deepEqual(rfLinksBack.find((n: any) => n.id === 'n-shape').data.linkedDocuments, sampleLinks, 'buildNodes 必须把关联放回 node.data')
  const tooMany = Array.from({ length: 12 }, (_, i) => ({ docId: `doc_${i}`, cardRef: 'p', title: `T${i}` }))
  assert.equal(linksModule.normalizeLinkedDocuments(tooMany).length, 8, '关联上限必须是 8')
  assert.equal(linksModule.normalizeLinkedDocuments([{ docId: 'x' }, { docId: 'x' }]).length, 1, '关联必须按 docId 去重')
  assert.deepEqual(
    linksModule.normalizeLinkedDocuments([{ docId: 'x', cardRef: 'KB\\room', title: 'T', evil: 1 }]),
    [{ docId: 'x', cardRef: 'KB/room', title: 'T' }],
    '关联字段必须走白名单，未知字段不得落盘'
  )

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

// 节点关联已有文档：docId 全库主键 + 关联写库 + ownerCardPath 贯通。
// 与上面同理，只查源码字面量会被注释/类型声明蒙混，纯函数与主进程 service 一律真跑。
{
  const posix = (await import('node:path')).posix
  const idService = await import(
    new URL('../electron/services/document-id-service.js', import.meta.url).href
  ) as Record<string, any>

  // 移动文档：无冲突必须保留原 id；只有目标节点已存在的 id 才重分配。
  let seq = 0
  const gen = () => `doc_generated_${++seq}`
  assert.deepEqual(idService.planDocumentIdRemap(['doc_a', 'doc_b'], [], gen), {}, '跨节点移动无冲突时不得 idRemap')
  const remap = idService.planDocumentIdRemap(['doc_a', 'doc_b'], ['doc_b'], gen)
  assert.equal(remap.doc_a, undefined, '未冲突的 docId 必须原样保留')
  assert.ok(remap.doc_b && remap.doc_b !== 'doc_b', '冲突的 docId 必须重新分配')

  // 正文自描述 id：旧档在下次保存自动获得身份，且以文件名为准自愈。
  const body = { schema: 'topomind.smart-document', blocks: [] }
  const docPath = 'C:/kb/room/_docs/doc_abc.tdoc.json'
  assert.equal(idService.documentIdFromContentPath(docPath), 'doc_abc', '必须能从正文文件名反推 docId')
  assert.equal(idService.withSelfDescribingDocumentId(body, docPath).id, 'doc_abc', '写入正文必须补自描述 id')
  assert.equal(idService.withSelfDescribingDocumentId({ ...body, id: 'doc_old' }, docPath).id, 'doc_abc', '正文 id 与文件名不符时必须自愈')
  assert.equal(
    idService.withSelfDescribingDocumentId({ ...body, id: 'doc_abc' }, docPath).id,
    'doc_abc',
    '已有正确 id 时不得改变内容'
  )
  assert.equal(idService.normalizeLinkedDocuments(Array.from({ length: 12 }, (_, i) => ({ docId: `d${i}` }))).length, 8, '主进程关联上限必须是 8')
  assert.deepEqual(
    idService.normalizeLinkedDocuments([{ docId: 'x', cardRef: 'KB\\room', title: 'T', evil: 1 }]),
    [{ docId: 'x', cardRef: 'KB/room', title: 'T' }],
    '主进程关联字段必须走白名单'
  )

  // 内存文件系统真跑 documentIndexService：cardRef 直取 / 失效自愈 / 回收站 / 彻底失效。
  const dirs = new Map<string, string[]>()
  const fileContents = new Map<string, string>()
  const putFile = (p: string, value: unknown) => fileContents.set(p, JSON.stringify(value))
  const fsMock = {
    existsSync: (p: string) => fileContents.has(p) || dirs.has(p),
    readdirSync: (p: string) => (dirs.get(p) ?? []).map((name) => ({
      name,
      isDirectory: () => dirs.has(`${p}/${name}`),
    })),
    renameSync: (from: string, to: string) => {
      if (fileContents.has(from)) { fileContents.set(to, fileContents.get(from) as string); fileContents.delete(from) }
    },
  }
  const manifests: Record<string, any> = {
    'KB1/room/card-a': { doc_a: { id: 'doc_a', type: 'smart', title: '文档 A', path: 'doc_a.tdoc.json' } },
    'KB2/room2/card-b': { doc_b: { id: 'doc_b', type: 'smart', title: '文档 B', path: 'doc_b.tdoc.json' } },
    KB3: {
      doc_a: { id: 'doc_a', type: 'smart', title: '副本 A', path: 'doc_a.tdoc.json' },
      doc_x: { id: 'doc_x', type: 'smart', title: '副本 X', path: 'doc_x.tdoc.json' },
    },
  }
  const nodeNames: Record<string, any> = {
    'KB1/room': { 'card-a': { name: '节点 A' } },
    'KB2/room2': { 'card-b': { name: '节点 B' } },
  }
  dirs.set('/kb', ['KB1', 'KB2', 'KB3'])
  dirs.set('/kb/KB1', ['room'])
  dirs.set('/kb/KB1/room', ['card-a'])
  dirs.set('/kb/KB1/room/card-a', ['_docs'])
  dirs.set('/kb/KB1/room/card-a/_docs', ['tree.json', 'doc_a.tdoc.json'])
  dirs.set('/kb/KB2', ['room2'])
  dirs.set('/kb/KB2/room2', ['card-b'])
  dirs.set('/kb/KB2/room2/card-b', ['_docs'])
  dirs.set('/kb/KB2/room2/card-b/_docs', ['tree.json'])
  dirs.set('/kb/KB3', ['_docs'])
  dirs.set('/kb/KB3/_docs', ['tree.json', 'doc_a.tdoc.json', 'doc_x.tdoc.json'])
  for (const [cardPath] of Object.entries(manifests)) {
    const prefix = cardPath === 'KB3' ? '/kb/KB3' : `/kb/${cardPath}`
    putFile(`${prefix}/_docs/tree.json`, { version: 2, documents: manifests[cardPath] })
  }
  putFile('/kb/KB3/_docs/doc_a.tdoc.json', { schema: 'topomind.smart-document', id: 'doc_a', blocks: [] })
  putFile('/kb/KB3/_docs/doc_x.tdoc.json', { schema: 'topomind.smart-document', id: 'doc_x', blocks: [] })

  const service = idService.createDocumentIndexService({
    fs: fsMock,
    path: posix,
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath: (_root: string, rel: string) => (rel ? `/kb/${rel}` : '/kb'),
    readTopoManifest: (_root: string, cardPath: string) => (
      JSON.parse(fileContents.get(`/kb/${cardPath}/_docs/tree.json`) ?? '{}')
    ),
    readGraphMeta: (_root: string, parentPath: string) => ({ children: nodeNames[parentPath] ?? {} }),
    readJsonFile: (p: string) => JSON.parse(fileContents.get(p) ?? '{}'),
    writeJsonFile: (p: string, value: unknown) => putFile(p, value),
    listTrashItems: (_root: string, category: string) => (category === 'topo-documents' ? [
      {
        trashName: 'doc_c.tdoc.json',
        originalName: 'doc_c.tdoc.json',
        meta: { cardPath: 'KB1/room/card-a', topoDocumentItem: { id: 'doc_c', title: '已删除文档', type: 'smart' } },
      },
    ] : []),
  })
  const candidates = service.listDocumentCandidates('/root')
  assert.equal(candidates.length, 4, '全库候选必须包含所有节点的文档')
  assert.ok(candidates.some((c: any) => c.docId === 'doc_a' && c.breadcrumb.includes('节点 A')), '候选必须带所属节点面包屑')
  assert.equal(service.resolveDocumentById('/root', 'doc_a', 'KB1/room/card-a').status, 'ok', 'cardRef 命中时必须 O(1) 直取')
  assert.equal(service.resolveDocumentById('/root', 'doc_a', 'KB1/room/card-a').cardPath, 'KB1/room/card-a', '解析结果必须返回真实 cardPath')
  const healed = service.resolveDocumentById('/root', 'doc_b', 'OLD/wrong-path')
  assert.equal(healed.status, 'ok', 'cardRef 失效时必须按 docId 全库自愈')
  assert.equal(healed.cardPath, 'KB2/room2/card-b', '自愈必须回写正确的所属节点')
  assert.equal(service.resolveDocumentById('/root', 'doc_c').status, 'trashed', '删除进回收站的文档必须标记 trashed')
  assert.equal(service.resolveDocumentById('/root', 'doc_no_such').status, 'missing', '彻底删除的文档必须标记 missing')

  // 来源面包屑：末段必须换成可读节点名，不能 slice(0,-1) 把所属节点丢掉。
  assert.equal(idService.formatDocumentSource('KB1/room/card-a', '节点 A'), 'KB1 / room / 节点 A', '来源末段必须显示节点名而非 id')
  assert.equal(idService.formatDocumentSource('测试库/node-b', '节点 B'), '测试库 / 节点 B', '顶层节点来源必须保留所属节点')
  assert.equal(idService.formatDocumentSource('KB1', '测试库'), '测试库', '单段路径来源不得退化成根节点')
  assert.equal(idService.formatDocumentSource('__ROOT__', ''), '根节点', '工作区根节点来源')
  const hintResolved = service.resolveDocumentById('/root', 'doc_a', 'KB1/room/card-a')
  assert.equal(hintResolved.nodeName, '节点 A', 'cardRef 直取也必须解析出节点名（用于「在所属节点打开」）')
  assert.equal(hintResolved.sourceLabel, 'KB1 / room / 节点 A', 'cardRef 直取必须返回可读来源')
  assert.equal(healed.sourceLabel, 'KB2 / room2 / 节点 B', '全库自愈必须返回新所属节点的可读来源')
  assert.equal(healed.nodeName, '节点 B', '全库自愈必须返回新所属节点名')
  assert.equal(service.resolveDocumentById('/root', 'doc_c').sourceLabel, 'KB1 / room / 节点 A', '回收站文档也要显示原来源')
  assert.equal(service.resolveDocumentById('/root', 'doc_no_such').sourceLabel, '未知位置', '彻底失效文档的来源必须兜底')
  assert.ok(
    candidates.some((c: any) => c.docId === 'doc_b' && c.breadcrumb === 'KB2 / room2 / 节点 B'),
    '选择器候选面包屑与 resolve 的 sourceLabel 必须走同一格式规则'
  )

  // 导入 KB 副本：只重映射与现有库冲突的 id，并同步文件名 + 正文自描述 id。
  const importResult = service.remapImportedDocumentIds('/root', 'KB3', ['doc_a'])
  assert.equal(importResult.remappedCount, 1, '导入副本只应重映射冲突的 docId')
  const importedTree = JSON.parse(fileContents.get('/kb/KB3/_docs/tree.json') as string)
  assert.equal(importedTree.documents.doc_a, undefined, '冲突 id 必须从副本 tree.json 移除')
  assert.equal(importedTree.documents.doc_x.id, 'doc_x', '未冲突 id 必须原样保留')
  const newId = Object.keys(importedTree.documents).find((id) => id !== 'doc_x') as string
  assert.ok(newId && newId !== 'doc_a', '冲突 id 必须换成全新 id')
  assert.equal(importedTree.documents[newId].path, `${newId}.tdoc.json`, '副本文件名必须跟随新 id')
  const importedBody = JSON.parse(fileContents.get(`/kb/KB3/_docs/${newId}.tdoc.json`) as string)
  assert.equal(importedBody.id, newId, '副本正文自描述 id 必须跟随新 id')

  // 真跑「写库入口」：关联必须经由 graphMetaService 写进 v2 分片房间，
  // 只测序列化往返会放过「主进程入口偷偷改回直接读 _graph.json 索引」。
  const shardModule2 = await import(
    new URL('../electron/services/graph-meta-service.js', import.meta.url).href
  ) as Record<string, any>
  const graphFiles = new Map<string, string>()
  const graphDeps = {
    ensureDir: () => {},
    graphFilePath: (dir: string) => posix.join(dir, '_graph.json'),
    joinPath: (...parts: string[]) => posix.join(...parts),
    readJsonFile: (fp: string) => (graphFiles.has(fp) ? JSON.parse(graphFiles.get(fp) as string) : {}),
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath: (_root: string, rel: string) => posix.join('/kb', rel || ''),
    writeJsonFile: (fp: string, data: unknown) => { graphFiles.set(fp, JSON.stringify(data ?? {}, null, 2)) },
  }
  const graphStore = shardModule2.createGraphMetaService(graphDeps)
  graphStore.writeGraphMeta('/kb', 'room', {
    children: { n0: { name: '节点0' }, n1: { name: '节点1' } },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  })
  const writer = idService.createLinkedDocumentWriter({
    readGraphMeta: graphStore.readGraphMeta,
    writeGraphMeta: graphStore.writeGraphMeta,
  })
  const savedLinks = writer.updateNodeLinkedDocuments('/kb', 'room/n0', [
    { docId: 'doc_a', cardRef: 'KB1/x', title: 'A', evil: 1 },
  ])
  assert.deepEqual(savedLinks, [{ docId: 'doc_a', cardRef: 'KB1/x', title: 'A' }], '写库入口必须返回规范化后的关联')
  const backFromDisk = graphStore.readGraphMeta('/kb', 'room') as any
  assert.deepEqual(backFromDisk.children.n0.linkedDocuments, savedLinks, 'v2 分片房间必须真读到写回的关联')
  assert.equal(backFromDisk.children.n1.linkedDocuments, undefined, '未关联的节点不得被写上空数组')
  assert.equal(backFromDisk.children.n0.name, '节点0', '写关联不得丢掉节点其它字段')
  writer.updateNodeLinkedDocuments('/kb', 'room/n0', [])
  assert.equal((graphStore.readGraphMeta('/kb', 'room') as any).children.n0.linkedDocuments, undefined, '清空关联必须删除该键')
  assert.throws(() => writer.updateNodeLinkedDocuments('/kb', 'room/nope', []), /节点不存在/, '节点不存在必须抛错')

  // 主进程与渲染层的关键接线：只查字面量不够，配合上面的真跑一起守住。
  const docFileServiceSource = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  assert.ok(docFileServiceSource.includes('planDocumentIdRemap(subtreeIds, Object.keys(targetManifest.documents), newDocumentId)'), '跨节点移动必须只重映射冲突 id')
  assert.equal(docFileServiceSource.includes("idRemap[id] = 'doc_' + randomUUID()"), false, '不得再无条件 idRemap')
  assert.ok(docFileServiceSource.includes('withSelfDescribingDocumentId(normalizedContent, filePath'), '正文写入必须补自描述 id')
  assert.ok(docFileServiceSource.includes('updateNodeLinkedDocuments: function'), '主进程必须提供原子写入口')
  assert.ok(docFileServiceSource.includes('linkedDocumentWriter.updateNodeLinkedDocuments('), '主进程入口必须委托可注入的写库实现')
  assert.ok(docFileServiceSource.includes('readGraphMeta: graphMetaService.readGraphMeta'), '关联写库必须走逻辑读（v2 分片）')
  const kbServiceSource = await readFile(new URL('../electron/services/kb-service.js', import.meta.url), 'utf-8')
  assert.ok(kbServiceSource.includes('remapImportedDocumentIds(rootDir, destKbPath, existingIds)'), '导入 KB 必须重映射冲突 id')
  const preloadSource = await readFile(new URL('../electron/preload.js', import.meta.url), 'utf-8')
  const mainSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf-8')
  for (const channel of ['fs:listDocumentCandidates', 'fs:resolveDocumentById', 'fs:updateNodeLinkedDocuments']) {
    assert.ok(preloadSource.includes(`'${channel}'`), `${channel} 必须在 preload 白名单里`)
    assert.ok(mainSource.includes(`ipcMain.handle('${channel}'`), `${channel} 必须注册 IPC handler`)
  }

  // ownerCardPath 是本需求最大的事故风险：读写 / 草稿 / 附件 / 缓存键必须全部跟着文档走。
  const detailPanelSource = await readFile(new URL('../src/features/right-panel/components/DetailTab/DetailPanel.tsx', import.meta.url), 'utf-8')
  assert.ok(detailPanelSource.includes('nodePath: documentCardPath'), '右栏文档读写必须传 documentCardPath（不能传当前节点 nodePath）')
  assert.ok(detailPanelSource.includes('attachmentCardPath={documentCardPath}'), '附件路径必须指向文档所属节点')
  assert.ok(detailPanelSource.includes('joinRefs(documentCardPath, activeDocumentPath)'), '草稿/内容缓存键必须含文档所属节点')
  assert.ok(detailPanelSource.includes('syncHasDetail: detailView === \'own\''), '关联视图不得改动当前节点的自身文档标记')
  const linkDocumentsSource = await readFile(new URL('../src/features/right-panel/model/useDetailDocuments.ts', import.meta.url), 'utf-8')
  assert.ok(linkDocumentsSource.includes('allowedDocumentIds'), '关联视图的默认激活兜底必须限制在关联文档内')

  // 来源面包屑只有一份格式规则：不允许右栏再自己 slice(0,-1) 丢掉所属节点。
  const linkedListSource = await readFile(new URL('../src/features/right-panel/components/DetailTab/LinkedDocumentList.tsx', import.meta.url), 'utf-8')
  const resolvedHookSource = await readFile(new URL('../src/features/right-panel/model/useResolvedLinkedDocuments.ts', import.meta.url), 'utf-8')
  assert.equal(detailPanelSource.includes('function displaySource'), false, '右栏不得再自定义来源格式化')
  assert.equal(linkedListSource.includes('function displaySource'), false, '关联列表不得再自定义来源格式化')
  assert.equal(detailPanelSource.includes("parts.slice(0, -1).join(' / ')"), false, '来源不得丢掉末段所属节点')
  assert.ok(detailPanelSource.includes('activeLinked?.sourceLabel'), '右栏来源必须使用后端解析出的可读面包屑')
  assert.ok(linkedListSource.includes('link.sourceLabel'), '关联列表来源必须使用后端解析出的可读面包屑')
  assert.ok(resolvedHookSource.includes('sourceLabel: result.sourceLabel'), '解析结果必须透传 sourceLabel')
  assert.ok(resolvedHookSource.includes('nodeName: result.nodeName'), '解析结果必须透传 nodeName')
}

// 关联文档检索列表：节点内文档树路径（同名文档消歧）。
// 纯函数真跑 + 内存文件系统真跑全库扫描，确保字段真的从 tree.json 流到候选项，
// 而不是只在 FSBDocumentCandidate 里加一个返回类型。
{
  const posix = (await import('node:path')).posix
  const idService = await import(
    new URL('../electron/services/document-id-service.js', import.meta.url).href
  ) as Record<string, any>

  const documents: Record<string, any> = {
    doc_root: { id: 'doc_root', type: 'smart', title: '需求', parentId: null },
    doc_mid: { id: 'doc_mid', type: 'smart', title: '设计', parentId: 'doc_root' },
    doc_leaf1: { id: 'doc_leaf1', type: 'smart', title: '同名文档', parentId: 'doc_mid' },
    doc_leaf2: { id: 'doc_leaf2', type: 'smart', title: '同名文档', parentId: 'doc_root' },
    doc_top: { id: 'doc_top', type: 'smart', title: '顶层文档', parentId: null },
    doc_orphan: { id: 'doc_orphan', type: 'smart', title: '孤儿文档', parentId: 'doc_missing' },
    doc_cycle1: { id: 'doc_cycle1', type: 'smart', title: '环一', parentId: 'doc_cycle2' },
    doc_cycle2: { id: 'doc_cycle2', type: 'smart', title: '环二', parentId: 'doc_cycle1' },
    doc_self: { id: 'doc_self', type: 'smart', title: '自环文档', parentId: 'doc_self' },
  }
  assert.equal(
    idService.formatDocumentInNodePath(documents, 'doc_leaf1'), '需求 / 设计',
    '深层文档的节点内路径必须是完整祖先链（根 → 直接父级，不含自身）'
  )
  assert.equal(idService.formatDocumentInNodePath(documents, 'doc_mid'), '需求', '中间层文档路径只到直接父级')
  assert.equal(idService.formatDocumentInNodePath(documents, 'doc_leaf2'), '需求',
    '同名文档必须落在不同节点内路径上，选择器才能区分引用的是哪一篇')
  assert.notEqual(
    idService.formatDocumentInNodePath(documents, 'doc_leaf1'),
    idService.formatDocumentInNodePath(documents, 'doc_leaf2'),
    '两篇同名文档的节点内路径不得相同'
  )
  assert.equal(idService.formatDocumentInNodePath(documents, 'doc_top'), '', '顶层文档没有节点内路径（列表不显示多余一行）')
  assert.equal(idService.formatDocumentInNodePath(documents, 'doc_orphan'), '', '父节点缺失必须安全截断')
  assert.equal(idService.formatDocumentInNodePath(documents, 'doc_self'), '', '自环文档必须安全截断')
  assert.equal(idService.formatDocumentInNodePath(documents, 'doc_cycle1'), '环二', '互相成环必须截断且不死循环')
  assert.equal(idService.formatDocumentInNodePath({}, 'doc_any'), '', '空 manifest 必须返回空串')
  const deep: Record<string, any> = {}
  for (let i = 0; i < 80; i += 1) {
    deep[`d${i}`] = { title: `层${i}`, parentId: i === 0 ? null : `d${i - 1}` }
  }
  assert.equal(
    idService.formatDocumentInNodePath(deep, 'd79').split(' / ').length, 64,
    '超深文档树必须按上限截断，不得无限上溯'
  )

  // 真跑 createDocumentIndexService.listDocumentCandidates：字段必须真的过 IPC 边界。
  const dirs = new Map<string, string[]>()
  const files = new Map<string, string>()
  const put = (p: string, value: unknown) => files.set(p, JSON.stringify(value))
  dirs.set('/kb', ['KB1'])
  dirs.set('/kb/KB1', ['card'])
  dirs.set('/kb/KB1/card', ['_docs'])
  dirs.set('/kb/KB1/card/_docs', ['tree.json'])
  put('/kb/KB1/card/_docs/tree.json', { version: 2, documents })
  const fsMock = {
    existsSync: (p: string) => files.has(p) || dirs.has(p),
    readdirSync: (p: string) => (dirs.get(p) ?? []).map((name) => ({
      name, isDirectory: () => dirs.has(`${p}/${name}`),
    })),
  }
  const service = idService.createDocumentIndexService({
    fs: fsMock,
    path: posix,
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath: (_root: string, rel: string) => (rel ? `/kb/${rel}` : '/kb'),
    readTopoManifest: (_root: string, cardPath: string) => (
      JSON.parse(files.get(`/kb/${cardPath}/_docs/tree.json`) ?? '{}')
    ),
    readGraphMeta: () => ({ children: {} }),
    writeGraphMeta: () => {},
    readJsonFile: (p: string) => JSON.parse(files.get(p) ?? '{}'),
    writeJsonFile: (p: string, value: unknown) => put(p, value),
    listTrashItems: () => [],
  })
  const candidates = service.listDocumentCandidates('/root') as Array<Record<string, any>>
  const byId = new Map(candidates.map((item) => [String(item.docId), item]))
  assert.equal(candidates.length, Object.keys(documents).length, '全库扫描必须列出文档树里的每篇文档')
  assert.equal(byId.get('doc_leaf1')?.documentPathLabel, '需求 / 设计', '候选项必须携带节点内文档树路径')
  assert.equal(byId.get('doc_leaf2')?.documentPathLabel, '需求', '同名候选项各自携带自己的节点内路径')
  assert.equal(byId.get('doc_top')?.documentPathLabel, '', '顶层候选项的路径必须是空串而不是 undefined')
  assert.equal(byId.get('doc_leaf1')?.title, byId.get('doc_leaf2')?.title, '这两篇文档确实同名')
  assert.notEqual(
    byId.get('doc_leaf1')?.documentPathLabel, byId.get('doc_leaf2')?.documentPathLabel,
    '同名候选项必须能靠节点内路径区分'
  )
  assert.ok(byId.get('doc_leaf1')?.breadcrumb.includes('KB1'), '节点内路径不得顶替所属知识库 / 节点面包屑')

  // 接线守卫：字段不落到「展示 + 可检索」上，用户依旧没法区分同名文档。
  const idServiceSource = await readFile(new URL('../electron/services/document-id-service.js', import.meta.url), 'utf-8')
  const fsBackendSource = await readFile(new URL('../src/core/fs-backend.ts', import.meta.url), 'utf-8')
  assert.ok(
    idServiceSource.includes('documentPathLabel: formatDocumentInNodePath(documents, id)'),
    '全库扫描必须真算节点内路径，不得只在类型里声明字段'
  )
  assert.ok(
    fsBackendSource.includes('documentPathLabel: string'),
    'FSBDocumentCandidate 必须声明节点内路径字段（主进程与渲染层同一份 DTO）'
  )
  const pickerSources = [
    ['节点关联对话框', await readFile(new URL('../src/features/graph/components/LinkDocumentDialog.tsx', import.meta.url), 'utf-8')],
    ['编辑器文档引用选择器', await readFile(new URL('../src/features/documents/SmartDocumentEditor/components/DocumentLinkPicker.tsx', import.meta.url), 'utf-8')],
  ] as const
  // 统一树改造后：检索下沉到主进程派生索引，展示下沉到两个共用行组件；
  // 两个弹窗只负责接线，且不得再调全量候选接口。
  const unifiedSearchSrc = await readFile(new URL('../electron/services/unified-document-tree-service.js', import.meta.url), 'utf-8')
  const treeViewSrc = await readFile(new URL('../src/features/documents/unifiedTree/UnifiedTreeView.tsx', import.meta.url), 'utf-8')
  const candidateRowSrc = await readFile(new URL('../src/features/documents/unifiedTree/DocumentCandidateRow.tsx', import.meta.url), 'utf-8')
  assert.ok(unifiedSearchSrc.includes('entry.documentPathLabel'),
    '统一树搜索必须支持按节点内文档路径检索（不能只搜标题）')
  assert.ok(treeViewSrc.includes('candidate.documentPathLabel') && candidateRowSrc.includes('candidate.documentPathLabel'),
    '树行与搜索结果行都必须展示节点内文档路径以区分同名文档')
  for (const [name, source] of pickerSources) {
    assert.ok(!source.includes('listDocumentCandidates('),
      `${name}不得再全量加载候选列表（必须走统一树按需加载）`)
    assert.ok(source.includes('useUnifiedTree(') && source.includes('useUnifiedTreeSearch(')
      && source.includes('createStorageTreeDataSource('),
      `${name}必须接入按层加载 + 搜索的通用树底座`)
    assert.ok(source.includes('data-tm-link-document-path') || source.includes('data-tm-doc-link-path'),
      `${name}必须暴露节点内路径供 GUI 断言`)
  }
}

// 任务 #58：topo 正文序列化兼容性 —— columnList / column 等自定义块不得被剥掉。
// file-service.js 顶层 import 了 electron 的 shell，纯 Node 无法整模块加载；
// 因此真跑「写入路径唯一的变换函数 + 整体 JSON 往返」，再用源码断言守住三层透传接线。
// 真实写库入口的往返另由 scripts/verify-linked-documents-gui.mjs 在 Electron 里补跑。
{
  const docIdService = await import(
    new URL('../electron/services/document-id-service.js', import.meta.url).href
  ) as Record<string, any>
  const columnBody = {
    schema: 'topomind.smart-document',
    version: 1,
    title: '分栏文档',
    metadata: { customFlag: { nested: [1, 2, 3] } },
    blocks: [
      {
        type: 'columnList', id: 'cl-1', props: { gap: 8 }, children: [
          {
            type: 'column', id: 'c-1', props: { width: 0.5 }, children: [
              { type: 'paragraph', id: 'p-1', content: [{ type: 'text', text: '左栏', styles: {} }] },
            ],
          },
          { type: 'column', id: 'c-2', props: { width: 0.5 }, children: [] },
        ],
      },
    ],
  }
  const written = docIdService.withSelfDescribingDocumentId(
    columnBody, 'C:/kb/_docs/doc_cols.tdoc.json', ['.tdoc.json']
  )
  assert.equal(written.id, 'doc_cols', '正文必须补自描述 id')
  assert.deepEqual(written.blocks, columnBody.blocks, 'columnList / column 块不得被序列化剥掉')
  assert.deepEqual(written.metadata, columnBody.metadata, '未知顶层扩展字段必须整体保留')
  assert.deepEqual(JSON.parse(JSON.stringify(written)), written, '整体 JSON 往返不得丢字段')
  assert.equal(Object.prototype.hasOwnProperty.call(columnBody, 'id'), false, '补 id 不得就地改写入参')

  const idServiceSrc = await readFile(new URL('../electron/services/document-id-service.js', import.meta.url), 'utf-8')
  assert.ok(idServiceSrc.includes('return { ...content, id }'), '补 id 必须整体展开，不能按字段白名单重建正文')
  const fsSrc = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  assert.ok(
    fsSrc.includes('_fs_writeJsonFile(filePath, withSelfDescribingDocumentId(normalizedContent, filePath'),
    '主进程写正文必须整体透传 normalizedContent'
  )
  const storageServiceSrc = await readFile(new URL('../src/core/storage/service.ts', import.meta.url), 'utf-8')
  assert.ok(storageServiceSrc.includes('await backend.writeTopoDocument(cardPath, documentId, content)'), 'store 层不得筛选正文字段')
  const fileAdapterSrc = await readFile(new URL('../src/core/storage/file.ts', import.meta.url), 'utf-8')
  assert.ok(fileAdapterSrc.includes('await FSB.writeTopoDocument(requireRootDir(), cardPath, documentId, content)'), 'backend 层不得筛选正文字段')
}

// 文档双链：行内引用 spec / `[[` 触发 / 反向链接扫描 / docId 重映射闭环 / 右栏打开链路。
// 与「关联文档」那一节同理：纯函数与 createDocumentIndexService 一律真跑，
// 只在最后用源码断言守住跨进程接线，避免「只改了返回类型、没改写入口」蒙混过关。
{
  const idService = await import(
    new URL('../electron/services/document-id-service.js', import.meta.url).href
  ) as Record<string, any>
  const docLinkModel = await import(
    new URL('../src/features/documents/SmartDocumentEditor/docLinkModel.ts', import.meta.url).href
  ) as Record<string, any>

  // 渲染层与主进程必须是同一个行内类型名，否则反向链接会永远扫不到。
  assert.equal(idService.DOC_LINK_INLINE_TYPE, docLinkModel.DOC_LINK_INLINE_TYPE, '渲染层与主进程的 docLink 类型名必须一致')
  assert.equal(docLinkModel.DOC_LINK_TRIGGER_PATTERN.test('前文[['), true, '[[ 必须触发文档选择器')
  assert.equal(docLinkModel.DOC_LINK_TRIGGER_PATTERN.test('前文['), false, '单个 [ 不得触发')
  assert.equal(docLinkModel.DOC_LINK_TRIGGER_PATTERN.test('[[ 后面还有字'), false, '触发器必须锚定输入末尾')

  const ref = docLinkModel.createDocumentLinkInlineContent('doc_target', '  目标文档  ')
  assert.deepEqual(ref, { type: 'docLink', props: { docId: 'doc_target', title: '目标文档' } }, '引用只写稳定 docId + 显示标题快照')
  assert.equal(docLinkModel.isDocumentLinkInlineContent(ref), true, '必须能识别自身行内引用')
  assert.equal(docLinkModel.isDocumentLinkInlineContent({ type: 'text', text: 'x' }), false, '普通文本不得误判为引用')
  const linkHtml = docLinkModel.createDocumentLinkHtml('doc_target', 'A & B')
  assert.ok(linkHtml.includes('data-inline-content-type="docLink"'), '外部 HTML 必须带 inline content 类型')
  assert.ok(linkHtml.includes('data-doc-id="doc_target"'), '外部 HTML 必须带稳定 docId')
  assert.ok(linkHtml.includes('data-title="A &amp; B"'), '外部 HTML 标题必须转义')

  // 引用可能嵌在 columnList / 表格 / 任意嵌套层级，扫描必须递归而不是只看顶层 content。
  const nestedBody = {
    schema: 'topomind.smart-document',
    version: 1,
    id: 'doc_src',
    blocks: [
      { type: 'paragraph', content: [{ type: 'text', text: '前置' }, ref] },
      { type: 'columnList', children: [
        { type: 'column', children: [
          { type: 'paragraph', content: [ref, docLinkModel.createDocumentLinkInlineContent('doc_other', '其它')] },
        ] },
      ] },
    ],
    metadata: { keepMe: { nested: [1, 2, 3] } },
  }
  assert.equal(idService.countDocumentLinks(nestedBody, 'doc_target'), 2, '嵌套分栏里的引用必须被统计')
  assert.equal(idService.countDocumentLinks(nestedBody, 'doc_other'), 1, '同一文档引用不同目标要分别统计')
  assert.equal(idService.countDocumentLinks(nestedBody, 'doc_none'), 0, '无关 docId 不得命中')

  const mapped = idService.mapDocumentLinkIds(nestedBody, (id: string) => (id === 'doc_target' ? 'doc_new' : id))
  assert.equal(idService.countDocumentLinks(mapped, 'doc_new'), 2, '重映射必须改写所有命中引用')
  assert.equal(idService.countDocumentLinks(mapped, 'doc_target'), 0, '重映射后旧 id 不得残留')
  assert.equal(idService.countDocumentLinks(mapped, 'doc_other'), 1, '未命中的引用必须原样保留')
  assert.deepEqual(mapped.metadata, nestedBody.metadata, '重映射必须整体展开正文，不得按字段白名单重建')
  assert.equal(idService.mapDocumentLinkIds(nestedBody, (id: string) => id) === nestedBody, true, '无改动必须返回原引用，避免无谓写盘')

  // 关系索引构建靠一次遍历拿到全部出链目标（不能对每个目标各扫一遍正文）。
  const targets = idService.collectDocumentLinkTargets(nestedBody)
  assert.deepEqual(
    { doc_target: targets.doc_target, doc_other: targets.doc_other },
    {
      doc_target: { count: 2, title: '目标文档' },
      doc_other: { count: 1, title: '其它' },
    },
    'collectDocumentLinkTargets 必须一次遍历给出目标次数与标题快照',
  )
  assert.equal(idService.collectDocumentLinkTargets(nestedBody).doc_none, undefined, '不存在的目标不得进索引')

  // 正文 normalize 不得吞掉自定义行内内容（历史上「只在返回类型加字段」踩过坑）。
  const normalizedDocLink = normalizeSmartDocumentContent(
    { schema: 'topomind.smart-document', version: 1, blocks: nestedBody.blocks },
    '标题',
  )
  // normalize 会给块补 children: undefined，不做整体深比较；只断言引用真的活着。
  assert.equal(idService.countDocumentLinks(normalizedDocLink, 'doc_target'), 2, 'normalizeSmartDocumentContent 不得剥掉 docLink 行内引用')
  assert.equal(idService.countDocumentLinks(normalizedDocLink, 'doc_other'), 1, 'normalize 不得改写引用目标')

  // 内存文件系统真跑反向链接 + idRemap 闭环。
  const posix = (await import('node:path')).posix
  const dirs = new Map<string, string[]>()
  const fileContents = new Map<string, string>()
  const graphs: Record<string, any> = {
    KB1: {
      children: {
        'card-a': {
          name: '节点 A',
          linkedDocuments: [{ docId: 'doc_target', cardRef: 'KB1/card-a', title: '目标文档' }],
        },
      },
      edges: [],
    },
  }
  const statVersions = new Map<string, number>()
  let statSeq = 0
  const put = (p: string, value: unknown) => {
    fileContents.set(p, JSON.stringify(value))
    statVersions.set(p, ++statSeq)
  }
  const fsMock = {
    existsSync: (p: string) => fileContents.has(p) || dirs.has(p),
    readdirSync: (p: string) => (dirs.get(p) ?? []).map((name) => ({
      name,
      isDirectory: () => dirs.has(`${p}/${name}`),
    })),
    // 关系索引用 mtimeMs/size/ctimeMs 做签名；put 一次视为一次真实写盘。
    statSync: (p: string) => {
      const body = fileContents.get(p)
      if (body === undefined) throw new Error('ENOENT: ' + p)
      const version = statVersions.get(p) ?? 0
      return { mtimeMs: version, ctimeMs: version, size: body.length }
    },
  }
  dirs.set('/kb', ['KB1'])
  dirs.set('/kb/KB1', ['_graph.json', 'card-a'])
  dirs.set('/kb/KB1/card-a', ['_docs'])
  dirs.set('/kb/KB1/card-a/_docs', ['tree.json', 'doc_src.tdoc.json', 'doc_target.tdoc.json', 'doc_other.tdoc.json'])
  put('/kb/KB1/_graph.json', { version: 2, zoom: 1, pan: { x: 0, y: 0 } })
  put('/kb/KB1/card-a/_docs/tree.json', {
    version: 2,
    documents: {
      doc_src: { id: 'doc_src', type: 'smart', title: '引用者', path: 'doc_src.tdoc.json' },
      doc_target: { id: 'doc_target', type: 'smart', title: '目标文档', path: 'doc_target.tdoc.json' },
      doc_other: { id: 'doc_other', type: 'smart', title: '另一篇', path: 'doc_other.tdoc.json' },
    },
  })
  put('/kb/KB1/card-a/_docs/doc_src.tdoc.json', nestedBody)
  const targetBody = { schema: 'topomind.smart-document', id: 'doc_target', blocks: [{ type: 'paragraph', content: [ref] }] }
  const otherBody = {
    schema: 'topomind.smart-document', id: 'doc_other',
    blocks: [{ type: 'paragraph', content: [docLinkModel.createDocumentLinkInlineContent('doc_target', '目标文档')] }],
  }
  put('/kb/KB1/card-a/_docs/doc_target.tdoc.json', targetBody)
  put('/kb/KB1/card-a/_docs/doc_other.tdoc.json', otherBody)

  const service = idService.createDocumentIndexService({
    fs: fsMock,
    path: posix,
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath: (_root: string, rel: string) => (rel ? `/kb/${rel}` : '/kb'),
    readTopoManifest: (_root: string, cardPath: string) => (
      JSON.parse(fileContents.get(`/kb/${cardPath}/_docs/tree.json`) ?? '{}')
    ),
    readGraphMeta: (_root: string, roomPath: string) => graphs[roomPath] ?? { children: {} },
    writeGraphMeta: (_root: string, roomPath: string, meta: unknown) => { graphs[roomPath] = meta },
    readJsonFile: (p: string) => JSON.parse(fileContents.get(p) ?? '{}'),
    writeJsonFile: (p: string, value: unknown) => put(p, value),
    statSync: fsMock.statSync,
    listTrashItems: () => [],
  })

  const backlinks = service.listDocumentBacklinks('/root', 'doc_target')
  assert.equal(backlinks.length, 2, '反向链接只列引用者，不含目标文档自身')
  assert.equal(backlinks.reduce((sum: number, item: any) => sum + item.references, 0), 3, '引用次数必须按出现次数累计')
  assert.equal(backlinks[0].docId, 'doc_src', '引用者必须按文档维度去重')
  assert.equal(backlinks[0].references, 2, '同一文档多处引用只出一条，带次数')
  assert.equal(backlinks[0].breadcrumb, 'KB1 / 节点 A', '反向链接面包屑必须走 formatDocumentSource（末段换成节点名）')
  assert.equal(service.listDocumentBacklinks('/root', 'doc_no_such').length, 0, '无引用时返回空列表')
  assert.deepEqual(service.listDocumentBacklinks('/root', ''), [], '空 docId 不得触发全库扫描')

  // 历史上 moveTopoDocumentToCard 只返回 idRemap 不消费，引用一次移动全部失效。
  const rewrite = service.rewriteDocumentIdReferences('/root', { doc_target: 'doc_renamed' })
  assert.equal(rewrite.linkedDocuments, 1, '节点 linkedDocuments 必须跟随 idRemap 改写')
  assert.equal(rewrite.documents, 3, '三篇含引用的正文都必须回写')
  assert.equal(graphs.KB1.children['card-a'].linkedDocuments[0].docId, 'doc_renamed', '关联记录的 docId 必须换成新 id')
  assert.equal(graphs.KB1.children['card-a'].linkedDocuments[0].title, '目标文档', '改写关联不得丢掉其它字段')
  assert.equal(graphs.KB1.children['card-a'].name, '节点 A', '改写关联不得丢掉节点其它字段')
  const srcAfter = JSON.parse(fileContents.get('/kb/KB1/card-a/_docs/doc_src.tdoc.json') as string)
  assert.equal(idService.countDocumentLinks(srcAfter, 'doc_renamed'), 2, '正文引用必须跟随 idRemap 改写')
  assert.deepEqual(srcAfter.metadata, nestedBody.metadata, '正文改写不得丢未知顶层字段')
  assert.deepEqual(service.rewriteDocumentIdReferences('/root', {}), { linkedDocuments: 0, documents: 0 }, '空 remap 不得写盘')

  // ---- 关系索引真跑：首次全扫 → 二次命中 → 增量重解析 → 强制重建 → 损坏自愈 ----
  // 独立 fixture，避免与上面的 idRemap 场景相互干扰。
  const relDirs = new Map<string, string[]>()
  const relFiles = new Map<string, string>()
  const relVersions = new Map<string, number>()
  let relSeq = 1000
  const relPut = (p: string, value: unknown) => {
    relFiles.set(p, JSON.stringify(value))
    relVersions.set(p, ++relSeq)
  }
  const relStat = (p: string) => {
    const body = relFiles.get(p)
    if (body === undefined) throw new Error('ENOENT: ' + p)
    const version = relVersions.get(p) ?? 0
    return { mtimeMs: version, ctimeMs: version, size: body.length }
  }
  const relFs = {
    existsSync: (p: string) => relFiles.has(p) || relDirs.has(p),
    readdirSync: (p: string) => (relDirs.get(p) ?? []).map((name) => ({
      name, isDirectory: () => relDirs.has(`${p}/${name}`),
    })),
    statSync: relStat,
  }
  const relGraphs: Record<string, any> = {
    Alpha: { children: { 'card-x': { name: '节点 X' } }, edges: [] },
  }
  relDirs.set('/kb', ['Alpha'])
  relDirs.set('/kb/Alpha', ['_graph.json', 'card-x'])
  relDirs.set('/kb/Alpha/card-x', ['_docs'])
  relDirs.set('/kb/Alpha/card-x/_docs', ['tree.json', 'doc_p.tdoc.json', 'doc_q.tdoc.json', 'doc_r.tdoc.json'])
  relPut('/kb/Alpha/_graph.json', { version: 2, zoom: 1, pan: { x: 0, y: 0 } })
  const relManifest = {
    version: 2,
    documents: {
      doc_p: { id: 'doc_p', type: 'smart', title: 'P 文档', path: 'doc_p.tdoc.json' },
      doc_q: { id: 'doc_q', type: 'smart', title: 'Q 文档', path: 'doc_q.tdoc.json' },
      doc_r: { id: 'doc_r', type: 'smart', title: 'R 文档', path: 'doc_r.tdoc.json' },
    },
  }
  const relDocsDir = '/kb/Alpha/card-x/_docs'
  relPut(`${relDocsDir}/tree.json`, relManifest)
  const pBody = (withExtra: boolean) => ({
    schema: 'topomind.smart-document',
    id: 'doc_p',
    blocks: [{ type: 'paragraph', content: [
      docLinkModel.createDocumentLinkInlineContent('doc_q', 'Q 文档'),
      docLinkModel.createDocumentLinkInlineContent('doc_q', 'Q 文档'),
      docLinkModel.createDocumentLinkInlineContent('doc_gone', '已删除的文档'),
      ...(withExtra ? [docLinkModel.createDocumentLinkInlineContent('doc_r', 'R 文档')] : []),
    ] }],
  })
  relPut(`${relDocsDir}/doc_p.tdoc.json`, pBody(false))
  relPut(`${relDocsDir}/doc_q.tdoc.json`, {
    schema: 'topomind.smart-document', id: 'doc_q',
    blocks: [{ type: 'paragraph', content: [docLinkModel.createDocumentLinkInlineContent('doc_r', 'R 文档')] }],
  })
  relPut(`${relDocsDir}/doc_r.tdoc.json`, { schema: 'topomind.smart-document', id: 'doc_r', blocks: [] })

  const makeRelService = (
    statSync: (p: string) => any = relStat,
    writer: (p: string, value: unknown) => void = relPut,
  ) => idService.createDocumentIndexService({
    fs: relFs,
    path: posix,
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath: (_root: string, rel: string) => (rel ? `/kb/${rel}` : '/kb'),
    readTopoManifest: () => relManifest,
    readGraphMeta: (_root: string, roomPath: string) => relGraphs[roomPath] ?? { children: {} },
    writeGraphMeta: () => {},
    readJsonFile: (p: string) => JSON.parse(relFiles.get(p) ?? '{}'),
    writeJsonFile: writer,
    statSync,
    listTrashItems: () => [],
  })
  const relService = makeRelService()

  const first = relService.listDocumentRelations('/root', 'doc_q')
  assert.equal(first.parsed, 3, '首次查询必须真读并解析 3 篇正文以构建关系索引')
  assert.equal(first.indexed, 3, '索引必须覆盖全部 3 篇文档')
  assert.equal(relFiles.has('/root/.topomind/doc-relations.json'), true, '关系索引必须落盘到工作区根 .topomind/')
  assert.equal(first.incoming.length, 1, 'doc_q 的入链只应来自 doc_p')
  assert.equal(first.incoming[0].docId, 'doc_p', '入链条目必须指向引用者')
  assert.equal(first.incoming[0].references, 2, '同一文档两处引用要累计')
  assert.equal(first.incoming[0].status, 'ok', '入链条目状态必须为 ok')
  assert.equal(first.outgoing.length, 1, 'doc_q 的出链只应指向 doc_r')
  assert.equal(first.outgoing[0].docId, 'doc_r', '出链必须取当前文档正文里的目标')
  assert.equal(first.outgoing[0].breadcrumb, 'Alpha / 节点 X', '出链面包屑必须走主进程统一格式')

  const second = relService.listDocumentRelations('/root', 'doc_q')
  assert.equal(second.parsed, 0, '二次查询必须完全命中关系索引，不再读任何正文（性能回归防线）')
  assert.equal(second.indexed, 3, '命中索引时数据仍完整')
  assert.equal(second.incoming[0].references, 2, '命中索引不得丢失引用次数')

  // 只改一篇正文：签名自愈应只重解析那一篇，其余继续复用索引。
  relPut(`${relDocsDir}/doc_p.tdoc.json`, pBody(true))
  const incremental = relService.listDocumentRelations('/root', 'doc_r')
  assert.equal(incremental.parsed, 1, '只有签名变化的那一篇才重新读正文')
  assert.equal(incremental.incoming.length, 2, '新增引用必须立刻出现在入链里（doc_q 与 doc_p）')

  const forced = relService.listDocumentRelations('/root', 'doc_q', { force: true })
  assert.equal(forced.parsed, 3, 'force=true 必须忽略缓存全量重建')

  const gone = relService.listDocumentRelations('/root', 'doc_p').outgoing
    .find((item: any) => item.docId === 'doc_gone')
  assert.equal(gone?.status, 'missing', '引用了不存在文档时必须标 missing')
  assert.equal(gone?.title, '已删除的文档', 'missing 条目要用 chip 上的标题快照')
  assert.equal(gone?.references, 1, 'missing 条目仍要保留引用次数')

  // 索引损坏 / 版本不符必须自动重建，不能静默返回空关系。
  relPut('/root/.topomind/doc-relations.json', { version: 999, rooms: {} })
  const recovered = relService.listDocumentRelations('/root', 'doc_q')
  assert.equal(recovered.parsed, 3, '索引损坏必须自动全量重建')
  assert.equal(recovered.incoming.length, 1, '重建后关系必须完整')

  // 反向验证：签名恒变（等价于「不做缓存」）时每次都必须全量重解析，
  // 证明上面 parsed=0 的断言确实测到了索引命中，而不是根本没扫到文档。
  let unstableSeq = 50000
  const unstable = makeRelService((p: string) => {
    const body = relFiles.get(p)
    if (body === undefined) throw new Error('ENOENT: ' + p)
    unstableSeq += 1
    return { mtimeMs: unstableSeq, ctimeMs: unstableSeq, size: body.length }
  })
  unstable.listDocumentRelations('/root', 'doc_q')
  const unstableSecond = unstable.listDocumentRelations('/root', 'doc_q')
  assert.equal(unstableSecond.parsed, 3, '反向验证：签名恒变时每次都必须全量读正文')

  // 索引只是派生缓存：写盘失败不得阻断本次查询。
  const noWriteService = makeRelService(relStat, () => { throw new Error('EACCES: index read-only') })
  const resilient = noWriteService.listDocumentRelations('/root', 'doc_q', { force: true })
  assert.equal(resilient.parsed, 3, '索引写盘失败时仍必须真跑解析')
  assert.equal(resilient.incoming.length, 1, '索引写盘失败时查询仍必须返回正确关系')

  // 跨进程接线：白名单 / IPC / 存储四层 / 编辑器注册 / 右栏打开 / 引用关系页。
  const preloadSource = await readFile(new URL('../electron/preload.js', import.meta.url), 'utf-8')
  const mainSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf-8')
  const fsSource = await readFile(new URL('../electron/file-service.js', import.meta.url), 'utf-8')
  const fsbSource = await readFile(new URL('../src/core/fs-backend.ts', import.meta.url), 'utf-8')
  const fileAdapterSource = await readFile(new URL('../src/core/storage/file.ts', import.meta.url), 'utf-8')
  const storeSource = await readFile(new URL('../src/core/storage/service.ts', import.meta.url), 'utf-8')
  const typesSource = await readFile(new URL('../src/core/storage/types.ts', import.meta.url), 'utf-8')
  const schemaSource = await readFile(new URL('../src/features/documents/SmartDocumentEditor/smartDocumentSchema.tsx', import.meta.url), 'utf-8')
  const editorModelSource = await readFile(new URL('../src/features/documents/SmartDocumentEditor/model/useSmartDocumentEditorModel.ts', import.meta.url), 'utf-8')
  const pasteSource = await readFile(new URL('../src/features/documents/SmartDocumentEditor/mathPaste.ts', import.meta.url), 'utf-8')
  const registrySource = await readFile(new URL('../src/features/documents/services/documentEditorRegistry.tsx', import.meta.url), 'utf-8')
  const hostSource = await readFile(new URL('../src/features/documents/DocumentEditorHost.tsx', import.meta.url), 'utf-8')
  const workspaceLayoutSource = await readFile(new URL('../src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx', import.meta.url), 'utf-8')
  const detailPanelSource = await readFile(new URL('../src/features/right-panel/components/DetailTab/DetailPanel.tsx', import.meta.url), 'utf-8')
  const idSource = await readFile(new URL('../electron/services/document-id-service.js', import.meta.url), 'utf-8')
  const relationPanelSource = await readFile(new URL('../src/features/right-panel/components/DetailTab/DocumentRelationPanel.tsx', import.meta.url), 'utf-8')
  const relationHookSource = await readFile(new URL('../src/features/right-panel/model/useDocumentRelations.ts', import.meta.url), 'utf-8')

  assert.ok(preloadSource.includes("'fs:listDocumentBacklinks'"), '反向链接通道必须在 preload 白名单里')
  assert.ok(mainSource.includes("ipcMain.handle('fs:listDocumentBacklinks'"), '反向链接通道必须注册 IPC handler')
  assert.ok(fsSource.includes('documentIndexService.listDocumentBacklinks('), '主进程入口必须委托可注入的扫描服务')
  assert.ok(fsSource.includes('documentIndexService.rewriteDocumentIdReferences(rootDir, idRemap)'), '跨节点移动冲突改名时必须闭环改写引用')
  assert.ok(fsbSource.includes("'fs:listDocumentBacklinks'"), 'fs-backend 必须发出反向链接 IPC')
  assert.ok(fileAdapterSource.includes('FSB.listDocumentBacklinks(requireRootDir(), docId)'), 'file backend 必须注入 rootDir')
  assert.ok(storeSource.includes('backend.listDocumentBacklinks(docId)'), 'store 层必须透传反向链接调用')
  assert.ok(typesSource.includes('listDocumentBacklinks: (docId: string)'), 'StorageBackend 契约必须声明反向链接')
  assert.ok(schemaSource.includes('docLink: DocumentLink'), 'smartDocumentSchema 必须注册 docLink 行内 spec')
  assert.ok(editorModelSource.includes('inlineMathInputRuleExtension, docLinkInputRuleExtension'), '[[ InputRule 必须真的挂到编辑器')
  assert.ok(pasteSource.includes("'data-doc-id'") && pasteSource.includes("'data-title'"), '粘贴消毒白名单必须放行 docLink 属性')
  assert.ok(registrySource.includes('onOpenDocumentByDocId={onOpenDocumentByDocId}'), 'adapter 必须把打开回调透传给编辑器')
  assert.ok(hostSource.includes('onOpenDocumentByDocId,'), 'DocumentEditorHost 不得再把打开回调吞掉')
  assert.equal(hostSource.includes('onOpenDetailDocumentLink'), false, '历史死链 onOpenDetailDocumentLink 必须清除')
  assert.ok(workspaceLayoutSource.includes("'backlinks'"), '右栏必须有引用关系侧栏页')
  assert.ok(detailPanelSource.includes('backlinksTabContent={backlinksTabContent}'), '右栏必须挂载引用关系面板')
  assert.ok(detailPanelSource.includes('storage.resolveDocumentById(id)'), '点击引用必须按 docId 反查真实归属，不信任 chip 缓存')
  assert.ok(detailPanelSource.includes('await flushDocumentSave()'), '跨文档跳转前必须先落盘当前草稿')
  assert.ok(detailPanelSource.includes('onOpenDocumentByDocId={(docId: string)'), '右栏必须把按 docId 打开接到编辑器链路')

  // 关系索引 / 出入链优化：必须真有落盘索引与签名自愈，不能退回每次全库读正文。
  assert.ok(idSource.includes('export function collectDocumentLinkTargets('), '必须一次遍历提取全部出链目标')
  assert.ok(idSource.includes('const saveRelationsIndex = '), '关系索引必须落盘复用')
  assert.ok(idSource.includes('previous.signature !== bodySignature'), '必须按文件签名只重解析变化过的正文')
  assert.ok(idSource.includes('const listDocumentBacklinks = (rootDir, docId) => listDocumentRelations('), '兼容入口必须委托统一查询，不得再全库读正文')
  assert.ok(idSource.includes('const listDocumentRelations = '), '必须有出入链统一查询')
  assert.ok(fsSource.includes('statSync: function(filePath)'), '主进程必须注入 statSync 供索引计算签名')
  assert.ok(fsSource.includes('documentIndexService.listDocumentRelations('), 'file-service 必须暴露出入链统一查询')
  assert.ok(preloadSource.includes("'fs:listDocumentRelations'"), 'fs:listDocumentRelations 必须在 preload 白名单里')
  assert.ok(mainSource.includes("ipcMain.handle('fs:listDocumentRelations'"), '新通道必须注册 IPC handler')
  assert.ok(fsbSource.includes("'fs:listDocumentRelations'"), 'fs-backend 必须发出新 IPC')
  assert.ok(fileAdapterSource.includes('FSB.listDocumentRelations(requireRootDir(), docId, force)'), 'file backend 必须注入 rootDir 与 force')
  assert.ok(storeSource.includes('backend.listDocumentRelations(docId, force)'), 'store 层必须透传统一查询')
  assert.ok(typesSource.includes('listDocumentRelations: (docId: string, force?: boolean)'), 'StorageBackend 契约必须声明统一查询')

  // 上下两栏：都要有独立容器、独立空态、独立 data 属性供 GUI 断言。
  assert.ok(relationPanelSource.includes('data-tm-relations-incoming'), '必须有「引用了本页」上栏')
  assert.ok(relationPanelSource.includes('data-tm-relations-outgoing'), '必须有「本页引用了」下栏')
  assert.ok(relationPanelSource.includes('data-tm-backlinks-panel=""'), '必须保留兼容的面板根标识')
  assert.ok(relationPanelSource.includes("title=\"引用了本页\"") && relationPanelSource.includes("title=\"本页引用了\""), '两栏标题必须语义清晰、避免「被引用」歧义')
  assert.ok(relationPanelSource.includes('item.status === \'missing\''), '出链目标已删除时必须禁用跳转')
  assert.ok(relationHookSource.includes('storage.listDocumentRelations(docId)'), '两栏必须共用一次 IPC 查询')
  assert.ok(detailPanelSource.includes('useDocumentRelations('), '右栏必须挂到新的关系 hook')
  assert.equal(detailPanelSource.includes('useDocumentBacklinks('), false, '旧的逐篇全扫 hook 必须清除')
  assert.equal(workspaceLayoutSource.includes("'被引用'"), false, '侧栏标题不得再用有歧义的「被引用」')
}

// --- 公式渲染：中文 / 全角字符不得再刷 KaTeX unicodeTextInMathMode 警告 ---
// 这些是磁盘真实笔记里出现过的公式源码：既有合法写法（\text{}、全角标点、中文
// 当变量名），也有粘贴时把中文正文误判成 $...$ 公式的产物。它们已经落盘，
// 只能靠渲染前规范化解决，改写入口救不回来。
{
  const realMathSamples: Array<[string, boolean]> = [
    ['SCR = \\frac{\\text{符合苏格拉底引导原则的轮数}}{\\text{总回复轮数}}', true],
    ['（R = k_1 \\cdot \\lambda / NA）', false],
    ['量比=当日每分钟平均成交量/过去5日每分钟平均成交量', true],
    ['P（B／A）＝P（AB）／P（A）＝（1／4）／（3／4）＝1／3', false],
    ['2^{树深度 - 1}', false],
    ['grid[i][j][k] = min(grid[i][k][k - 1] + grid[k][j][k - 1]， grid[i][j][k - 1])', false],
    ['长 * 宽', false],
    ['O(m + n)）', false],
    ['拆解i - j的最大乘积 * 拆解j的最大乘积', false],
    ['（y+z）', false],
    ['HOME/src/目录下的所有文件复制到远程主机的', false],
    ['n，n代表一个数字，0为执行的文件名，1为第一个参数，2为第二个参数，以此类推...大于等于10的参数，需要加大括号，如', false],
    ['((1 + 2))|计算 1+2 赋值给 num，使用 bash 独有的 ', false],
    ['|检测字符串是否为空，不为空返回true|[ ', false],
  ]

  const originalWarn = console.warn
  const capturedWarnings: string[] = []
  console.warn = (...args: unknown[]): void => {
    capturedWarnings.push(args.map(String).join(' '))
  }
  try {
    for (const [source, displayMode] of realMathSamples) {
      renderMathToHtml(source, displayMode)
    }
  } finally {
    console.warn = originalWarn
  }
  const unicodeWarnings = capturedWarnings.filter((line) => line.includes('unicodeTextInMathMode'))
  assert.equal(
    unicodeWarnings.length,
    0,
    `真实公式渲染不得再逐字刷 unicodeTextInMathMode 警告: ${unicodeWarnings[0] ?? ''}`,
  )
  assert.equal(
    capturedWarnings.length,
    0,
    `真实公式渲染不得产生任何 KaTeX 严格警告: ${capturedWarnings[0] ?? ''}`,
  )

  // 规范化语义：全角转半角保住公式结构、裸中文整体进 text mode、已有 \text 不二次包装。
  assert.equal(normalizeMathSource('P（B／A）＝P（AB）'), 'P(B/A)=P(AB)', '全角标点必须映射成半角等价形式')
  assert.equal(normalizeMathSource('长 * 宽'), '\\text{长} * \\text{宽}', '裸中文必须包进 \\text{}')
  assert.equal(normalizeMathSource('2^{树深度 - 1}'), '2^{\\text{树深度} - 1}', '上标里的中文变量名不得破坏 ^ 结构')
  assert.equal(
    normalizeMathSource('\\text{符合苏格拉底引导原则的轮数}'),
    '\\text{符合苏格拉底引导原则的轮数}',
    '已有的 text-mode 分组必须原样保留',
  )
  assert.equal(
    normalizeMathSource('\\frac{1}{2} + \\alpha \\leq \\beta'),
    '\\frac{1}{2} + \\alpha \\leq \\beta',
    '纯 ASCII 与 Unicode 数学符号不得被改写',
  )
  assert.equal(normalizeMathSource(''), '', '空公式不得报错或凭空造内容')
  for (const [source] of realMathSamples) {
    const once = normalizeMathSource(source)
    assert.equal(normalizeMathSource(once), once, `规范化必须幂等: ${source}`)
  }

  // 渲染入口真的把中文放进了 text mode（不是靠 strict:'ignore' 把警告藏起来）。
  assert.ok(
    renderMathToHtml('长 * 宽', false).includes('mtext'),
    '中文必须渲染成 KaTeX text mode，不能停在 math mode 的缺字方框',
  )

  const mathSupportSource = await readFile(new URL('../src/features/documents/SmartDocumentEditor/mathSupport.tsx', import.meta.url), 'utf-8')
  const mathRenderSource = await readFile(new URL('../src/features/documents/SmartDocumentEditor/mathRender.ts', import.meta.url), 'utf-8')
  assert.ok(mathSupportSource.includes("from './mathRender'"), '行内 / 块级公式必须共用唯一渲染入口')
  assert.equal(mathSupportSource.includes('katex.renderToString'), false, '编辑器组件不得再直接调 KaTeX（会绕过规范化）')
  assert.equal(mathSupportSource.includes("from 'katex'"), false, '编辑器组件不得再直接依赖 katex')
  assert.ok(mathRenderSource.includes('katex.renderToString(normalizeMathSource(latex)'), '渲染入口必须真的调用规范化')
  const renderFnBody = mathRenderSource.slice(mathRenderSource.indexOf('export function renderMathToHtml'))
  assert.equal(/\bstrict\s*:/.test(renderFnBody), false, '渲染入口不得用 strict 忽略档屏蔽警告，否则零警告断言会失效')
}

// --- 连线关系：两类语义、旧值兼容、树强校验、配置往返与写库入口 ---
// 【用户决策 2026-11-08】关系物理收敛为 related / subordinate，方向 source=父→target=子，
// 从属强校验唯一父 / 无环 / 深度 ≤100，每次新建连线必须强制选择类型。
{
  // 1) 定义层：恰好两值、id 稳定、方向钉死。
  const builtinIds = BUILTIN_EDGE_RELATIONS.map((item) => item.id)
  assert.deepEqual(builtinIds, ['related', 'subordinate'], '【P0】内置关系必须恰好两种且 id 稳定')
  assert.deepEqual([...EDGE_RELATION_IDS], ['related', 'subordinate'], '【P0】落盘合法值必须恰好两值')
  assert.deepEqual(BUILTIN_EDGE_RELATIONS.map((item) => item.name), ['关联', '从属'], '内置显示名必须与需求一致')
  assert.equal(SUBORDINATE_EDGE_DIRECTION, 'source=parent,target=child', '【P0】从属方向必须钉死父→子')
  assert.equal(SUBORDINATE_EDGE_RELATION_ID, 'subordinate')
  assert.equal(MAX_HIERARCHY_DEPTH, 100, '深度上限必须是 100')
  assert.equal(new Set(BUILTIN_EDGE_RELATIONS.map((item) => item.style.color)).size, 2, '两种关系颜色必须可区分')
  assert.equal(
    BUILTIN_EDGE_RELATIONS.find((item) => item.id === 'subordinate')?.style.lineWidth,
    1.5,
    '从属关系必须用加粗实线与关联区分',
  )

  const fallback = normalizeEdgeRelationDefinitions(undefined)
  assert.deepEqual(fallback.map((item) => item.id), builtinIds, '空配置必须回落到纯内置列表')
  assert.equal(fallback.every((item) => item.builtin === true), true, '两项都是内置，不可删除')

  // 自定义关系必须被彻底丢弃，配置只能改内置 name/description/style。
  const withCustom = normalizeEdgeRelationDefinitions([
    { id: 'rel_x', name: '自定义', style: {} },
    { id: 'related', name: '关联线' },
    { id: 'subordinate', name: '父子' },
    { id: 'bad id!', name: '非法', style: {} },
  ])
  assert.deepEqual(withCustom.map((item) => item.id), ['related', 'subordinate'], '【P0】自定义关系必须丢弃')
  assert.equal(withCustom.find((item) => item.id === 'related')?.name, '关联线', '内置关系允许改名')
  assert.equal(withCustom.find((item) => item.id === 'subordinate')?.builtin, true, 'builtin 标记不可被配置篡改')
  assert.deepEqual(normalizeEdgeRelationDefinitions(withCustom), withCustom, '配置归一化必须幂等')

  // 2) 旧值全量兼容映射（导入外部旧档 / 恢复备份自愈），未知值恒回退 related。
  for (const old of ['相关', '关联', 'related']) {
    assert.equal(readEdgeRelationId(old), 'related', `${old} 必须映射到关联`)
  }
  for (const old of ['依赖', '演进', '从属', '组成', '推导', 'is-a', 'part-of', 'inference', 'subordinate']) {
    assert.equal(readEdgeRelationId(old), 'subordinate', `${old} 必须映射到从属`)
  }
  assert.equal(readEdgeRelationId('rel_deleted'), 'related', '被删自定义关系必须回退关联')
  assert.equal(readEdgeRelationId(''), 'related')
  assert.equal(readEdgeRelationId(undefined), 'related')
  assert.equal(resolveEdgeRelationId('part-of', fallback), 'subordinate')
  assert.equal(isSubordinate('相关'), false)
  assert.equal(isSubordinate('part-of'), true)
  assert.equal(LEGACY_EDGE_RELATION_MAP['依赖'], 'subordinate', '前提/依赖/因果必须合并进从属')

  // 3) 落盘边界：任何输入写出来恒为两值，磁盘上不再可能出现旧值。
  const metaWithRelations = normalizeGraphMeta({
    nodes: {},
    edges: [
      { id: 'e1', source: { ref: 'a' }, target: { ref: 'b' }, relation: '依赖' },
      { id: 'e2', source: { ref: 'b' }, target: { ref: 'c' }, relation: 'part-of' },
      { id: 'e3', source: { ref: 'c' }, target: { ref: 'd' }, relation: 'rel_gone' },
    ],
    viewport: {},
  })
  assert.deepEqual(
    metaWithRelations.edges.map((edge) => edge.relation),
    ['subordinate', 'subordinate', 'related'],
    '【P0】落盘边界必须把旧值自愈成两值',
  )

  // 4) 配置往返：normalizeConfig 会重建对象，漏列字段就会「写完即丢」。
  const configOut = normalizeConfig({ edgeRelations: withCustom, showEdgeRelationLabels: false })
  assert.equal(configOut.showEdgeRelationLabels, false, '标签开关必须写进配置')
  assert.equal(configOut.edgeRelations?.length, 2, '配置里必须只剩两项关系')
  assert.deepEqual(normalizeConfig(configOut).edgeRelations, configOut.edgeRelations, '配置归一化必须幂等')
  const patch = edgeRelationStylePatch(fallback[1].style)
  for (const key of ['lineMode', 'lineStyle', 'color', 'lineWidth', 'arrow', 'arrowSize', 'arrowShape', 'arrowPosition', 'curveControl']) {
    assert.ok(key in patch, `关系样式 patch 必须含 ${key}`)
  }

  // 5) 树强校验真跑（纯函数，不是源码字面量）。
  const E = (id: string, source: string, target: string, relation = 'subordinate', weight = 'minor') => (
    { id, source, target, relation, weight }
  )
  const clean = normalizeTree(['A', 'B', 'C', 'D'], [
    E('e1', 'A', 'B'), E('e2', 'B', 'C'), E('e3', 'A', 'D'), E('e4', 'C', 'D', 'related'),
  ])
  assert.equal(clean.downgrades.length, 0, '合规树不得降级任何边')
  assert.equal(clean.edges.length, 4, '整理不得删边')
  assert.deepEqual(clean.hierarchy.roots, ['A'], 'A 必须是唯一树根')
  assert.equal(clean.hierarchy.depth.get('A'), 1)
  assert.equal(clean.hierarchy.depth.get('B'), 2)
  assert.equal(clean.hierarchy.depth.get('C'), 3, '【P0】深度必须自动推导为父深度+1')
  assert.equal(clean.hierarchy.depth.get('D'), 2)

  const multi = normalizeTree(['A', 'B', 'C'], [
    E('e2', 'B', 'C', 'subordinate', 'minor'),
    E('e1', 'A', 'C', 'subordinate', 'main'),
    E('e3', 'A', 'B'),
  ])
  assert.equal(multi.downgrades.length, 1, '【P0】多父必须降级多余边')
  assert.equal(multi.downgrades[0].reason, 'multiple-parents')
  assert.equal(multi.downgrades[0].edgeId, 'e2', 'main 权重优先，其次 id 字典序')
  assert.equal(multi.edges.find((edge) => edge.id === 'e2')?.relation, 'related', '降级为关联而非删除')
  assert.equal(multi.edges.length, 3, '降级不得改变边总数')

  const cyc = normalizeTree(['A', 'B', 'C'], [E('e1', 'A', 'B'), E('e2', 'B', 'C'), E('e3', 'C', 'A')])
  assert.equal(cyc.downgrades.length, 1, '【P0】必须检出环')
  assert.equal(cyc.downgrades[0].reason, 'cycle')
  assert.equal(cyc.downgrades[0].edgeId, 'e3', '环上 id 最大那条被降级')
  assert.equal(normalizeTree(['A'], [E('e1', 'A', 'A')]).downgrades[0].reason, 'self-loop', '自环必须检出')

  const chainIds: string[] = []
  const chain: Array<ReturnType<typeof E>> = []
  for (let i = 0; i < 101; i += 1) {
    chainIds.push(`n${i}`)
    chain.push(E(`e${String(i).padStart(3, '0')}`, `n${i}`, `n${i + 1}`))
  }
  chainIds.push('n101')
  const deep = normalizeTree(chainIds, chain)
  assert.ok(deep.downgrades.some((item) => item.reason === 'depth-limit'), '【P0】超过 100 层必须降级')
  assert.equal(deep.edges.length, chain.length, '深度降级不得删边')
  assert.ok(Math.max(...deep.hierarchy.depth.values()) <= 100, '整理后最大深度不得超过 100')

  // 增量环检测：深度单调不变量（平级/更深挂载 O(1) 直接接受，祖先链成环必须拒绝）。
  const base = buildHierarchy(['A', 'B', 'C'], [E('e1', 'A', 'B'), E('e2', 'B', 'C')]).hierarchy
  assert.equal(validateSubordinateEdge(base, toHierarchyEdge(E('e3', 'C', 'A'))).ok, false, '【P0】必须检出祖先环')
  assert.equal(validateSubordinateEdge(base, toHierarchyEdge(E('e4', 'A', 'C'))).ok, false, '唯一父')
  assert.equal(validateSubordinateEdge(base, toHierarchyEdge(E('e5', 'A', 'A'))).ok, false, '自环')
  assert.equal(validateSubordinateEdge(base, toHierarchyEdge(E('e6', 'A', 'D'))).ok, true, '新增叶子应 O(1) 接受')

  // 树根与游离节点必须分离（否则一缩小整棵树连根消失）。
  const mixed = normalizeTree(['A', 'B', 'X'], [E('e1', 'A', 'B')])
  assert.deepEqual(mixed.hierarchy.roots, ['A'], '无入边但有出边 = 树根')
  assert.deepEqual(mixed.hierarchy.free, ['X'], '无从属关联 = 最边缘节点')

  // 6) 迁移计划（脚本与回归共用同一纯函数）：只改 relation，逐字段保真。
  const legacyEdges = [
    { id: 'x1', source: 'A', target: 'B', relation: '相关', weight: 'minor', color: '#111111' },
    { id: 'x2', source: 'B', target: 'C', relation: 'part-of', weight: 'main', color: '#222222' },
    { id: 'x3', source: 'B', target: 'C', relation: '依赖', weight: 'minor', color: '#333333' },
    { id: 'x4', source: 'C', target: 'A', relation: 'is-a', weight: 'minor', color: '#444444' },
  ]
  const plan = planEdgeRelationMigration(['A', 'B', 'C'], legacyEdges)
  assert.equal(plan.edges.length, legacyEdges.length, '【P0】迁移不得删边')
  assert.deepEqual(plan.changes.map((item) => item.to), ['related', 'subordinate', 'subordinate', 'subordinate'])
  for (let i = 0; i < legacyEdges.length; i += 1) {
    const before = { ...legacyEdges[i] }
    const after = { ...plan.edges[i] }
    delete (before as Record<string, unknown>).relation
    delete (after as Record<string, unknown>).relation
    assert.deepEqual(after, before, `【P0】迁移除 relation 外必须逐字段原样: ${legacyEdges[i].id}`)
    assert.ok(['related', 'subordinate'].includes(String(plan.edges[i].relation)), '落盘值必须合法')
  }
  assert.equal(Math.max(...plan.hierarchy.depth.values()) <= 100, true)

  // 7) 【核心】esbuild 打包真跑写库入口：新建必须显式关系，从属切换必须强校验。
  const { build: esbuildBuild } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundleResult = await esbuildBuild({
    entryPoints: [fileURLToPath(new URL('../src/hooks/useGraph/edgeOperations.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    banner: { js: 'globalThis.window = globalThis.window || {};' },
  })
  const relModule = await import(
    `data:text/javascript;base64,${Buffer.from(bundleResult.outputFiles[0].text).toString('base64')}`
  ) as unknown as {
    buildEdgeOperations: (deps: Record<string, unknown>) => {
      addEdge: (connection: Record<string, unknown>, edgeId: string, defaultStyle?: Record<string, unknown>, relationId?: string) => Promise<boolean>
      updateEdgeRelation: (edgeId: string, relation: string, weight?: string) => Promise<boolean>
    }
  }
  let relEdges: Array<Record<string, unknown>> = [{
    id: 'e1', source: 'a', target: 'b',
    data: { relation: 'related', weight: 'main', color: '#111111', lineStyle: 'solid', lineWidth: 1.2 },
  }]
  let relSaveCalls = 0
  const relOps = relModule.buildEdgeOperations({
    getActiveGraphSession: () => ({ roomPath: 'room-a' }),
    saveNow: async () => {},
    saveLater: async () => { relSaveCalls += 1 },
    storeApi: {
      getState: () => ({ edges: relEdges, setEdges: (next: Array<Record<string, unknown>>) => { relEdges = next } }),
    },
    getEdgeRelations: () => fallback,
  })

  // 未选关系：一条边都不许落盘。
  assert.equal(
    await relOps.addEdge({ source: 'a', target: 'z' }, 'e-no-rel'),
    false,
    '【P0】新建连线未选关系必须拒绝',
  )
  assert.equal(relEdges.length, 1, '未选关系不得写 store / 落盘')
  assert.equal(relSaveCalls, 0, '未选关系不得触发保存')

  // 显式关联 → 成功；显式从属 → 成功；再从属指向同一子节点 → 唯一父拒绝。
  assert.equal(await relOps.addEdge({ source: 'a', target: 'c' }, 'e-rel', undefined, 'related'), true)
  assert.equal((relEdges.find((edge) => edge.id === 'e-rel')?.data as Record<string, unknown>).relation, 'related')
  assert.equal(await relOps.addEdge({ source: 'a', target: 'd' }, 'e-sub', undefined, 'subordinate'), true)
  assert.equal((relEdges.find((edge) => edge.id === 'e-sub')?.data as Record<string, unknown>).relation, 'subordinate')
  assert.equal(
    await relOps.addEdge({ source: 'b', target: 'd' }, 'e-sub-dup', undefined, 'subordinate'),
    false,
    '【P0】从属边必须强校验唯一父，违规不落盘',
  )
  assert.equal(relEdges.some((edge) => edge.id === 'e-sub-dup'), false, '被拒绝的边不得进入 store')

  // 【强校验】创建期只认显式两值：旧值 / 未知值 / 空值一律拒绝，且不写 store、不落盘。
  const savesBeforeStrict = relSaveCalls
  const invalidRelations: Array<string | undefined> = [undefined, '', '依赖', 'part-of', 'rel_gone', 'RELATED']
  for (let i = 0; i < invalidRelations.length; i += 1) {
    assert.equal(
      await relOps.addEdge({ source: 'a', target: `q${i}` }, `e-bad-${i}`, undefined, invalidRelations[i]),
      false,
      `【P0】创建期非法关系必须拒绝: ${String(invalidRelations[i])}`,
    )
  }
  assert.equal(relEdges.length, 3, '非法关系不得写入 store')
  assert.equal(relSaveCalls, savesBeforeStrict, '非法关系不得触发保存')

  // 切换已有边为从属：成功时写稳定 id + 套用样式 + 触发一次落盘。
  const savesBefore = relSaveCalls
  assert.equal(await relOps.updateEdgeRelation('e1', 'subordinate'), true)
  const relData = relEdges[0].data as Record<string, unknown>
  assert.equal(relData.relation, 'subordinate', '切换关系必须写入稳定 id')
  assert.equal(relData.color, fallback[1].style.color, '切换关系必须套用该关系的默认样式')
  assert.equal(relData.weight, 'main', '未指定 weight 时必须沿用原权重')
  assert.equal(relSaveCalls, savesBefore + 1, '切换关系必须触发一次落盘')

  // 8) 跨进程接线（源码字面量兜底）+ 迁移脚本安全约束。
  const normalizeConfigSource = await readFile(new URL('../src/core/storage/normalizeConfig.ts', import.meta.url), 'utf-8')
  const storeServiceSource = await readFile(new URL('../src/core/storage/service.ts', import.meta.url), 'utf-8')
  const configServiceSource = await readFile(new URL('../src/application/config/configService.ts', import.meta.url), 'utf-8')
  const graphOperationsSource = await readFile(new URL('../src/hooks/useGraph/graphOperations.ts', import.meta.url), 'utf-8')
  const relationOpsSource = await readFile(new URL('../src/hooks/useGraph/edgeOperations.ts', import.meta.url), 'utf-8')
  const normalizeMetaSource = await readFile(new URL('../src/domain/graph/normalizeGraphMeta.ts', import.meta.url), 'utf-8')
  const floatingEdgeSource = await readFile(new URL('../src/features/graph/GraphCanvas/edges/FloatingEdge.tsx', import.meta.url), 'utf-8')
  const toolbarSource = await readFile(new URL('../src/features/graph/GraphCanvas/edges/QuickEdgeToolbar.tsx', import.meta.url), 'utf-8')
  const relationPanelSource = await readFile(new URL('../src/features/right-panel/components/StyleTab/EdgeRelationPanel.tsx', import.meta.url), 'utf-8')
  const styleSectionSource = await readFile(new URL('../src/features/right-panel/components/StyleTab/StyleSection.tsx', import.meta.url), 'utf-8')
  const eventHandlersSource = await readFile(new URL('../src/hooks/useGraph/graphEventHandlers.ts', import.meta.url), 'utf-8')
  const pickerSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/EdgeRelationPicker.tsx', import.meta.url), 'utf-8')
  const migrationSource = await readFile(new URL('../scripts/migrate-edge-relations.mts', import.meta.url), 'utf-8')

  assert.ok(normalizeConfigSource.includes('normalizeEdgeRelationDefinitions(c.edgeRelations)'), 'normalizeConfig 必须显式保留关系定义')
  assert.ok(storeServiceSource.includes('nextConfig.edgeRelations = config.edgeRelations'), 'writeConfig 必须显式透传关系数组')
  assert.ok(configServiceSource.includes('graphUi.setEdgeRelations('), '配置 hydration 必须注入关系定义')
  assert.ok(graphOperationsSource.includes('getEdgeRelations: () => useGraphUiStore.getState().edgeRelations'), '操作层必须拿到全局关系定义')
  assert.ok(relationOpsSource.includes('findEdgeRelationDefinition(nextRelation, getRelations())'), '切换关系必须走定义解析')
  assert.ok(relationOpsSource.includes('assertEdgeRelationForCreate(relationId, getRelations())')
    && relationOpsSource.includes('if (!creation.ok)'),
  '【P0】操作层必须有「显式两值关系 + 关联关系名」强校验的最后防线')
  // 【用户决策 2026-11-09 晚】从属连线恢复原样式：不再有双线轨道 / 层级徽标 /
  // 硬编码几何 / 专用语义色。这里做反向守卫，防止以后又被加回来。
  for (const forbidden of [
    'data-tm-edge-subordinate-rail',
    'data-tm-edge-subordinate-mark',
    'SUBORDINATE_VISUAL',
    'var(--color-edge-subordinate)',
    'GitBranch',
  ]) {
    assert.equal(floatingEdgeSource.includes(forbidden), false,
      `【P0】从属连线必须保持原样式，不得出现 ${forbidden}`)
  }
  assert.ok(floatingEdgeSource.includes('style={style}'),
    '【P0】从属连线必须与其它边一样走可配置的 BaseEdge style')
  assert.ok(floatingEdgeSource.includes(
    'const showRelationLabel = (semantic.mandatoryLabel || showRelationLabels) && midpointAvailable'),
  '【P0】关联边关系名恒显示，从属边仍由「显示关系名」开关控制')
  assert.ok(floatingEdgeSource.includes('{semantic.label}'), '关系名文字必须走兜底后的语义名')
  assert.ok(relationPanelSource.includes('data-tm-edge-relation-semantic-note')
    && relationPanelSource.includes('没有额外的固定视觉标记')
    && relationPanelSource.includes('在连线上显示关系名'),
  '样式配置面板必须声明从属连线沿用可配置样式、无额外固定标记')
  assert.ok(pickerSource.includes('data-tm-edge-relation-mandatory'), '关联选项必须标注强制关系名')
  assert.ok(relationOpsSource.includes('validateSubordinateEdge(hierarchy'), '【P0】新建从属边必须走强校验')
  assert.equal(normalizeMetaSource.includes("value === '演进'"), false, '落盘边界不得再用三值白名单')
  assert.ok(normalizeMetaSource.includes('readEdgeRelationId(value)'), '落盘边界必须统一走两值解析')
  assert.ok(floatingEdgeSource.includes('data-tm-edge-relation-label') && floatingEdgeSource.includes('updateEdgeRelation(id, readEdgeRelationId(relationId))'), '画布必须有关系标签并接通切换')
  assert.ok(toolbarSource.includes('data-tm-edge-relation-trigger') && toolbarSource.includes('data-tm-edge-relation-item'), '选中边工具栏必须有关系下拉')
  assert.ok(relationPanelSource.includes('data-tm-edge-relations-panel'), '右栏必须有关系管理面板')
  assert.equal(relationPanelSource.includes('data-tm-edge-relation-add'), false, '【P0】彻底迁移后不得再有自定义关系新增入口')
  assert.equal(relationPanelSource.includes('newEdgeRelationId'), false, '【P0】自定义关系 id 生成器必须清除')
  assert.ok(styleSectionSource.includes("value: 'relations'"), '样式页必须有「连线关系」分区')
  assert.ok(eventHandlersSource.includes('useEdgeRelationPickerStore'), '【P0】新建连线必须打开必选关系浮层')
  assert.ok(pickerSource.includes('data-tm-edge-relation-picker') && pickerSource.includes('data-tm-edge-relation-choice'), '浮层必须提供两个关系选项')
  assert.ok(migrationSource.includes('planEdgeRelationMigration'), '【P0】迁移脚本必须复用同一份迁移计划函数')
  assert.ok(migrationSource.includes('--ack-app-closed') && migrationSource.includes('graphMetaComparisonKey'), '迁移脚本必须有退出应用确认与往返校验')
  assert.ok(migrationSource.includes('restoreRoom(room)'), '迁移失败必须能逐房间回滚')
}

// --- 从属连线原样式守卫 / 关联强校验 / 返回上个视野策略 ---
// 【用户决策 2026-11-09 晚】从属边恢复原来的可配置样式（双线轨道与层级徽标已移除）；
// 关联边仍必须在连线上写清楚关系（默认「关联」）并强校验；跳转远处节点后可一键返回。
{
  const builtins = normalizeEdgeRelationDefinitions(undefined)

  // 1) 从属连线的视觉完全由可配置样式决定：不得残留硬编码几何 / 专用语义色。
  assert.equal(DEFAULT_RELATED_DISPLAY_NAME, '关联')
  for (const definition of BUILTIN_EDGE_RELATIONS) {
    const serialized = JSON.stringify(definition)
    assert.ok(!serialized.includes('railOffset') && !serialized.includes('hierarchyMark'),
      '【P0】可配置的关系样式里不得混入硬编码语义标记')
  }
  const tokensSource = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf-8')
  assert.equal((tokensSource.match(/--color-edge-subordinate:/g) ?? []).length, 0,
    '【P0】专用语义色必须随双线轨道一起移除')
  const edgeRelationsSource = await readFile(new URL('../src/domain/graph/edgeRelations.ts', import.meta.url), 'utf-8')
  assert.equal(edgeRelationsSource.includes('SUBORDINATE_VISUAL'), false,
    '【P0】语义规则源里不得残留已废弃的视觉常量')

  // 2) 关联边显示名恒非空且强制显示；从属边不强制显示关系名。
  const relatedSemantic = describeEdgeSemantic('related', builtins)
  const subordinateSemantic = describeEdgeSemantic('subordinate', builtins)
  assert.equal(relatedSemantic.label, '关联')
  assert.equal(relatedSemantic.mandatoryLabel, true, '【P0】关联边必须显示关系名')
  assert.equal(subordinateSemantic.label, '从属')
  assert.equal(subordinateSemantic.mandatoryLabel, false, '【P0】从属边不强制写关系名')
  assert.equal(
    describeEdgeSemantic('related', normalizeEdgeRelationDefinitions([{ id: 'related', name: '   ' }])).label,
    '关联',
    '【P0】关系名写成空白必须兜底「关联」',
  )
  assert.equal(
    describeEdgeSemantic('related', normalizeEdgeRelationDefinitions([{ id: 'related', name: '引用' }])).label,
    '引用',
    '配置改名仍允许写清楚具体关系',
  )

  // 3) 创建期严格解析：旧值 / 未知值 / 空值一律拒绝，只有显式两值放行。
  assert.equal(parseStrictEdgeRelation('related'), 'related')
  assert.equal(parseStrictEdgeRelation('subordinate'), 'subordinate')
  for (const bad of [undefined, null, '', '  ', '依赖', 'part-of', 'rel_gone', 42, {}, 'RELATED']) {
    assert.equal(parseStrictEdgeRelation(bad), null, `【P0】创建期不得宽容兜底: ${String(bad)}`)
  }
  assert.equal(readEdgeRelationId('依赖'), 'subordinate', '读盘侧仍保持旧值兼容，与创建期分工')
  assert.deepEqual(assertEdgeRelationForCreate(undefined, builtins), { ok: false, reason: 'missing-relation' })
  assert.deepEqual(assertEdgeRelationForCreate('', builtins), { ok: false, reason: 'missing-relation' })
  assert.deepEqual(assertEdgeRelationForCreate('rel_gone', builtins), { ok: false, reason: 'unknown-relation' })
  assert.equal(assertEdgeRelationForCreate('related', builtins).ok, true)
  assert.equal(assertEdgeRelationForCreate('subordinate', builtins).ok, true)
  const relatedCheck = assertEdgeRelationForCreate('related', builtins)
  assert.ok(relatedCheck.ok && relatedCheck.display.label.trim().length > 0,
    '【P0】创建关联边必须保证连线上有可显示的关系名')

  // 4) 返回上个视野：esbuild 打包真跑同一份纯函数（不是只看源码字面量）。
  const { build: vpBuild } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const vpBundle = await vpBuild({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/viewportReturn.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const vp = await import(
    `data:text/javascript;base64,${Buffer.from(vpBundle.outputFiles[0].text).toString('base64')}`
  ) as Record<string, (...args: unknown[]) => unknown>
  assert.equal(VIEWPORT_RETURN_TTL_MS, 12000)
  assert.ok(VIEWPORT_RETURN_ANIMATION_MS > 0)
  const origin = { x: 0, y: 0, zoom: 0.5 }
  assert.equal(viewportPanDistance(origin, { x: 30, y: 40, zoom: 0.5 }), 50,
    'viewport.x/y 是屏幕像素，无需再换算 flow 坐标')
  assert.ok(Math.abs(viewportZoomDistance(origin, { x: 0, y: 0, zoom: 0.6 }) - 60) < 1e-9)
  assert.equal(viewportJumpDistance(origin, origin), 0)
  assert.equal(shouldOfferViewportReturn(origin, { x: 5, y: 5, zoom: 0.5 }), false, '几乎没动不弹')
  assert.equal(shouldOfferViewportReturn(origin, { x: 900, y: 300, zoom: 0.5 }), true, '远处跳转必须弹')
  assert.equal(shouldOfferViewportReturn(origin, { x: 0, y: 0, zoom: 0.7 }), true, '纯缩放跳变也算跳转')
  const vpEntry = { from: origin, to: { x: 900, y: 300, zoom: 0.5 }, label: '节点 A', createdAt: 1000 }
  assert.equal(isViewportReturnExpired(vpEntry, 1000 + VIEWPORT_RETURN_TTL_MS - 1), false)
  assert.equal(isViewportReturnExpired(vpEntry, 1000 + VIEWPORT_RETURN_TTL_MS), true, '【P0】超时必须自动消失')
  assert.equal(viewportReturnRemainingMs(vpEntry, 1000 + 3000), VIEWPORT_RETURN_TTL_MS - 3000)
  assert.equal(hasUserMovedAway(vpEntry, vpEntry.to), false)
  assert.equal(hasUserMovedAway(vpEntry, { x: 900, y: 360, zoom: 0.5 }), true,
    '【P0】用户拖走镜头后提示必须消失')
  assert.equal(vp.shouldOfferViewportReturn(origin, { x: 0, y: 0, zoom: 0.5 }), false,
    '打包后的实现必须与源码同一份规则')
  assert.equal(vp.isViewportReturnExpired(vpEntry, 1000 + VIEWPORT_RETURN_TTL_MS), true)

  // 5) 接线：只在程序化跳转埋点、按钮挂在画布内、策略齐全、不落盘。
  const modelSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts', import.meta.url), 'utf-8')
  const minimapSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/CanvasMiniMap.tsx', import.meta.url), 'utf-8')
  const cardModelSource = await readFile(new URL('../src/features/graph/GraphCanvas/nodes/KnowledgeCard/model/useKnowledgeCardModel.ts', import.meta.url), 'utf-8')
  const canvasSource = await readFile(new URL('../src/features/graph/GraphCanvas/GraphCanvas.tsx', import.meta.url), 'utf-8')
  const vpButtonSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/ViewportReturnButton.tsx', import.meta.url), 'utf-8')
  const vpStoreSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/viewportReturnStore.ts', import.meta.url), 'utf-8')
  assert.ok(modelSource.includes('rememberViewportJump(reactFlow, String(node.data?.label ?? node.id))'),
    '【P0】搜索选中节点跳转必须埋点')
  assert.ok(minimapSource.includes('rememberViewportJump('), '缩略图点节点必须埋点')
  assert.ok(cardModelSource.includes('rememberViewportJump('), '查看已存在节点跳转必须埋点')
  const focusBody = minimapSource.slice(
    minimapSource.indexOf('const focusMiniMapPoint'),
    minimapSource.indexOf('const flushPendingFocusPoint'),
  )
  assert.ok(focusBody.length > 0 && !focusBody.includes('rememberViewportJump('),
    '【P0】手动拖动缩略图定位不得污染返回历史')
  assert.ok(canvasSource.includes('<ViewportReturnButton tabId={tabId} />'), '按钮必须挂在画布内')
  assert.ok(vpButtonSource.includes('data-tm-viewport-back') && vpButtonSource.includes('setViewport(from'),
    '按钮必须可断言且能平滑返回')
  assert.ok(vpButtonSource.includes('hovered') && vpButtonSource.includes('remainingMs <= 0')
    && vpButtonSource.includes('movedAway') && vpButtonSource.includes('pointerdown'),
  '【P0】超时 / hover 暂停 / 移开 / 手动交互四类消失策略必须齐全')
  assert.ok(vpStoreSource.includes('jumpTokenByTab'), '连续跳转只认最后一次')
  assert.ok(!vpStoreSource.includes('persist(')
    && !vpStoreSource.includes('createJSONStorage(')
    && !/\blocalStorage\s*\(/.test(vpStoreSource),
  '【P0】返回历史是纯运行时状态，不得落盘')
}

// --- 节点标题栏自适应：装饰必须与测量同源，任何装饰变化都要驱动宽度重算 ---
// 历史 bug：加了「关联文档」链环后节点宽度不再自适应、标题折行被裁。根因是
// 渲染（JSX）与测量（Canvas + 手工常量）两套事实来源，且 useMemo 手工枚举依赖漏了
// linkedDocuments。这里用 esbuild 打包真跑纯函数，逐项验证 width/signature/height。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundled = async (relative: string) => {
    const entry = fileURLToPath(new URL(relative, import.meta.url))
    const bundle = await build({
      entryPoints: [entry],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
  }
  const modelPath = '../src/features/graph/GraphCanvas/nodes/KnowledgeCard/model/'
  const autoSizeMod = await loadBundled(`${modelPath}autoSize.ts`) as unknown as {
    calculateKnowledgeCardAutoSize: (
      label: string,
      style: Record<string, unknown>,
      decorations: Record<string, unknown>,
    ) => {
      width: number
      height: number
      maxTextWidth: number
      maxAutoWidth: number
      lines: number
      clamped: boolean
    }
  }
  const limitsMod = await loadBundled(`${modelPath}cardSizeLimits.ts`) as unknown as {
    MAX_TITLE_LINES: number
    MAX_TITLE_WIDTH_CHARS: number
    getTitleClampStyle: () => Record<string, unknown>
  }
  const decorationsMod = await loadBundled(`${modelPath}titleDecorations.ts`) as unknown as {
    describeKnowledgeCardTitle: (
      data: Record<string, unknown>,
      style: Record<string, unknown>,
      badgeSize: number,
    ) => {
      signature: string
      leadingWidth: number
      trailingWidth: number
      horizontalPadding: number
      linkedDocumentCount: number
      emojis: string[]
      hasDetail: boolean
      childCount: number
    }
  }
  const measure = autoSizeMod.calculateKnowledgeCardAutoSize
  const describe = decorationsMod.describeKnowledgeCardTitle

  const style = { headerFontSize: 11 }
  const badgeSize = 14
  const LABEL = '关联文档测试节点'
  const baseData: Record<string, unknown> = { label: LABEL }
  const base = describe(baseData, style, badgeSize)
  const baseWidth = measure(LABEL, style, base).width

  const linkData = (count: number): Record<string, unknown> => ({
    label: LABEL,
    linkedDocuments: Array.from({ length: count }, (_, i) => ({
      docId: `doc_${i}`, cardRef: `card-${i}`, title: `文档${i}`,
    })),
  })

  // P0：直接复现「加关联文档后宽度不自适应」——签名必须失效、链环必须计入宽度。
  const withOne = describe(linkData(1), style, badgeSize)
  assert.notEqual(withOne.signature, base.signature,
    '【P0】linkedDocuments 必须进入 signature，否则 autoSize 命中旧缓存、宽度永不重算')
  assert.ok(withOne.leadingWidth > base.leadingWidth,
    '【P0】关联文档链环是标题左侧 flex item，必须计入 leadingWidth')
  const withOneWidth = measure(LABEL, style, withOne).width
  assert.ok(withOneWidth > baseWidth,
    '【P0】加关联文档后节点必须变宽，否则标题被挤成多行')
  assert.ok(withOneWidth - baseWidth >= withOne.leadingWidth - base.leadingWidth - 1,
    '【P0】宽度增量必须覆盖链环占位')

  const withMany = describe(linkData(8), style, badgeSize)
  assert.ok(withMany.leadingWidth >= withOne.leadingWidth, '多篇关联文档的数字标记不应让宽度变窄')
  assert.notEqual(withMany.signature, withOne.signature, '关联文档数量变化必须让 signature 失效')

  // 装饰矩阵：每种装饰都必须「签名变化 + 宽度增加」，防止未来新增装饰只改渲染、忘了测量。
  const decorationCases: Array<[string, Record<string, unknown>, number]> = [
    ['emoji', { label: LABEL, emojis: ['🧭'] }, badgeSize],
    ['hasDetail', { label: LABEL, hasDetail: true }, badgeSize],
    ['childCount', { label: LABEL, childCount: 3 }, badgeSize],
    ['linkedDocuments', linkData(1), badgeSize],
    ['badgeSize', { label: LABEL, childCount: 3 }, 28],
  ]
  for (const [name, data, size] of decorationCases) {
    const decorations = describe(data, style, size)
    assert.notEqual(decorations.signature, base.signature, `${name} 必须改变 signature（自动失效）`)
    const width = measure(LABEL, style, decorations).width
    assert.ok(width > baseWidth, `${name} 的占位必须撑宽节点`)
  }
  assert.ok(
    describe({ label: LABEL, childCount: 3 }, style, 28).trailingWidth
      > describe({ label: LABEL, childCount: 3 }, style, 14).trailingWidth,
    '右槽位宽度必须跟随 nodeBadgeSize，不能再写死常量',
  )

  // 「最多 4 行 + 省略号」+「保留节点最大长度」：
  // DOM 的 -webkit-line-clamp 与 Canvas 高度/宽度上限必须同源于 cardSizeLimits，
  // 否则会回到「测量封顶但 DOM 不截断」被裁掉，或「DOM 截断但测量不封顶」底部留白。
  assert.equal(limitsMod.MAX_TITLE_LINES, 4, '标题最多渲染 4 行')
  assert.equal(limitsMod.MAX_TITLE_WIDTH_CHARS, 20, '自动宽度天花板：20 个汉字宽')
  const clampStyle = limitsMod.getTitleClampStyle()
  assert.equal(clampStyle.display, '-webkit-box', '省略号需要 -webkit-box')
  assert.equal(clampStyle.WebkitBoxOrient, 'vertical', 'line-clamp 需要纵向 box-orient')
  assert.equal(clampStyle.WebkitLineClamp, limitsMod.MAX_TITLE_LINES,
    '【P0】DOM 的 line-clamp 必须与 autoSize 的高度封顶共用同一个 MAX_TITLE_LINES')
  assert.equal(clampStyle.overflow, 'hidden', 'line-clamp 需要 overflow:hidden')

  const longLabel = '汉'.repeat(120)
  const longSize = measure(longLabel, style, base)
  const shortSize = measure('汉'.repeat(20), style, base)

  // 节点最大长度：任何长标题都不能把自动宽度撑过天花板。
  assert.ok(longSize.maxAutoWidth > baseWidth, '最大长度上限必须存在且大于普通节点宽度')
  assert.ok(longSize.width <= longSize.maxAutoWidth,
    '【P1】自动宽度不得超过节点最大长度上限')
  assert.equal(longSize.width, longSize.maxAutoWidth,
    '【P1】超长单行标题应恰好撑到最大长度上限，而不是无限变宽')
  assert.ok(measure('汉'.repeat(400), style, base).width <= longSize.maxAutoWidth,
    '【P1】再长的标题也不得突破最大长度上限')

  assert.ok(longSize.height > shortSize.height, '长标题高度必须跟随行数增长')
  assert.equal(longSize.lines, limitsMod.MAX_TITLE_LINES, '【P0】超长标题行数必须封顶 4 行')
  assert.equal(longSize.clamped, true, '【P0】超长标题必须标记为被截断')
  const maxClampedHeight = Math.max(
    36,
    Math.ceil(Math.max(24, limitsMod.MAX_TITLE_LINES * Math.round(11 * 1.3)) + 12),
  )
  assert.equal(longSize.height, maxClampedHeight,
    '【P0】高度必须等于 4 行 clamp 后的高度，与 DOM 实际渲染一致')
  assert.equal(shortSize.clamped, false, '短标题不应被截断')

  // 接线保障：渲染侧与测量侧必须消费同一份 decorations，不得各读各的 data。
  const cardSource = await readFile(new URL('../src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx', import.meta.url), 'utf-8')
  const modelSource = await readFile(new URL(`${modelPath}useKnowledgeCardModel.ts`, import.meta.url), 'utf-8')
  const autoSizeSource = await readFile(new URL(`${modelPath}autoSize.ts`, import.meta.url), 'utf-8')
  const decorationsSource = await readFile(new URL(`${modelPath}titleDecorations.ts`, import.meta.url), 'utf-8')
  assert.ok(cardSource.includes('state.decorations'), '节点渲染必须消费同一份 decorations')
  assert.equal(cardSource.includes('data.linkedDocuments?.length'), false, '渲染侧不得再自己读 data.linkedDocuments')
  assert.equal(cardSource.includes('data.emojis'), false, '渲染侧不得再自己读 data.emojis')
  assert.equal(cardSource.includes('data.childCount'), false, '渲染侧不得再自己读 data.childCount')
  assert.equal(cardSource.includes('data.hasDetail'), false, '渲染侧不得再自己读 data.hasDetail')
  assert.ok(modelSource.includes('decorations.signature'), 'autoSize 必须依赖 signature 自动失效')
  assert.equal(modelSource.includes('emojiCount, hasDetail, childCount, nodeStyle'), false, '不得再手工枚举装饰依赖')
  assert.ok(cardSource.includes('style={TITLE_CLAMP_STYLE}'),
    '【P0】渲染侧必须把同源 clamp 样式应用到标题，否则 DOM 不会真正截断')
  assert.ok(cardSource.includes('getTitleClampStyle'), '渲染侧必须从共享常量模块取截断样式')
  assert.ok(autoSizeSource.includes('MAX_TITLE_LINES'), '测量侧必须消费同一个行数上限')
  assert.ok(autoSizeSource.includes('MAX_TITLE_WIDTH_CHARS'), '最大长度上限必须来自共享常量')
  assert.equal(autoSizeSource.includes('MAX_AUTO_LINES'), false, '不得再出现独立的行数封顶常量')
  assert.equal(autoSizeSource.includes('MAX_AUTO_CHINESE_CHARS'), false, '不得再出现独立的最大宽度常量')
  for (const field of ['data.linkedDocuments', 'data.emojis', 'data.hasDetail', 'data.childCount']) {
    assert.ok(decorationsSource.includes(field), `装饰单一事实来源必须读取 ${field}`)
  }
}

// --- 语义缩放：字形尺寸上下限 + 连续细节（P0，2026-11-09）---
// 【用户决策】「缩到最后文字小得看不清，缩放就没意义；节点和内容要有上下限，
//  超过阈值的缩放只驱动布局」。用 esbuild 打包真跑纯函数，不是查源码字面量。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/zoomScale.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const zs = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const {
    ZOOM_REFERENCE, MIN_RAW_ZOOM, MAX_RAW_ZOOM,
    GLYPH_MIN_SCALE, GLYPH_FAR_SCALE,
    DETAIL_START_RATIO, DETAIL_FULL_RATIO, DETAIL_HIT_THRESHOLD,
    glyphScaleForZoom, glyphScaleForRatio, glyphCompensationForZoom,
    detailAlphaForZoom, detailTierForZoom, semanticZoomVarsForZoom, toDisplayRatio,
  } = zs

  // 1) 100% 必须完全恒等：用户点「复位」时卡片与旧版逐像素一致。
  assert.equal(glyphScaleForZoom(ZOOM_REFERENCE), 1, '【P0】100% 的屏幕尺寸倍率必须恒等于 1')
  assert.ok(Math.abs(glyphCompensationForZoom(ZOOM_REFERENCE) - 1) < 1e-9, '【P0】100% 不得施加任何补偿')
  assert.equal(detailAlphaForZoom(ZOOM_REFERENCE), 1, '【P0】100% 细节必须完整')
  assert.equal(detailTierForZoom(ZOOM_REFERENCE), 2)

  // 2) 屏幕尺寸 = base × compensation × zoom = base × glyphScale，与间距解耦。
  //    【2026-11-10】放大上限收到 100%：近景放大分支已删，100% 起恒等 1；
  //    只有远景 <100% 平滑放大到 GLYPH_FAR_SCALE。
  for (const percent of [30, 45, 60, 80, 100]) {
    const raw = (percent / 100) * ZOOM_REFERENCE
    const glyph = glyphScaleForZoom(raw)
    const comp = glyphCompensationForZoom(raw)
    assert.ok(Math.abs(comp * toDisplayRatio(raw) - glyph) < 1e-9, `【P0】屏幕尺寸必须等于 glyphScale（${percent}%）`)
    assert.ok(glyph >= GLYPH_MIN_SCALE && glyph <= GLYPH_FAR_SCALE + 1e-9, `【P0】字形倍率必须被上下限钳住（${percent}%）`)
    assert.ok(Math.abs(glyphScaleForRatio(toDisplayRatio(raw)) - glyph) < 1e-9,
      '【P1.5】LOD 压力与画布补偿必须消费同一个字形倍率函数')
  }
  assert.equal(zs.GLYPH_MAX_SCALE, undefined, '【2026-11-10】100% 上限后不得再保留近景放大常量')
  assert.equal(zs.GLYPH_SCALE_EXPONENT, undefined, '【2026-11-10】近景 pow 放大分支必须彻底删除')
  assert.ok(GLYPH_FAR_SCALE > GLYPH_MIN_SCALE && GLYPH_FAR_SCALE <= 1.5,
    '【P1.5】远景放大必须克制，否则重叠压力会逼 LOD 把主干也藏掉')
  assert.equal(glyphScaleForZoom(MIN_RAW_ZOOM), GLYPH_FAR_SCALE, '【P1.5】渐隐终点的目标倍率必须钳在 1.3')
  // 【文字仍保持 2026-11-11 晚】紧凑区不冻结补偿，而是继续按 1/ratio 撑大：
  // 屏幕倍率 = compensation × ratio 恒为 1.3 → 标题字号不随镜头缩到 2.4px。
  assert.ok(Math.abs(glyphCompensationForZoom(MIN_RAW_ZOOM) - GLYPH_FAR_SCALE / 0.05) < 1e-9,
    '【文字保持】5% 补偿必须撑到 glyphScale/0.05，而不是冻结在 /0.2')
  const compactCompensations = [0.2, 0.15, 0.1, 0.05].map((r: number) =>
    glyphCompensationForZoom(r * ZOOM_REFERENCE))
  for (let i = 1; i < compactCompensations.length; i += 1) {
    assert.ok(compactCompensations[i] > compactCompensations[i - 1],
      '【文字保持】越缩越小必须靠 1/ratio 补偿抵消，补偿严格递增')
  }
  const screenAt = (r: number) => glyphCompensationForZoom(r * ZOOM_REFERENCE) * r
  for (const r of [0.2, 0.15, 0.1, 0.05]) {
    assert.ok(Math.abs(screenAt(r) - GLYPH_FAR_SCALE) < 1e-9,
      `【文字保持】${Math.round(r * 100)}% 屏幕字号倍率必须恒为 1.3（与 20% 端点一致）`)
  }
  assert.ok(screenAt(0.05) > GLYPH_FAR_SCALE * 0.25 * 3,
    '【文字保持】5% 屏幕字号不再是 20% 的 1/4，用户明确选择可读性优先于零重叠')
  assert.equal(glyphScaleForZoom(MAX_RAW_ZOOM), GLYPH_MIN_SCALE, '【2026-11-10】上限就是 100%，恒等不虚胖')
  assert.equal(glyphCompensationForZoom(MAX_RAW_ZOOM), 1, '【2026-11-10】上限处不施加任何补偿')
  // 越界输入（旧房间存的 154% / 曾允许的 200%）必须先被钳到 100%，再按恒等点算，
  // 否则旧镜头一打开节点就会虚胖 15%。
  for (const percent of [110, 130, 154, 200]) {
    const raw = (percent / 100) * ZOOM_REFERENCE
    assert.equal(glyphScaleForZoom(raw), GLYPH_MIN_SCALE, `【2026-11-10】${percent}% 越界输入必须钳到恒等点`)
    assert.equal(glyphCompensationForZoom(raw), 1, `【2026-11-10】${percent}% 越界补偿必须恒等 1`)
    assert.equal(glyphScaleForRatio(percent / 100), GLYPH_MIN_SCALE,
      `【2026-11-10】glyphScaleForRatio(${percent / 100}) 必须钳回 1`)
  }
  const comps = [30, 45, 60, 80, 100].map((p) => glyphCompensationForZoom((p / 100) * ZOOM_REFERENCE))
  for (let i = 1; i < comps.length; i += 1) {
    assert.ok(comps[i] < comps[i - 1], '【P0】补偿必须随镜头拉近单调下降，不允许反折')
  }

  // 2b) 【P1.5】远景放大：100% 是唯一恒等点；两侧各自单调、平滑无跳档。
  assert.equal(glyphScaleForRatio(1), 1, '【P1.5】100% 必须仍是逐像素恒等点')
  const farRatios = Array.from({ length: 36 }, (_, i) => 0.3 + i * 0.02)
  const farGlyphs = farRatios.map((r: number) => glyphScaleForRatio(r))
  for (let i = 1; i < farGlyphs.length; i += 1) {
    assert.ok(farGlyphs[i] <= farGlyphs[i - 1] + 1e-9, '【P1.5】放大时远景倍率必须单调不增')
    assert.ok(farGlyphs[i - 1] - farGlyphs[i] < 0.05, '【P1.5】远景倍率不得出现骤降档位')
  }
  assert.ok(Math.abs(farGlyphs[farGlyphs.length - 1] - 1) < 1e-9, '【P1.5】远景曲线必须平滑接到 100%')
  assert.ok(glyphScaleForRatio(0.3) / glyphScaleForRatio(1) >= 1.25,
    '【P1.5】远景屏幕字号必须比 100% 明显更大，主干才真的更清晰')
  // 【2026-11-10】100% 是缩放上限：任何 >100% 的输入都钳回恒等点，不再有近景放大段。
  const nearGlyphs = [1, 1.2, 1.5, 1.8, 2].map((r: number) => glyphScaleForRatio(r))
  assert.ok(nearGlyphs.every((g: number) => Math.abs(g - 1) < 1e-9),
    '【2026-11-10】超过 100% 的输入必须一律恒等 1，节点不虚胖')
  assert.ok(farGlyphs.every((g: number) => g >= 1),
    '【P0】100% 必须是全局最小屏幕尺寸，任何镜头都不得更小')

  // 3) 细节连续显隐：两端平滑、单调、无骤变档位；挂载档位与 alpha 同源。
  assert.equal(detailAlphaForZoom(MIN_RAW_ZOOM), 0, '【P0】最远镜头只剩骨架')
  assert.equal(detailAlphaForZoom(DETAIL_START_RATIO * ZOOM_REFERENCE), 0)
  assert.equal(detailAlphaForZoom(DETAIL_FULL_RATIO * ZOOM_REFERENCE), 1)
  const alphas = Array.from({ length: 15 }, (_, i) => detailAlphaForZoom((0.4 + i * 0.045) * ZOOM_REFERENCE))
  for (let i = 1; i < alphas.length; i += 1) {
    assert.ok(alphas[i] >= alphas[i - 1], '【P0】细节显现度必须随放大单调不减')
    assert.ok(alphas[i] - alphas[i - 1] < 0.2, '【P0】细节不得出现骤变档位')
  }
  assert.equal(DETAIL_HIT_THRESHOLD, 0.5)
  assert.equal(semanticZoomVarsForZoom(MIN_RAW_ZOOM).detailHit, 'none', '【P0】远景淡出的装饰不得吃鼠标事件')
  assert.equal(semanticZoomVarsForZoom(ZOOM_REFERENCE).detailHit, 'auto')
  assert.deepEqual(
    [detailTierForZoom(MIN_RAW_ZOOM), detailTierForZoom(0.65 * ZOOM_REFERENCE), detailTierForZoom(ZOOM_REFERENCE)],
    [0, 1, 2],
    '【P0】昂贵部件的档位必须由同一份 alpha 派生',
  )

  // 4) 接线守卫：视觉变量必须按连续 zoom 写、两层壳必须分离、装饰必须连续淡出。
  const semanticCanvasSource = await readFile(new URL('../src/features/graph/GraphCanvas/GraphCanvas.tsx', import.meta.url), 'utf-8')
  const semanticCardSource = await readFile(new URL('../src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx', import.meta.url), 'utf-8')
  const semanticCssSource = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf-8')
  assert.ok(semanticCanvasSource.includes('semanticZoomVarsForZoom(zoomLevel)'),
    '【P0】视觉变量必须按连续 zoomLevel 写，不能用 2% 台阶的 lodZoom（会在远景跳成 20%+ 一格）')
  assert.ok(semanticCanvasSource.includes("setProperty('--tm-glyph-comp'"), '【P0】画布必须下发字形补偿变量')
  assert.ok(semanticCanvasSource.includes("setProperty('--tm-detail-alpha'"), '【P0】画布必须下发细节显现度变量')
  assert.ok(semanticCardSource.includes('data-tm-glyph-layer="true"') && semanticCardSource.includes('data-tm-card-anchor="true"'),
    '【P0】锚点壳与视觉壳必须分离，否则 transform 会污染 handleBounds')
  assert.ok(semanticCardSource.includes('scale(var(--tm-glyph-comp, 1))'),
    '【P0】只有视觉壳做缩放，锚点壳尺寸不得随镜头变化')
  assert.ok(semanticCardSource.includes('detailTierForZoom(s.transform[2])'),
    '【P0】昂贵部件档位必须与连续 alpha 同源，不得再各写一套 raw 阈值')
  assert.equal(semanticCardSource.includes('isMinimalDetail ? null'), false,
    '【P0】远景不得再把标题整块卸载成纯色块（现在有字形补偿，文字恒可读）')
  assert.ok(semanticCardSource.includes('tm-card-detail') && semanticCssSource.includes('.tm-card-detail'),
    '【P0】装饰必须由连续 alpha 淡出，而不是硬切条件渲染')
  assert.ok(semanticCssSource.includes('opacity: var(--tm-detail-alpha, 1)'),
    '【P0】CSS 必须消费细节显现度变量')
}

// --- 语义缩放 LOD（按节点数分位数）+ 缩放比例尺（P2-B）---
// 【用户决策 2026-11-08】「50% 该叫 100%、不能放太大」；「深度要随缩放平滑进出，不许骤降」。
// 【用户决策 2026-11-09】「旧 130% 该叫 100%、放大到 200%、缩小到 30%」。
// 【用户决策 2026-11-10】「再放大没有意义，节点已全部展示」→ 上限收到 100%；
//   「前期隐藏少、后期突然变多」→ 阈值改为按累计节点数分位数铺满整个行程；
//   「缩放/显隐动画要平滑」→ 滚轮逐帧缓动 + 双向渐隐渐出。
// 用 esbuild 打包真跑纯函数（不是查源码字面量），并验证 hidden 只作用于渲染副本。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundled = async (relative: string) => {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  }
  const lod = await loadBundled('../src/domain/graph/lod.ts')
  const zs = await loadBundled('../src/domain/graph/zoomScale.ts')

  const {
    LOD_TREE_COVERAGE_THRESHOLD, LOD_FULL_RATIO, LOD_FLOOR_RATIO,
    LOD_DEFAULT_PRESERVED_DEPTH, LOD_MAX_PRESERVED_DEPTH, normalizePreservedDepth,
    LOD_HYSTERESIS, LOD_FADE_MS, revealRatioForRank,
    computeLodVisibility, applyLodNodeHidden, applyLodEdgeHidden,
    buildLodHierarchyKey, describeLodReason,
  } = lod
  const {
    ZOOM_REFERENCE, MIN_RAW_ZOOM, MAX_RAW_ZOOM, LEGACY_DEFAULT_RAW_ZOOM,
    LEGACY_REFERENCE_RAW_ZOOM, MIN_DISPLAY_PERCENT, MAX_DISPLAY_PERCENT,
    MAX_WHEEL_DELTA, MAX_PENDING_WHEEL_DELTA, ZOOM_TRANSITION_MS,
    WHEEL_SMOOTH_TAU_MS, LOD_ZOOM_QUANTUM,
    clampRawZoom, clampWheelDelta, clampPendingWheelDelta, wheelDeltaStep,
    rebaseViewportZoom, rebaseViewport, toDisplayRatio, toDisplayPercent,
    formatZoomPercent, fromDisplayPercent, stepDisplayZoom, quantizeLodZoom,
    resolveLodStage, describeLodStage, LOD_STAGE_LABELS,
  } = zs

  // 1) 比例尺：旧 130% 重定基为 100%，可用区间 5%~100%，两个历史默认镜头复位。
  //    100% 同时是「常规阅读比例 / LOD 全显示端点 / 语义缩放恒等点 / 放大上限」；
  //    20% 是渐隐终点 / 紧凑起点（COMPACT_START_PERCENT），5% 是紧凑终点。
  assert.equal(ZOOM_REFERENCE, 0.65, '【P0】旧基准 130%（raw 0.65）必须重定基为新的 100%')
  assert.equal(LEGACY_REFERENCE_RAW_ZOOM, 0.5, '旧基准 100% 的 raw 必须留档供重定基')
  assert.equal(toDisplayPercent(LEGACY_REFERENCE_RAW_ZOOM * 1.3), 100, '【P0】旧 130% 的观感现在必须读作 100%')
  assert.equal(MIN_DISPLAY_PERCENT, 5, '【2026-11-11】最小比例必须是 5%')
  assert.equal(MAX_DISPLAY_PERCENT, 100, '【2026-11-10】放大上限必须是 100%，再放大不产生新信息')
  assert.ok(Math.abs(MIN_RAW_ZOOM - ZOOM_REFERENCE * 0.05) < 1e-9, '下限必须由 5% 派生')
  assert.ok(Math.abs(MAX_RAW_ZOOM - ZOOM_REFERENCE) < 1e-9, '【2026-11-10】上限必须恒等于 ZOOM_REFERENCE')
  assert.equal(toDisplayPercent(MIN_RAW_ZOOM), 5, '【P0】最小比例必须读作 5%')
  assert.equal(toDisplayPercent(MAX_RAW_ZOOM), 100, '【2026-11-10】最大比例必须读作 100%')
  assert.equal(toDisplayPercent(ZOOM_REFERENCE), 100, '常规阅读视图必须显示 100%')
  assert.equal(toDisplayPercent(LEGACY_DEFAULT_RAW_ZOOM), 154, '远古默认 raw 1 在新基准下读作 154%')
  assert.equal(formatZoomPercent(ZOOM_REFERENCE / 2), '50%')
  assert.equal(clampRawZoom(4), MAX_RAW_ZOOM, '【P0】程序化放大也不能越过上限')
  assert.equal(clampRawZoom(0.01), MIN_RAW_ZOOM)
  assert.equal(rebaseViewportZoom(LEGACY_DEFAULT_RAW_ZOOM), ZOOM_REFERENCE, '【P0】远古默认镜头必须重定基')
  assert.equal(rebaseViewportZoom(LEGACY_REFERENCE_RAW_ZOOM), ZOOM_REFERENCE, '【P0】老房间默认 0.5 必须回到新的 100%，否则一打开掉进 LOD 收起区间')
  assert.equal(rebaseViewportZoom(0.3), 0.3, '用户保存过的镜头不得被擅自改写')
  assert.equal(rebaseViewportZoom(9), MAX_RAW_ZOOM)
  assert.deepEqual(rebaseViewport({ x: 12, y: 34, zoom: 1 }), { x: 12, y: 34, zoom: ZOOM_REFERENCE }, '重定基只改 zoom，pan 原样保留')
  assert.equal(fromDisplayPercent(100), ZOOM_REFERENCE)
  assert.equal(fromDisplayPercent(999), MAX_RAW_ZOOM)
  assert.equal(fromDisplayPercent(1), MIN_RAW_ZOOM)
  assert.equal(fromDisplayPercent(150), ZOOM_REFERENCE, '【2026-11-10】150% 必须钳回 100% 上限')
  assert.equal(stepDisplayZoom(ZOOM_REFERENCE, 10), ZOOM_REFERENCE, '【2026-11-10】100% 处继续放大必须停住')
  assert.equal(stepDisplayZoom(ZOOM_REFERENCE, -10), fromDisplayPercent(90))
  assert.equal(stepDisplayZoom(MAX_RAW_ZOOM, 10), MAX_RAW_ZOOM, '上限处继续放大必须停住')
  assert.equal(stepDisplayZoom(MAX_RAW_ZOOM, -10), fromDisplayPercent(90), '上限处缩小仍可用')
  assert.equal(MAX_WHEEL_DELTA, 80, '【P0】滚轮单格必须阻尼，否则一格跳 26% 会让节点成批进出')
  assert.equal(clampWheelDelta(220), 80)
  assert.equal(clampWheelDelta(-220), -80)
  assert.equal(clampWheelDelta(12), 12, '触控板细粒度事件必须原样放行')
  assert.equal(ZOOM_TRANSITION_MS, 240, '按钮过渡与 LOD 淡入淡出必须同节奏')
  assert.ok(WHEEL_SMOOTH_TAU_MS > 0 && WHEEL_SMOOTH_TAU_MS < 120, '滚轮缓动时间常数必须在可感知但不拖沓的区间')
  // 逐帧缓动真跑：拆分后的总 delta 必须收敛到原值，单帧不过冲、方向不翻转。
  const consumeWheel = (initial: number, frames: number) => {
    let remaining = initial
    let dispatched = 0
    let maxStep = 0
    for (let i = 0; i < frames; i += 1) {
      const step = wheelDeltaStep(remaining, 16)
      assert.ok(Math.abs(step) <= Math.abs(remaining) + 1e-9, '【P0】单帧增量不得过冲')
      assert.ok(initial >= 0 ? step >= 0 : step <= 0, '缓动方向不得翻转')
      remaining -= step
      dispatched += step
      maxStep = Math.max(maxStep, Math.abs(step))
    }
    return { remaining, dispatched, maxStep }
  }
  const posWheel = consumeWheel(MAX_WHEEL_DELTA, 22)
  assert.ok(posWheel.dispatched > MAX_WHEEL_DELTA * 0.97 && posWheel.dispatched <= MAX_WHEEL_DELTA + 1e-9,
    `【P0】逐帧拆分后总缩放量必须等价于原来一格（实际 ${posWheel.dispatched}）`)
  assert.ok(posWheel.remaining < MAX_WHEEL_DELTA * 0.03, '缓动必须收敛')
  assert.ok(posWheel.maxStep < MAX_WHEEL_DELTA * 0.3, '【P0】首帧最多派发约 1/4 格，禁止一格跳完')
  const negWheel = consumeWheel(-MAX_WHEEL_DELTA, 22)
  assert.ok(negWheel.dispatched < -MAX_WHEEL_DELTA * 0.97, '反向滚轮也必须缓动收敛')
  assert.equal(wheelDeltaStep(0, 16), 0)
  assert.equal(wheelDeltaStep(80, 0), 0, 'dt=0 时不得凭空消费增量')
  assert.equal(clampPendingWheelDelta(999), MAX_PENDING_WHEEL_DELTA)
  assert.equal(clampPendingWheelDelta(-999), -MAX_PENDING_WHEEL_DELTA)
  const halfStepRaw = (ZOOM_REFERENCE * LOD_ZOOM_QUANTUM) / 2
  // 100% 上限后不再测 0.91（旧 140%）；改成上限内的中景值 + 越界钳制单独验证。
  for (const raw of [0.26, 0.39, 0.52, ZOOM_REFERENCE, MAX_RAW_ZOOM]) {
    const q = quantizeLodZoom(raw)
    assert.ok(Math.abs(q - raw) <= halfStepRaw + 1e-9, `量化不得跳超过半个台阶（raw=${raw}）`)
    assert.equal(toDisplayPercent(q) % 2, 0, '量化必须落在 2% 台阶上')
  }
  // 【紧凑区】5%~20% 一律吸附到 20% 渐隐终点：可见集合冻结，不必每 2% 重建整树。
  for (const raw of [MIN_RAW_ZOOM, 0.05 * ZOOM_REFERENCE, 0.1 * ZOOM_REFERENCE, 0.15 * ZOOM_REFERENCE]) {
    assert.equal(quantizeLodZoom(raw), 0.2 * ZOOM_REFERENCE,
      '【紧凑区】LOD 量化必须冻结在 20%，紧凑缩放不触发可见性重算')
  }
  // 非台阶上的值必须被吸附；否则等于没量化，滚轮每帧都会重算可见性。
  const offStep = 0.53
  const snapped = quantizeLodZoom(offStep)
  assert.ok(Math.abs(snapped - offStep) > 0.001, '【P0】非整台阶 zoom 必须吸附到 2% 台阶')
  assert.equal(toDisplayPercent(snapped) % 2, 0, '【P0】量化结果必须落在偶数百分比上')
  assert.deepEqual([1, 0.85, 0.5, 0.2].map((r) => resolveLodStage(r * ZOOM_REFERENCE)), [0, 1, 2, 3])
  assert.deepEqual(LOD_STAGE_LABELS, ['完整图谱', '渐进收起', '主干轮廓', '仅骨架'])
  assert.equal(describeLodStage(3), '仅骨架')

  // 2) 按节点数分位数分配 reveal：不得再按深度级数 / 游离排名分档位。
  assert.equal(lod.LOD_TIERS, undefined, '【P0】不得再出现离散档位表（会成批隐藏节点）')
  assert.equal(lod.resolveLodTier, undefined, '【P0】不得再按离散档位裁剪')
  assert.equal(lod.revealRatioForDepth, undefined, '【P0】按深度级数分阈值会让偏斜树整层骤降')
  assert.equal(lod.revealRatioForFree, undefined, '【P0】按游离排名分阈值会让前 30% 行程几乎不隐藏')
  assert.equal(lod.LOD_FREE_END_RATIO, undefined, '【P0】固定 70% 分界会重新制造「前期隐藏少」')
  assert.equal(LOD_FULL_RATIO, 1, '≥100% 必须全图可见')
  assert.equal(LOD_FLOOR_RATIO, 0.2, '【2026-11-11】渐隐终点 / 紧凑起点必须是 20%')
  assert.equal(LOD_FLOOR_RATIO, zs.COMPACT_START_RATIO,
    'LOD_FLOOR_RATIO 必须由 zoomScale.COMPACT_START_RATIO 唯一派生')
  assert.equal(LOD_DEFAULT_PRESERVED_DEPTH, 2, '【默认两层】永久显示默认到 depth 2（root=1 / 一级子=2）')
  assert.equal(LOD_MAX_PRESERVED_DEPTH, 100, '「全部层级」必须与 hierarchy 深度上限同源')
  assert.equal(normalizePreservedDepth(undefined), 2, '旧偏好没有该字段时必须回落默认两层')
  assert.equal(normalizePreservedDepth('3'), 3, '面板传来的字符串层数也要归一化')
  assert.equal(normalizePreservedDepth(0), 2, '0 不是合法层数，回落默认')
  assert.equal(normalizePreservedDepth(-4), 1, '负数钳到 1 层（仅树根）')
  assert.equal(normalizePreservedDepth(999), LOD_MAX_PRESERVED_DEPTH, '越界层数钳到最大')
  assert.equal(normalizePreservedDepth(Number.NaN), 2, '脏数据回落默认')
  assert.ok(LOD_HYSTERESIS > 0 && LOD_HYSTERESIS < 0.05, '临界点必须有滞回但带宽不能过大')
  assert.equal(LOD_FADE_MS, 240, '渐隐渐出必须比旧的 170ms 更柔和')
  assert.equal(LOD_TREE_COVERAGE_THRESHOLD, 0.25, '无树保护的覆盖率阈值必须恒定')
  const rankThresholds = Array.from({ length: 60 }, (_, i) => revealRatioForRank(i, 60))
  // 判据是 ratio >= reveal，阈值越高越早消失；退场序列越靠后阈值必须越低。
  for (let i = 1; i < rankThresholds.length; i += 1) {
    assert.ok(rankThresholds[i] < rankThresholds[i - 1], '【P0】退场序列阈值必须单调递减')
    assert.ok(rankThresholds[i - 1] - rankThresholds[i] < 0.02, '【P0】相邻节点阈值必须足够密')
  }
  assert.ok(rankThresholds[0] < 1 && rankThresholds[0] > 0.98, '首个节点在 100% 之下立刻开始退场')
  assert.ok(rankThresholds[59] > LOD_FLOOR_RATIO && rankThresholds[59] < LOD_FLOOR_RATIO + 0.02,
    '末个节点必须在 20% 之上退场完毕')
  assert.equal(revealRatioForRank(0, 0), LOD_FULL_RATIO, '无可隐藏节点时不得产生阈值')

  // 3) 一棵 4 节点合规树 + 2 个游离节点（覆盖 4/6 = 0.667，LOD 应启用）。
  const treeNodes = [
    { id: 'root' }, { id: 'c1' }, { id: 'c2' }, { id: 'g1' },
    { id: 'free1' }, { id: 'free2' },
  ]
  const treeEdges = [
    { id: 'e1', source: 'root', target: 'c1', relation: 'subordinate' },
    { id: 'e2', source: 'root', target: 'c2', relation: 'subordinate' },
    { id: 'e3', source: 'c1', target: 'g1', relation: 'subordinate' },
    { id: 'e4', source: 'free1', target: 'free2', relation: 'related' },
  ]
  const base = { nodes: treeNodes, edges: treeEdges }

  const full = computeLodVisibility({ ...base, zoom: ZOOM_REFERENCE })
  assert.equal(full.active, true, '有树且覆盖足够时必须启用')
  assert.equal(full.reason, 'active')
  assert.equal(full.hiddenNodeIds.size, 0, '【P0】100% 常规视图必须全图可见')
  assert.equal(full.hiddenEdgeIds.size, 0, '常规视图不得隐藏任何边')
  assert.equal(full.displayPercent, 100)
  assert.equal(full.tier, 0)
  const zoomedIn = computeLodVisibility({ ...base, zoom: MAX_RAW_ZOOM })
  assert.equal(zoomedIn.hiddenNodeIds.size, 0, '放到最大仍然是全图，不该反而藏节点')

  const mid = computeLodVisibility({ ...base, zoom: 0.8 * ZOOM_REFERENCE })
  assert.equal(mid.active, true)
  assert.equal(mid.displayPercent, 80)
  assert.ok(mid.hiddenNodeIds.size >= 1 && mid.hiddenNodeIds.size <= 2, '【P0】80% 只该收起 1~2 个节点，不能成批消失')
  assert.ok(mid.visibleNodeIds.has('root') && mid.visibleNodeIds.has('g1'), '80% 仍应看得见深层节点')
  assert.ok(mid.visibleNodeIds.has('c1') && mid.visibleNodeIds.has('c2'), '【P0】80% 一级主干必须全在')
  assert.ok(!mid.hiddenNodeIds.has('c1') && !mid.hiddenNodeIds.has('c2'), '【P0】80% 先退场的只能是游离节点，不能是主干')

  const tiny = computeLodVisibility({ ...base, zoom: MIN_RAW_ZOOM })
  assert.deepEqual([...tiny.visibleNodeIds].sort(), ['c1', 'c2', 'root'],
    '【默认两层】最远镜头 depth 1 / 2 的**全部**节点都保留，不能只留一个一级主干')
  assert.ok(!tiny.visibleNodeIds.has('g1') && !tiny.visibleNodeIds.has('free1'))
  assert.equal(tiny.preservedDepth, 2, '可见性计划必须回吐实际生效层数，面板与裁剪同源')
  assert.equal(tiny.displayPercent, 5, '【紧凑区】诊断必须回吐真实读数 5%，不能被钳成 20%')
  // 【2026-11-11 紧凑行程】20%→5% 可见集合严格冻结：不再隐藏也不再显示任何节点。
  const compactPlan = computeLodVisibility({ ...base, zoom: 0.2 * ZOOM_REFERENCE })
  for (const ratio of [0.2, 0.15, 0.1, 0.05]) {
    const step = computeLodVisibility({ ...base, zoom: ratio * ZOOM_REFERENCE })
    assert.deepEqual([...step.visibleNodeIds].sort(), [...compactPlan.visibleNodeIds].sort(),
      `【紧凑区】${Math.round(ratio * 100)}% 可见集合必须与 20% 端点完全一致`)
    assert.equal(step.hiddenNodeIds.size, compactPlan.hiddenNodeIds.size,
      `【紧凑区】${Math.round(ratio * 100)}% 不得再隐藏/放出节点`)
    assert.equal(step.collisionHiddenCount, 0,
      `【紧凑区】${Math.round(ratio * 100)}% 不得再跑碰撞抽稀`)
    assert.equal(step.visibleDepthLevelCount, 2,
      `【紧凑区】${Math.round(ratio * 100)}% 仍至少保留两层深度`)
    assert.equal(step.displayPercent, Math.round(ratio * 100),
      '紧凑区每档仍回吐真实显示比')
  }

  // 3b) 【P0 方向铁律】真实逐档缩放验证「谁先消失」。默认永久显示 2 层时，
  //     depth 1 / 2 的**全部**节点恒定显示，退场只由游离 + depth 3 承担；
  //     为继续验证「游离 → 深层 → 浅层主干 → 树根」的顺序没被改坏，
  //     再把层数调到 1 真跑一遍，让 depth 2 主干也参与退场。
  const runOrder = (preservedDepth: number) => {
    const firstHiddenRatio = new Map<string, number>()
    const snapshots: Array<{ ratio: number; visible: Set<string> }> = []
    let rootEverHidden = false
    let previous: Set<string> | undefined
    for (let ratioStep = 1; ratioStep >= 0.2 - 1e-9; ratioStep -= 0.02) {
      const snapshot = computeLodVisibility({
        ...base, preservedDepth, zoom: ratioStep * ZOOM_REFERENCE, previousVisibleNodeIds: previous,
      })
      snapshots.push({ ratio: ratioStep, visible: snapshot.visibleNodeIds })
      for (const node of treeNodes) {
        if (!snapshot.visibleNodeIds.has(node.id) && !firstHiddenRatio.has(node.id)) {
          firstHiddenRatio.set(node.id, ratioStep)
        }
      }
      if (!snapshot.visibleNodeIds.has('root')) rootEverHidden = true
      previous = snapshot.visibleNodeIds
    }
    return { firstHiddenRatio, snapshots, rootEverHidden }
  }
  const defaultOrder = runOrder(LOD_DEFAULT_PRESERVED_DEPTH)
  assert.equal(defaultOrder.rootEverHidden, false, '【P0】树根任何倍率都不能隐藏')
  assert.equal(defaultOrder.firstHiddenRatio.get('c1'), undefined,
    '【默认两层】depth 2 的第一个一级主干必须恒定显示')
  assert.equal(defaultOrder.firstHiddenRatio.get('c2'), undefined,
    '【默认两层】depth 2 的第二个一级主干也必须恒定显示（不能只留其中一个）')
  assert.ok(defaultOrder.firstHiddenRatio.has('g1') && defaultOrder.firstHiddenRatio.has('free1'),
    '默认两层时退场由游离节点与 depth 3 深层承担')
  const oneLevelOrder = runOrder(1)
  assert.equal(oneLevelOrder.rootEverHidden, false, '【自定义 1 层】只保树根时树根仍恒定显示')
  const deepGoneRatio = oneLevelOrder.firstHiddenRatio.get('g1')
  const trunkGoneRatio = oneLevelOrder.firstHiddenRatio.get('c2')
  const freeGoneRatio = oneLevelOrder.firstHiddenRatio.get('free1')
  assert.ok(deepGoneRatio !== undefined && trunkGoneRatio !== undefined && freeGoneRatio !== undefined,
    '自定义 1 层时游离 / 深层 / 主干节点都必须经历隐藏')
  assert.ok((freeGoneRatio as number) >= (deepGoneRatio as number), '【P0】游离节点不得晚于深层叶子消失')
  assert.ok((deepGoneRatio as number) > (trunkGoneRatio as number),
    `【P0】深度 3 必须先于深度 2 消失（深层 ${deepGoneRatio} / 主干 ${trunkGoneRatio}）`)
  const deepGoneSnapshot = oneLevelOrder.snapshots.find((item) => !item.visible.has('g1'))
  assert.ok(deepGoneSnapshot?.visible.has('c1') && deepGoneSnapshot?.visible.has('c2'),
    '【P0】深层叶子刚消失时，一级主干必须仍然可见')

  // 3c) 左上角层级诊断：字段必须来自同一份 hierarchy，且随缩放真实变化。
  assert.equal(full.treeMaxDepth, 3, '【P0】深度推断必须是 root=1 / c1,c2=2 / g1=3')
  assert.equal(full.rootCount, 1)
  assert.equal(full.freeCount, 2)
  assert.deepEqual(full.depthLevels, [
    { depth: 1, total: 1, visible: 1 },
    { depth: 2, total: 2, visible: 2 },
    { depth: 3, total: 1, visible: 1 },
  ], '【P0】完整档每级可见数必须等于总数')
  assert.deepEqual(tiny.depthLevels, [
    { depth: 1, total: 1, visible: 1 },
    { depth: 2, total: 2, visible: 2 },
    { depth: 3, total: 1, visible: 0 },
  ], '【默认两层】最远镜头深层归零，depth 1 / 2 的全部节点都还在')
  assert.equal(tiny.visibleDepthLevelCount, 2, '【默认两层】最远镜头两层深度都可见')
  for (let ratioStep = 1; ratioStep >= 0.2 - 1e-9; ratioStep -= 0.02) {
    const step = computeLodVisibility({ ...base, zoom: ratioStep * ZOOM_REFERENCE })
    const d1 = step.depthLevels.find((l: { depth: number }) => l.depth === 1)?.visible ?? 0
    const d2 = step.depthLevels.find((l: { depth: number }) => l.depth === 2)?.visible ?? 0
    assert.ok(step.visibleDepthLevelCount >= LOD_DEFAULT_PRESERVED_DEPTH && d1 >= 1 && d2 >= 2,
      `【默认两层】缩放全程 depth 1 / 2 必须全部保留（${ratioStep.toFixed(2)}：${d1}/${d2}）`)
  }
  assert.equal(full.selectedNode, null, '未选中节点时不得伪造诊断')
  // 默认两层下 c1 / c2 已是永久显示，诊断阈值改用 depth 3 的 g1 验证「读数与裁剪同源」。
  const selectedForDepth = computeLodVisibility({
    ...base,
    nodes: treeNodes.map((node) => node.id === 'g1' ? { ...node, selected: true } : node),
    zoom: MIN_RAW_ZOOM,
  })
  assert.equal(selectedForDepth.selectedNode?.id, 'g1')
  assert.equal(selectedForDepth.selectedNode?.depth, 3)
  assert.equal(selectedForDepth.selectedNode?.kind, 'tree')
  assert.equal(selectedForDepth.selectedNode?.visible, true, '选中节点本身会被强制显示')
  assert.equal(selectedForDepth.selectedNode?.forced, true)
  const g1Reveal = selectedForDepth.selectedNode?.revealRatio
  assert.ok(typeof g1Reveal === 'number' && g1Reveal > LOD_FLOOR_RATIO && g1Reveal < LOD_FULL_RATIO,
    '树节点的诊断阈值必须落在收起区间内')
  // 诊断读数必须与实际隐藏时机同源：刚好低于该阈值时 g1 就该被藏。
  const justBelowG1 = computeLodVisibility({ ...base, zoom: ((g1Reveal as number) - 0.03) * ZOOM_REFERENCE })
  assert.ok(!justBelowG1.visibleNodeIds.has('g1'), '【P0】层级诊断的阈值必须与实际裁剪同源')
  assert.equal(selectedForDepth.selectedNode?.label, 'g1', '读不到 data.label 时退回 id')
  const permanentNode = computeLodVisibility({ ...base, zoom: ZOOM_REFERENCE, selectedNodeId: 'c2' })
  assert.equal(permanentNode.selectedNode?.revealRatio, null,
    '【默认两层】depth 2 永久显示节点的诊断必须读作「始终显示」')
  const labeled = computeLodVisibility({
    ...base,
    nodes: treeNodes.map((node) => node.id === 'c2' ? { ...node, selected: true, data: { label: '一级 B' } } : node),
    zoom: ZOOM_REFERENCE,
  })
  assert.equal(labeled.selectedNode?.label, '一级 B', '诊断面板必须显示节点标题而不是裸 id')
  // React Flow 的选中态不保证同步进 nodes[].selected；面板与置顶按钮必须共用 store 来源。
  const storeSelected = computeLodVisibility({ ...base, zoom: MIN_RAW_ZOOM, selectedNodeId: 'g1' })
  assert.equal(storeSelected.selectedNode?.id, 'g1', '【P0】store 选中而 nodes 未标 selected 时，诊断仍要生效')
  assert.equal(storeSelected.selectedNode?.depth, 3)
  assert.equal(storeSelected.selectedNode?.kind, 'tree')
  assert.ok(storeSelected.visibleNodeIds.has('g1'), '【P0】store 选中的深层节点也必须被强制显示')
  assert.deepEqual(storeSelected.selectedNodeIds, [], 'nodes 派生的选中集合不得被 store 字段伪造')
  const staleSelected = computeLodVisibility({ ...base, zoom: MIN_RAW_ZOOM, selectedNodeId: 'not-in-room' })
  assert.equal(staleSelected.selectedNode, null, '房间切换后的陈旧 id 不得产生假诊断')

  // 树根保护必须**独立于** depth 上限：把上限压到 0 单独验证 roots 初始化。
  const hierarchyMod = await import('../src/domain/graph/graphHierarchy.ts')
  const builtHierarchy = hierarchyMod.buildHierarchy(
    treeNodes.map((node) => node.id),
    treeEdges.filter((edge) => edge.relation === 'subordinate').map((edge) => hierarchyMod.toHierarchyEdge(edge)),
  )
  assert.deepEqual(
    [...hierarchyMod.computeLodVisibleNodes(builtHierarchy.hierarchy, 0, new Set<string>())],
    ['root'],
    '【P0】树根保护必须独立于 maxDepth，否则缩小到骨架档整棵树连根消失',
  )

  // 3d) 【自定义永久显示层数，2026-11-11】同一棵树分别按 1 / 2 / 3 / 全部层数跑最远镜头：
  //     depth <= N 的**全部**节点都要在、更深的都不在，树根恒留、游离节点不受层数保护。
  const deepTreeNodes = [
    { id: 'R' }, { id: 'A' }, { id: 'B' }, { id: 'A1' }, { id: 'B1' }, { id: 'A1a' }, { id: 'zfree' },
  ]
  const deepTreeEdges = [
    { id: 't1', source: 'R', target: 'A', relation: 'subordinate' },
    { id: 't2', source: 'R', target: 'B', relation: 'subordinate' },
    { id: 't3', source: 'A', target: 'A1', relation: 'subordinate' },
    { id: 't4', source: 'B', target: 'B1', relation: 'subordinate' },
    { id: 't5', source: 'A1', target: 'A1a', relation: 'subordinate' },
  ]
  const deepTreeBase = { nodes: deepTreeNodes, edges: deepTreeEdges, zoom: MIN_RAW_ZOOM }
  const expectedPreserved: Array<[number, string[]]> = [
    [1, ['R']],
    [2, ['A', 'B', 'R']],
    [3, ['A', 'A1', 'B', 'B1', 'R']],
    [LOD_MAX_PRESERVED_DEPTH, ['A', 'A1', 'A1a', 'B', 'B1', 'R']],
  ]
  for (const [depth, expected] of expectedPreserved) {
    const step = computeLodVisibility({ ...deepTreeBase, preservedDepth: depth })
    assert.deepEqual([...step.visibleNodeIds].sort(), expected,
      `【自定义 ${depth} 层】最远镜头必须保留 depth <= ${depth} 的全部树节点`)
    assert.equal(step.preservedDepth, normalizePreservedDepth(depth), '生效层数必须归一化后回吐')
    assert.equal(step.visibleDepthLevelCount, Math.min(depth, 4), '可见深度层数必须跟着配置变')
    assert.ok(!step.visibleNodeIds.has('zfree'), '游离节点没有树深度，任何层数都不永久显示')
  }
  // 随时变更：同一份输入连续切换层数，结果必须立刻跟着变（不依赖刷新 / 换房间）。
  const switching = [1, 3, 2, LOD_MAX_PRESERVED_DEPTH].map((depth) =>
    computeLodVisibility({ ...deepTreeBase, preservedDepth: depth }).visibleNodeIds.size)
  assert.deepEqual(switching, [1, 5, 3, 6], '【随时变更】改层数必须立即改变可见集合')

  // 4) 平滑性：一条 12 级长树 + 30 个游离节点，逐 2% 缩放时可见数必须单调且小步。
  const chainNodes = [
    { id: 'r' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `d${i + 1}` })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `f${i}` })),
  ]
  const chainEdges = [
    { id: 's0', source: 'r', target: 'd1', relation: 'subordinate' },
    ...Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, source: `d${i + 1}`, target: `d${i + 2}`, relation: 'subordinate' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, source: `f${i}`, target: `f${i + 1}`, relation: 'related' })),
  ]
  let previousVisible: Set<string> | undefined
  const counts: number[] = []
  for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const step = computeLodVisibility({
      nodes: chainNodes, edges: chainEdges, zoom: ratio * ZOOM_REFERENCE,
      previousVisibleNodeIds: previousVisible,
    })
    counts.push(step.visibleNodeIds.size)
    assert.ok(step.visibleDepthLevelCount >= LOD_DEFAULT_PRESERVED_DEPTH,
      '【默认两层】长链树缩放全程至少两层深度可见')
    previousVisible = step.visibleNodeIds
  }
  assert.equal(counts[0], chainNodes.length, '100% 必须全图可见')
  assert.equal(counts[counts.length - 1], 2, '【默认两层】最远镜头必须还有树根 + 一级主干')
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i] <= counts[i - 1], `【P0】缩小过程中可见节点数不得回升（第 ${i} 步）`)
    assert.ok(counts[i - 1] - counts[i] <= 4, `【P0】单步最多隐藏少数节点，禁止骤降（第 ${i} 步掉了 ${counts[i - 1] - counts[i]} 个）`)
  }
  assert.ok(new Set(counts).size >= 10, '【P0】缩放全程必须有足够多中间状态，而不是 4 个离散档位')

  // 4b) 【P0 按节点数分位数，2026-11-09 三次优化】偏斜树：60 个叶子全挤在 depth 3。
  // 旧的「按深度级数分阈值」实现会在跨过 0.5 的一帧里整层隐藏 60 个节点，
  // 正是用户说的「前期缩放节点隐藏少，后期突然变多」。新实现按累计节点数
  // 铺阈值，不管某层有多少节点，每段缩放行程隐藏的数量都≈恒定。
  const skewedNodes = [
    { id: 'sr' }, { id: 'sa' },
    ...Array.from({ length: 60 }, (_, i) => ({ id: `sl${i}` })),
  ]
  const skewedEdges = [
    { id: 'ss0', source: 'sr', target: 'sa', relation: 'subordinate' },
    ...Array.from({ length: 60 }, (_, i) => ({ id: `ss${i + 1}`, source: 'sa', target: `sl${i}`, relation: 'subordinate' })),
  ]
  let skewedPrevious: Set<string> | undefined
  const skewedCounts: number[] = []
  for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const step = computeLodVisibility({
      nodes: skewedNodes, edges: skewedEdges, zoom: ratio * ZOOM_REFERENCE,
      previousVisibleNodeIds: skewedPrevious,
    })
    skewedCounts.push(step.visibleNodeIds.size)
    skewedPrevious = step.visibleNodeIds
  }
  assert.equal(skewedCounts[0], skewedNodes.length, '100% 必须全图可见')
  assert.equal(skewedCounts[skewedCounts.length - 1], 2, '【保底两层】偏斜树最远镜头也必须还有两层')
  const skewedDrops = skewedCounts.slice(1).map((count, i) => skewedCounts[i] - count)
  const maxSkewedDrop = Math.max(...skewedDrops)
  const avgSkewedDrop = (skewedNodes.length - 2) / skewedDrops.length
  assert.ok(maxSkewedDrop <= 4, `【P0】偏斜深度分布不得整层骤降（单步最多 ${maxSkewedDrop} 个）`)
  assert.ok(skewedDrops.filter((drop) => drop > 0).length >= 20,
    `【P0】隐藏必须摊到整段行程，不能集中在两三档（实际 ${skewedDrops.filter((d) => d > 0).length} 档有变化）`)
  assert.ok(maxSkewedDrop <= avgSkewedDrop * 2.5 + 1,
    `【P0】单步隐藏量不得显著高于平均值（max ${maxSkewedDrop} / avg ${avgSkewedDrop.toFixed(2)}）`)
  // 前 1/3 行程与后 1/3 行程隐藏量必须接近，不能「前期少、后期突然变多」。
  const firstThird = skewedDrops.slice(0, 12).reduce((a, b) => a + b, 0)
  const lastThird = skewedDrops.slice(-12).reduce((a, b) => a + b, 0)
  assert.ok(firstThird > 0 && lastThird > 0 && lastThird <= firstThird * 2 + 4,
    `【P0】前后段隐藏量不能失衡（前 ${firstThird} / 后 ${lastThird}）`)

  // 5) 滞回：临界点附近已显示/已隐藏的节点不能随滚轮微抖来回闪。
  // 三个节点：r(根) → c1(depth 2，默认永久显示) → c2(唯一参与退场的深层节点)。
  const smallNodes = [{ id: 'r' }, { id: 'c1' }, { id: 'c2' }]
  const smallEdges = [
    { id: 's0', source: 'r', target: 'c1', relation: 'subordinate' },
    { id: 's1', source: 'c1', target: 'c2', relation: 'subordinate' },
  ]
  const edgeRatio = revealRatioForRank(0, 2)
  const nearZoom = (edgeRatio - LOD_HYSTERESIS / 2) * ZOOM_REFERENCE
  const stayed = computeLodVisibility({ nodes: smallNodes, edges: smallEdges, zoom: nearZoom, previousVisibleNodeIds: new Set(['r', 'c1', 'c2']) })
  const stayedHidden = computeLodVisibility({ nodes: smallNodes, edges: smallEdges, zoom: nearZoom, previousVisibleNodeIds: new Set(['r', 'c1']) })
  assert.ok(stayed.visibleNodeIds.has('c2'), '【P0】滞回：临界点已显示的节点不能立刻闪掉')
  assert.ok(!stayedHidden.visibleNodeIds.has('c2'), '【P0】滞回：临界点已隐藏的节点不能立刻冒出')

  // 6) pin / 临时 reveal / 当前选中都要绕开裁剪，且不改树与 depth。
  const pinned = computeLodVisibility({ ...base, zoom: MIN_RAW_ZOOM, pinned: new Set(['free2']) })
  assert.deepEqual([...pinned.visibleNodeIds].sort(), ['c1', 'c2', 'free2', 'root'],
    '【P0】pin 节点始终显示，且不得顺带放出别的游离节点（depth 2 全部常驻）')
  assert.equal(pinned.subordinateEdgeCount, 3, 'pin 不参与树，从属边数量不变')
  const revealed = computeLodVisibility({ ...base, zoom: MIN_RAW_ZOOM, revealed: new Set(['g1']) })
  assert.ok(revealed.visibleNodeIds.has('g1'), '搜索定位的临时显示必须生效')
  const selectedNodes = treeNodes.map((node) => node.id === 'c1' ? { ...node, selected: true } : node)
  const selected = computeLodVisibility({ ...base, nodes: selectedNodes, zoom: MIN_RAW_ZOOM })
  assert.ok(selected.visibleNodeIds.has('c1'), '【P0】当前选中节点不能被 LOD 突然藏掉')
  assert.deepEqual(selected.selectedNodeIds, ['c1'], '选中节点必须由可见性计划直接派生（pin 控件依赖它）')

  // 7) 三条保护：无树 / 低覆盖 / 用户关闭；force 可跳过保护。
  const noTree = computeLodVisibility({ nodes: treeNodes, edges: [{ id: 'w1', source: 'root', target: 'c1', relation: 'related' }], zoom: MIN_RAW_ZOOM })
  assert.equal(noTree.active, false, '【P0】纯关联图必须自动关闭 LOD')
  assert.equal(noTree.reason, 'no-tree')
  assert.equal(noTree.hiddenNodeIds.size, 0, '保护生效时一个节点都不许隐藏')
  const manyFree = [
    { id: 'r' }, { id: 'k' },
    ...Array.from({ length: 18 }, (_, i) => ({ id: `f${i}` })),
  ]
  const lowCoverage = computeLodVisibility({
    nodes: manyFree, edges: [{ id: 's1', source: 'r', target: 'k', relation: 'subordinate' }], zoom: MIN_RAW_ZOOM,
  })
  assert.equal(lowCoverage.active, false, '【P0】树覆盖率过低必须自动关闭 LOD')
  assert.equal(lowCoverage.reason, 'low-coverage')
  const forced = computeLodVisibility({
    nodes: manyFree, edges: [{ id: 's1', source: 'r', target: 'k', relation: 'subordinate' }], zoom: MIN_RAW_ZOOM, mode: 'force',
  })
  assert.equal(forced.active, true, '强制模式必须能跳过保护')
  assert.equal(forced.reason, 'forced')
  // k 是这棵树唯一的 depth 2 节点 → 默认两层内永久显示；裁剪由 18 个游离节点承担。
  assert.ok(forced.visibleNodeIds.has('r') && forced.hiddenNodeIds.size > 0
    && !forced.visibleNodeIds.has('f0'), '强制模式仍要按连续阈值裁剪')
  const turnedOff = computeLodVisibility({ ...base, zoom: MIN_RAW_ZOOM, mode: 'off' })
  assert.equal(turnedOff.active, false, '用户关闭后必须全部显示')
  assert.equal(turnedOff.hiddenEdgeIds.size, 0)
  assert.equal(describeLodReason('no-tree'), '本房间没有从属关系，已自动关闭')

  // 8) 旧值兼容：磁盘残留的中文 / 旧 id 仍要读成同一棵从属树。
  const legacy = computeLodVisibility({
    nodes: treeNodes,
    edges: treeEdges.map((edge) => edge.relation === 'subordinate'
      ? { ...edge, relation: 'part-of' }
      : { ...edge, relation: '相关' }),
    zoom: 0.2,
  })
  assert.equal(legacy.subordinateEdgeCount, 3, '旧关系值必须经唯一读取入口映射进树')
  assert.ok(!legacy.visibleNodeIds.has('g1') && legacy.hiddenNodeIds.has('free1'), '旧关系值也要按连续阈值裁剪')

  // 9) 淡入淡出：淡出中的节点先保持挂载并降透明度，到时再真 hidden；回来时挂 animation。
  const fading = applyLodNodeHidden(treeNodes.map((n) => ({ ...n })), tiny, {
    out: new Set(['g1']), in: new Set(['root']),
  })
  const fadingNode = fading.find((n: any) => n.id === 'g1')
  assert.equal(fadingNode.hidden, false, '【P0】淡出中的节点必须先保持挂载')
  assert.equal(fadingNode.style.opacity, 0)
  assert.ok(String(fadingNode.style.animation).includes('tm-lod-exit'), '【P0】渐隐必须走 exit 关键帧')
  assert.ok(String(fadingNode.style.animation).includes(`${LOD_FADE_MS}ms`), '渐隐时长必须来自唯一常量')
  assert.ok(String(fadingNode.style.animation).includes('both'), '淡出结束前必须保持 opacity 0，不能弹回')
  assert.equal(fadingNode.style.pointerEvents, 'none', '淡出节点不得继续吃鼠标事件')
  const entering = String(fading.find((n: any) => n.id === 'root').style.animation)
  assert.ok(entering.includes('tm-lod-enter') && entering.includes(`${LOD_FADE_MS}ms`) && entering.includes('both'),
    '【P0】重新出现的节点必须渐显，且与渐隐同节奏')
  const settled = applyLodNodeHidden(fading, tiny)
  assert.equal(settled.find((n: any) => n.id === 'g1').hidden, true, '【P0】淡出结束后必须真正 hidden')
  assert.equal(settled.find((n: any) => n.id === 'root').style, undefined, '淡入结束后不得残留过渡样式')

  // 10) hidden 只作用于渲染副本：未变对象复用引用、重复调用返回同一数组。
  const renderedNodes = applyLodNodeHidden(treeNodes.map((n) => ({ ...n })), tiny)
  assert.notEqual(renderedNodes, treeNodes, '必须返回渲染副本而不是改 store 原数组')
  assert.equal(renderedNodes.find((n: any) => n.id === 'root')?.hidden, undefined, '可见节点不得被写 hidden')
  assert.equal(renderedNodes.find((n: any) => n.id === 'g1')?.hidden, true, '隐藏节点必须带 hidden')
  assert.equal(applyLodNodeHidden(renderedNodes, tiny), renderedNodes, '【P0】hidden 不变时必须零拷贝复用原数组')
  const renderedEdges = applyLodEdgeHidden(treeEdges.map((e) => ({ ...e })), tiny)
  assert.equal(renderedEdges.find((e: any) => e.id === 'e4')?.hidden, true, '边也要带 hidden')
  // e1/e2(root→c1/c2) 两端现在都可见（depth 2 全部永久显示）；e3(c1→g1) 才是「一端已隐藏」。
  assert.equal(renderedEdges.find((e: any) => e.id === 'e3')?.hidden, true, '两端有隐藏节点时边必须隐藏')
  assert.equal(renderedEdges.find((e: any) => e.id === 'e1')?.hidden, undefined, '两端都可见的边不得隐藏')
  assert.equal(renderedEdges.find((e: any) => e.id === 'e2')?.hidden, undefined,
    '【默认两层】第二个一级主干的连线也必须保留，不能只保一个骨架')
  assert.equal(applyLodEdgeHidden(renderedEdges, tiny), renderedEdges, '边 hidden 不变时零拷贝')

  // 11) hierarchy 签名：拖动改位置不能让签名失效，改关系必须失效。
  const keyA = buildLodHierarchyKey(treeNodes, treeEdges)
  const moved = treeNodes.map((n, i) => ({ ...n, position: { x: i * 100, y: 0 }, selected: i === 1 }))
  assert.equal(buildLodHierarchyKey(moved, treeEdges), keyA, '【P0】拖动 / 选中变化不得触发整树重建')
  const changedRelationEdges = treeEdges.map((e) => e.id === 'e1' ? { ...e, relation: 'related' } : e)
  assert.notEqual(buildLodHierarchyKey(treeNodes, changedRelationEdges), keyA, '关系变化必须重建树')
  assert.notEqual(buildLodHierarchyKey(treeNodes.slice(1), treeEdges), keyA, '增删节点必须重建树')

  // 12) 接线保障：比例尺唯一源、滚轮阻尼、连续 zoom、淡入淡出、渲染副本。
  const canvasSource = await readFile(new URL('../src/features/graph/GraphCanvas/GraphCanvas.tsx', import.meta.url), 'utf-8')
  const modelSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts', import.meta.url), 'utf-8')
  const hookSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/useSemanticLod.ts', import.meta.url), 'utf-8')
  const controlSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/LodControl.tsx', import.meta.url), 'utf-8')
  const toolbarSource = await readFile(new URL('../src/features/layout/Toolbar/Toolbar.tsx', import.meta.url), 'utf-8')
  const prefsSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/lodPreferences.ts', import.meta.url), 'utf-8')
  const lodSource = await readFile(new URL('../src/domain/graph/lod.ts', import.meta.url), 'utf-8')
  const cssSource = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf-8')
  assert.ok(canvasSource.includes('nodes={lod.visibleNodes as Node[]}') && canvasSource.includes('edges={lod.visibleEdges as Edge[]}'), '【P0】ReactFlow 必须消费 LOD 过滤副本')
  assert.ok(canvasSource.includes('nodes={nodes as Node[]}') && canvasSource.includes('edges={edges}'), '【P0】缩略图与搜索必须继续用全量节点/边')
  assert.ok(canvasSource.includes('maxZoom={MAX_RAW_ZOOM}') && canvasSource.includes('minZoom={MIN_RAW_ZOOM}'), '【P0】画布缩放边界必须来自唯一规则源')
  assert.ok(canvasSource.includes('defaultViewport={renderViewport}'), '【P0】落盘旧默认必须经重定基后才交给 ReactFlow')
  assert.ok(canvasSource.includes('onWheelCapture={handleWheelCapture}') && canvasSource.includes('clampWheelDelta(native.deltaY)'), '【P0】滚轮必须阻尼，否则一格跳过多个 LOD 台阶')
  assert.ok(canvasSource.includes('wheelDeltaStep(anim.remaining, dt)') && canvasSource.includes('requestAnimationFrame'),
    '【P0】滚轮必须逐帧缓动派发，不能一格直接跳到终值')
  assert.ok(canvasSource.includes('clampPendingWheelDelta') && canvasSource.includes('anim.pane.dispatchEvent(normalized)'),
    '【P0】连续滚轮必须追加剩余增量并派发到 pane（保留朝光标缩放）')
  assert.ok(!cssSource.includes('transition: transform'),
    '【P0】不得用 CSS transform 过渡：内部 viewport 会先跳到终值、画面滞后导致点击错位')
  assert.ok(canvasSource.includes('<LodControl') && canvasSource.includes('lod.revealNode(node.id)'), '控件与搜索临时显示必须接线')
  assert.ok(canvasSource.includes('lod.visibility.selectedNodeIds[0]'), '【P0】pin 目标必须回退到可见性计划派生的选中节点')
  assert.ok(modelSource.includes('getGraphSession(tabId)?.roomPath'), '【P0】房间路径必须走官方会话查询，否则 pin 偏好写不进去')
  assert.ok(modelSource.includes('quantizeLodZoom(nextZoom)') && modelSource.includes('setLodZoom(nextLodZoom)'), '【P0】必须把连续 zoom 量化后再喂给 LOD，不能每帧重算')
  assert.ok(modelSource.includes('rebaseViewport(storedViewport)'), '【P0】重定基必须在模型层完成')
  assert.ok(toolbarSource.includes('formatZoomPercent(zoomLevel)')
    && toolbarSource.includes("from '../../../domain/graph/zoomScale'")
    && !toolbarSource.includes('Math.round(zoomLevel * 100)'), '【P0】百分比显示必须走唯一换算，不得再直乘 100')
  assert.ok(controlSource.includes('data-tm-zoom-control') && controlSource.includes('data-tm-zoom-reset') && controlSource.includes('ZOOM_REFERENCE'), '镜头控件必须提供比例尺读数与 100% 复位')
  assert.ok(controlSource.includes('data-tm-lod-control') && controlSource.includes('data-tm-lod-tier=')
    && controlSource.includes('data-tm-lod-mode={option.value}') && controlSource.includes('data-tm-lod-pin-toggle'), '控件必须暴露可断言的档位/模式/pin 标识')
  assert.ok(controlSource.includes('data-tm-lod-depth-panel')
    && controlSource.includes('data-tm-lod-depth-histogram')
    && controlSource.includes('data-tm-lod-selected-depth')
    && controlSource.includes('visibility.depthLevels')
    && controlSource.includes('visibility.treeMaxDepth'),
  '【P0】左上角控件必须显示每级深度的可见数与当前选中节点的深度')
  assert.ok(lodSource.includes('treeMaxDepth') && lodSource.includes('depthLevels')
    && lodSource.includes('selectedNode') && lodSource.includes('buildHierarchy('),
  '【P0】深度诊断必须由同一份 hierarchy 派生，不得另写一套推断')
  assert.ok(canvasSource.includes('selectedNodeId,') && hookSource.includes('selectedNodeId,')
    && lodSource.includes('externalSelectedId'),
  '【P0】深度诊断与置顶按钮必须共用 graph store 的选中节点来源')
  const depthPanelTag = controlSource.match(/data-tm-lod-depth-panel=""[\s\S]*?className=/)?.[0] ?? ''
  assert.ok(depthPanelTag.includes('data-tm-lod-selected-depth')
    && depthPanelTag.includes('data-tm-lod-selected-kind')
    && depthPanelTag.includes('data-tm-lod-tree-max-depth'),
  '【P0】选中节点深度属性必须挂在层级诊断面板节点本身，GUI 直接读面板节点')
  assert.ok(hookSource.includes('computeLodVisibility(') && hookSource.includes('buildLodHierarchyKey(nodes, edges)'), 'hook 必须复用纯函数层并缓存 hierarchy')
  assert.ok(hookSource.includes('previousVisibleNodeIds') && hookSource.includes('LOD_FADE_MS'), '【P0】hook 必须传入滞回输入并驱动淡入淡出')
  assert.ok(hookSource.includes('applyLodNodeHidden') && hookSource.includes('applyLodEdgeHidden'), 'hook 必须只派发 hidden')
  assert.ok(cssSource.includes('@keyframes tm-lod-enter') && cssSource.includes('@keyframes tm-lod-exit'),
    '【P0】渐显 / 渐隐两个关键帧都必须在全局样式里')
  assert.ok(lodSource.includes('tm-lod-exit') && lodSource.includes('LOD_FADE_MS') && lodSource.includes('revealRatioForRank'),
    '【P0】渐隐渐显与按节点数分位数的阈值必须由纯函数层统一产出')
  assert.ok(lodSource.includes('exitOrder') && lodSource.includes('lodRatio <= LOD_FLOOR_RATIO')
    && lodSource.includes('Math.max(LOD_FLOOR_RATIO, ratio)')
    && lodSource.includes('ratio >= LOD_FLOOR_RATIO && ratio < LOD_FULL_RATIO'),
    '【P0】必须保留退场序列、渐隐终点强制只剩骨架；紧凑区可见集合冻结且跳过碰撞抽稀')
  assert.ok(lodSource.includes('LOD_DEFAULT_PRESERVED_DEPTH') && lodSource.includes('normalizePreservedDepth')
    && lodSource.includes('skeletonIds')
    && lodSource.includes('skeletonIds.has(id)) return true')
    && lodSource.includes('...skeletonIds, ...forced')
    && lodSource.includes('freeIds.has(id) || rootIds.has(id)'),
    '【自定义永久层数】depth <= N 的全部树节点必须恒定显示并进入碰撞保护，游离节点不得混入')
  assert.ok(controlSource.includes('data-tm-lod-visible-depth-levels={visibility.visibleDepthLevelCount}'),
    '【默认两层】控件必须暴露可见深度层数供 GUI 实测')
  assert.ok(controlSource.includes('data-tm-lod-preserved-depth-select')
    && controlSource.includes('onPreservedDepthChange(Number(event.target.value))')
    && controlSource.includes('LOD_MAX_PRESERVED_DEPTH')
    && controlSource.includes('data-tm-lod-preserved-depth={visibility.preservedDepth}'),
    '【自定义永久层数】左侧状态面板必须提供可随时变更的层数下拉，并暴露生效层数')
  assert.ok(hookSource.includes('preservedDepth: prefs.preservedDepth')
    && hookSource.includes('prefs.preservedDepth,')
    && hookSource.includes('setPreservedDepth: setLodPreservedDepth')
    && prefsSource.includes('export function setLodPreservedDepth')
    && prefsSource.includes('normalizePreservedDepth(value.preservedDepth)')
    && canvasSource.includes('onPreservedDepthChange={lod.setPreservedDepth}'),
    '【自定义永久层数】偏好变更必须进 signature 立即重算、持久化并接到控件回调')
  assert.ok(controlSource.includes('ZOOM_TRANSITION_MS'), '【P0】按钮 / 复位过渡时长必须来自唯一规则源')
  assert.ok(prefsSource.includes('topomind_semantic_lod_preferences_v1') && prefsSource.includes('prunePinned'), '偏好必须持久化且可剪枝')
  assert.equal(lodSource.includes('writeConfig') || lodSource.includes('window.api'), false, '【P0】LOD 纯函数层不得写盘 / 不得碰 IPC')

  // 13) 【P1 几何重叠压力，2026-11-09】节点屏幕尺寸恒定后，缝隙收拢与边缘渐隐
  //     应由真实布局的拥挤程度驱动，而不是继续按固定分位匀速隐藏。
  //     真跑纯函数 + 真跑带坐标的 computeLodVisibility，验证「节奏变了、铁律没变」。
  const pm = await loadBundled('../src/domain/graph/lodPressure.ts')
  const {
    LOD_PRESSURE_WEIGHT, LOD_PRESSURE_SOFTNESS, LOD_PRESSURE_STEP,
    collectNodeSpacings, overlapPressureForRatio, lodProgressForRatio,
    buildLodPressureCurve,
  } = pm
  const bounds = { fullRatio: LOD_FULL_RATIO, floorRatio: LOD_FLOOR_RATIO }
  assert.ok(LOD_PRESSURE_WEIGHT > 0 && LOD_PRESSURE_WEIGHT < 0.5,
    '【P1】几何项必须有界，否则单步隐藏量会失控（禁阶段性排班）')
  assert.ok(LOD_PRESSURE_SOFTNESS > 0.5, '【P1】重叠贡献必须平滑过渡，禁止硬阈值成批跳变')
  assert.equal(LOD_PRESSURE_STEP, LOD_ZOOM_QUANTUM, '【P1】压力查找表步长必须与 LOD 2% 台阶对齐')
  assert.equal(lod.LOD_PRESSURE_PHASES, undefined, '【P1】不得引入「渐隐段/紧凑段」硬编码阶段表')
  assert.equal(collectNodeSpacings([]).length, 0, '无坐标时不得凭空造出压力')
  assert.equal(collectNodeSpacings([{ x: 0, y: 0 }, { x: 10, y: 0 }]).length, 0, '节点 <3 个时退回恒等')

  // 单尺度均匀网格：最近邻间距恒为 200。
  const gridPoints = Array.from({ length: 36 }, (_, i) => ({ x: (i % 6) * 200, y: Math.floor(i / 6) * 200 }))
  const gridSpacings = collectNodeSpacings(gridPoints)
  assert.equal(gridSpacings.length, 36)
  assert.ok(gridSpacings.every((d: number) => Math.abs(d - 200) < 1e-9), '【P1】空间哈希必须求出真实最近邻间距')
  // 多尺度布局：31 对节点，对间距循环 100 / 200 / 400，对间 y 相隔 1000。
  // 三种尺度让重叠过渡铺满整段行程，与单尺度网格的节奏明显不同。
  const pairSpacings = [100, 200, 400]
  const multiPoints = Array.from({ length: 62 }, (_, i) => {
    const pair = Math.floor(i / 2)
    return { x: i % 2 === 0 ? 0 : pairSpacings[pair % 3], y: pair * 1000 }
  })
  const multiSpacings = collectNodeSpacings(multiPoints)
  assert.equal(multiSpacings.length, 62)
  assert.ok(new Set(multiSpacings.map((d: number) => Math.round(d))).size >= 3,
    '【P1】测试布局必须真的含有多尺度间距')

  // 单调性 / 两端固定 / 有界偏离：三项都是「不能自我震荡、不能骤降」的硬约束。
  for (const spacings of [gridSpacings, multiSpacings]) {
    let previousOverlap = -Infinity
    let previousProgress = Infinity
    for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
      const overlap = overlapPressureForRatio(ratio, spacings, bounds)
      assert.ok(overlap >= previousOverlap - 1e-9, '【P1】缩小过程中重叠压力不得回落')
      previousOverlap = overlap
      const progress = lodProgressForRatio(ratio, spacings, bounds)
      assert.ok(progress <= previousProgress + 1e-9, '【P1】行程进度必须单调，放大时永不取消已显示节点')
      previousProgress = progress
    }
    assert.ok(Math.abs(lodProgressForRatio(1, spacings, bounds) - 1) < 1e-9, '【P1】100% 必须仍是全显示端点')
    assert.ok(Math.abs(lodProgressForRatio(0.2, spacings, bounds) - 0.2) < 1e-9, '【P1】20% 必须仍是渐隐终点')
  }
  const identity = buildLodPressureCurve([], bounds)
  assert.equal(identity.active, false, '无坐标时必须完全退回旧的按节点数分位节奏')
  for (const p of [1, 0.9, 0.7, 0.5, 0.3]) assert.equal(identity.ratioFor(p), p)
  const gridCurve = buildLodPressureCurve(gridPoints, bounds)
  const multiCurve = buildLodPressureCurve(multiPoints, bounds)
  assert.ok(gridCurve.active && multiCurve.active)
  assert.equal(gridCurve.sampleCount, 36)
  assert.equal(multiCurve.sampleCount, 62)
  for (const curve of [gridCurve, multiCurve]) {
    assert.equal(curve.ratioFor(1), 1)
    assert.equal(curve.ratioFor(0.2), 0.2)
    let previous = Infinity
    for (const p of [0.98, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.32]) {
      const ratio = curve.ratioFor(p)
      assert.ok(ratio <= previous + 1e-9, '【P1】阈值求逆必须保持单调（退场顺序不变）')
      assert.ok(Math.abs(ratio - p) <= 0.7 * LOD_PRESSURE_WEIGHT + 0.02,
        '【P1】几何重参数化偏离必须有界，否则单步隐藏会骤增')
      assert.ok(Math.abs(curve.progressFor(ratio) - p) < 0.02, '【P1】求逆必须与进度曲线自洽')
      previous = ratio
    }
  }
  // 核心语义：相同分位阈值，不同布局应落到不同真实倍率 —— 这就是地图式节奏。
  let layoutSensitive = false
  for (const p of [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4]) {
    if (Math.abs(gridCurve.ratioFor(p) - multiCurve.ratioFor(p)) > 0.02) { layoutSensitive = true; break }
  }
  assert.ok(layoutSensitive, '【P1】渐隐节奏必须随真实布局改变，不能仍是与坐标无关的匀速分位')

  // 真跑 computeLodVisibility：带坐标的偏斜树与不带坐标的同图，节奏必须不同，
  // 但 100% / 20% / 单调 / 小步 / 树根保护这些既有铁律一个都不能破。
  // 【P1.9 隔离变量】本组只验证「几何压力改变渐隐节奏」，因此坐标按真实卡片尺寸
  // 拉开到绝不会碰撞的间距（x×5 + 显式 width/height）。密集布局下的碰撞抽稀
  // 由第 16 组独立构造验证，避免把两个能力混在同一条曲线上断言。
  const positionedNodes = skewedNodes.map((node, index) => ({
    ...node,
    position: { x: multiPoints[index].x * 5, y: multiPoints[index].y },
    width: 80,
    height: 36,
  }))
  const geometricFull = computeLodVisibility({ nodes: positionedNodes, edges: skewedEdges, zoom: ZOOM_REFERENCE })
  const plainFull = computeLodVisibility({ nodes: skewedNodes, edges: skewedEdges, zoom: ZOOM_REFERENCE })
  assert.equal(geometricFull.pressureActive, true, '【P1】真实图谱带坐标必须启用几何压力')
  assert.equal(geometricFull.pressureSampleCount, positionedNodes.length)
  assert.equal(plainFull.pressureActive, false, '【P1】无坐标构造必须恒等退回')
  assert.equal(plainFull.pressureSampleCount, 0)
  assert.equal(geometricFull.hiddenNodeIds.size, 0, '【P1】100% 端点不得被压力曲线提前藏节点')
  const geometricTiny = computeLodVisibility({ nodes: positionedNodes, edges: skewedEdges, zoom: MIN_RAW_ZOOM })
  assert.deepEqual([...geometricTiny.visibleNodeIds], ['sr', 'sa'], '【保底两层】P1 的 20% 端点仍保留树根 + 一级主干')
  let rhythmDiffers = false
  for (let ratio = 0.95; ratio >= 0.35; ratio -= 0.05) {
    const a = computeLodVisibility({ nodes: positionedNodes, edges: skewedEdges, zoom: ratio * ZOOM_REFERENCE })
    const b = computeLodVisibility({ nodes: skewedNodes, edges: skewedEdges, zoom: ratio * ZOOM_REFERENCE })
    if (a.visibleNodeIds.size !== b.visibleNodeIds.size) { rhythmDiffers = true; break }
  }
  assert.ok(rhythmDiffers, '【P1】真实布局必须改变「哪些倍率隐藏多少」，而不是只改内部字段')
  // 稀疏布局下压力曲线在 100% 端点附近非常平缓，只取第一个叶子（rank≈0）会把
  // 差异压到 1e-6 量级；取首/中/末三个 rank 才能真正验证「诊断读的是同一条曲线」。
  const diagnosticDiffs = ['sl0', 'sl30', 'sl59'].map((nodeId) => {
    const a = computeLodVisibility({ nodes: positionedNodes, edges: skewedEdges, zoom: ZOOM_REFERENCE, selectedNodeId: nodeId })
    const b = computeLodVisibility({ nodes: skewedNodes, edges: skewedEdges, zoom: ZOOM_REFERENCE, selectedNodeId: nodeId })
    return Math.abs((a.selectedNode?.revealRatio as number) - (b.selectedNode?.revealRatio as number))
  })
  assert.ok(Math.max(...diagnosticDiffs) > 1e-4,
    `【P1】诊断阈值必须来自同一条压力曲线，不能与裁剪各说一套（${diagnosticDiffs.map((d) => d.toExponential(2)).join('/')}）`)
  let pressurePrevious: Set<string> | undefined
  const pressureCounts: number[] = []
  for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const step = computeLodVisibility({
      nodes: positionedNodes, edges: skewedEdges, zoom: ratio * ZOOM_REFERENCE,
      previousVisibleNodeIds: pressurePrevious,
    })
    pressureCounts.push(step.visibleNodeIds.size)
    pressurePrevious = step.visibleNodeIds
  }
  assert.equal(pressureCounts[0], positionedNodes.length)
  assert.equal(pressureCounts[pressureCounts.length - 1], 2, '【保底两层】带几何压力时 20% 端点仍保留两层')
  const pressureDrops = pressureCounts.slice(1).map((count, i) => pressureCounts[i] - count)
  for (let i = 1; i < pressureCounts.length; i += 1) {
    assert.ok(pressureCounts[i] <= pressureCounts[i - 1], '【P1】带几何压力时缩小仍不得让节点回升')
  }
  assert.ok(Math.max(...pressureDrops) <= 6,
    `【P1】几何重参数化后单步隐藏仍必须有界（实际最大 ${Math.max(...pressureDrops)}）`)
  assert.ok(pressureDrops.filter((drop: number) => drop > 0).length >= 20, '【P1】隐藏仍须摊到整段行程')

  assert.ok(lodSource.includes('buildLodPressureCurve(') && lodSource.includes('pressure.ratioFor('),
    '【P1】LOD 必须把分位阈值经压力曲线求逆，不能只算不用')
  assert.ok(lodSource.includes('nodes.map((node) => node.position)'), '【P1】压力曲线必须消费真实 flow 坐标')
  assert.ok(lodSource.includes('pressureActive')
    && controlSource.includes("data-tm-lod-pressure={visibility.pressureActive ? 'on' : 'off'}")
    && controlSource.includes('data-tm-lod-pressure-samples={visibility.pressureSampleCount}'),
  '【P1】控件必须同时暴露压力开关与样本数，供 GUI 实测')
  assert.ok(!hookSource.includes('position') || hookSource.includes('buildLodHierarchyKey(nodes, edges)'),
    '【P1】拖动改坐标不得进 hierarchy 签名（否则每帧重建整树）')

  // 14) 【P1.5 远景字形放大 × 重叠压力，2026-11-09】节点变大必须让 LOD 知道，
  //     否则「主干更清晰」会退化成「一堆互相压住的大方块」。
  const zsFar = await loadBundled('../src/domain/graph/zoomScale.ts')
  const { glyphScaleForRatio: farGlyphScale } = zsFar
  const glyphBounds = { ...bounds, glyphScaleForRatio: farGlyphScale }
  const gridFar = buildLodPressureCurve(gridPoints, glyphBounds)
  const multiFar = buildLodPressureCurve(multiPoints, glyphBounds)
  assert.ok(gridFar.glyphAware && multiFar.glyphAware,
    '【P1.5】真实布局的压力曲线必须标记已计入字形放大')
  assert.equal(identity.glyphAware, false, '【P1.5】无坐标恒等退回时不得谎报字形感知')
  assert.equal(gridCurve.glyphAware, false, '【P1.5】不传字形函数时必须逐值保持旧行为')
  // 同一 ratio 下，计入字形放大后的重叠需求分子更大 → 压力不得下降。
  for (const ratio of [0.95, 0.9, 0.8, 0.7, 0.6, 0.45, 0.3]) {
    const plain = overlapPressureForRatio(ratio, gridSpacings, bounds)
    const aware = overlapPressureForRatio(ratio, gridSpacings, glyphBounds)
    assert.ok(aware >= plain - 1e-9, '【P1.5】节点变大不得让重叠压力反而下降')
  }
  assert.ok(overlapPressureForRatio(0.8, gridSpacings, glyphBounds)
    > overlapPressureForRatio(0.8, gridSpacings, bounds) + 1e-4,
  '【P1.5】中景必须真的因字形放大而更拥挤')
  // 铁律不破：单调、两端固定、有界偏离。
  for (const curve of [gridFar, multiFar]) {
    assert.equal(curve.ratioFor(1), 1)
    assert.equal(curve.ratioFor(0.2), 0.2)
    let previous = Infinity
    for (const p of [0.98, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.32]) {
      const ratio = curve.ratioFor(p)
      assert.ok(ratio <= previous + 1e-9, '【P1.5】字形放大不得破坏阈值单调')
      assert.ok(Math.abs(ratio - p) <= 0.7 * LOD_PRESSURE_WEIGHT + 0.03,
        '【P1.5】字形放大不得让单步隐藏失控')
      previous = ratio
    }
  }
  // 核心因果：压力更高 → 同一分位阈值出现在更靠近 100% 的位置 → 渐隐提前。
  let earlierHide = false
  for (const p of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4]) {
    if (gridFar.ratioFor(p) > gridCurve.ratioFor(p) + 1e-4
      || multiFar.ratioFor(p) > multiCurve.ratioFor(p) + 1e-4) { earlierHide = true; break }
  }
  assert.ok(earlierHide, '【P1.5】字形放大必须让渐隐提前，否则节点会挤成一堆')
  // 真跑 computeLodVisibility：字形感知只在真实坐标下开启，两端保护不变。
  assert.equal(geometricFull.pressureGlyphAware, true, '【P1.5】真实图谱必须启用字形感知压力')
  assert.equal(plainFull.pressureGlyphAware, false, '【P1.5】无坐标构造必须恒等退回')
  assert.equal(geometricFull.hiddenNodeIds.size, 0, '【P1.5】100% 端点不得因字形放大提前藏节点')
  assert.deepEqual([...geometricTiny.visibleNodeIds], ['sr', 'sa'], '【保底两层】P1.5 的 20% 端点仍保留两层')
  assert.ok(Math.max(...pressureDrops) <= 6,
    `【P1.5】计入字形放大后单步隐藏仍必须有界（实际最大 ${Math.max(...pressureDrops)}）`)

  const lodPressureSource = await readFile(new URL('../src/domain/graph/lodPressure.ts', import.meta.url), 'utf-8')
  assert.ok(/glyphScaleForRatio,\s*\}/.test(lodSource),
    '【P1.5】LOD 必须把字形倍率函数真正传给压力曲线（不是只 import 不用）')
  assert.ok(lodPressureSource.includes('base * glyph / safeRatio'),
    '【P1.5】重叠需求必须计入远景字形放大')
  assert.ok(controlSource.includes('data-tm-lod-pressure-glyph={visibility.pressureGlyphAware'),
    '【P1.5】控件必须暴露压力是否感知字形，供 GUI 实测')

  // 15) 【P1.75 折叠子树计数徽标，2026-11-09】远景只留主干时，主干卡片要显示「底下收了多少」。
  //     真跑纯函数 + computeLodVisibility 集成 + 运行时 store 数据往返 + 源码接线守卫。
  const { computeCollapsedCounts: collapseCounts } = lod
  const ch = await loadBundled('../src/domain/graph/graphHierarchy.ts')
  const { hierarchy: collapseTree } = ch.buildHierarchy(
    treeNodes.map((node: { id: string }) => node.id), treeEdges,
  )
  const asSet = (...ids: string[]) => new Set(ids)
  assert.equal(collapseCounts(collapseTree, asSet('root', 'c1', 'c2', 'g1', 'free1', 'free2'), asSet()).size, 0,
    '【P1.75】没有隐藏节点时不得产生任何徽标')
  const rootOnly = collapseCounts(collapseTree, asSet('root'), asSet('c1', 'c2', 'g1', 'free1', 'free2'))
  assert.equal(rootOnly.get('root'), 3, '【P1.75】只剩树根时，三个下级节点必须全部折进树根')
  assert.equal([...rootOnly.values()].reduce((a: number, b: number) => a + b, 0), 3,
    '【P1.75】游离节点不得冒充树根的下级')
  const branchVisible = collapseCounts(collapseTree, asSet('root', 'c1'), asSet('c2', 'g1', 'free1', 'free2'))
  assert.equal(branchVisible.get('c1'), 1, '【P1.75】中间节点仍可见时，计数必须落在中间节点')
  assert.equal(branchVisible.get('root'), 1, '【P1.75】树根只收自己直接折掉的下级')
  assert.equal([...branchVisible.values()].reduce((a: number, b: number) => a + b, 0), 2,
    '【P1.75】同一隐藏节点不得被祖先链上的每个节点重复计数')
  const orphanParent = collapseCounts(collapseTree, asSet('c1'), asSet('root', 'c2', 'g1', 'free1', 'free2'))
  assert.equal(orphanParent.get('c1'), 1, '【P1.75】父节点已隐藏时，计数不能挂到隐藏节点上')
  assert.equal(orphanParent.get('root'), undefined, '【P1.75】隐藏节点不得成为徽标持有者')
  // 脏数据成环也不能死循环（seen + 深度上限双保护）。
  const cyclicHierarchy = {
    nodes: ['a', 'b', 'c'],
    parentEdge: new Map([
      ['a', { id: 'x1', source: 'b', target: 'a' }],
      ['b', { id: 'x2', source: 'a', target: 'b' }],
    ]),
    children: new Map(), depth: new Map(), roots: [], free: [], subordinateEdges: [],
  }
  assert.equal(collapseCounts(cyclicHierarchy, asSet('c'), asSet('a', 'b')).size, 0,
    '【P1.75】父链成环必须安全退出且不产生计数')

  // 集成：100% 无徽标；20% 默认两层全保后，只有 depth 3 的 g1 折进 c1，游离单列。
  assert.equal(full.collapsedTotal, 0, '【P1.75】100% 全图可见时不得有折叠徽标')
  assert.equal(full.collapsedCounts.size, 0)
  assert.equal(full.collapsedFreeCount, 0)
  assert.equal(tiny.collapsedCounts.get('root') ?? 0, 0,
    '【默认两层】c2 也常驻，树根名下没有折起的下级（不能重复计数）')
  assert.equal(tiny.collapsedCounts.get('c1'), 1, '【默认两层】g1 折进仍可见的一级主干 c1')
  assert.equal(tiny.collapsedTotal, 1)
  assert.equal(tiny.collapsedFreeCount, 2, '【P1.75】游离节点必须单独计数，不能塞进卡片徽标')
  // 50%：游离先走、g1 已藏但 c1 还在 → +1 只能落在 c1，树根必须是 0（不重复计数）。
  // 渐隐终点由 30% 收到 20% 后，g1 的阈值从 65% 变成 60%，构造点相应下移。
  const branchSnapshot = computeLodVisibility({ ...base, zoom: 0.5 * ZOOM_REFERENCE })
  assert.ok(branchSnapshot.hiddenNodeIds.has('g1') && branchSnapshot.visibleNodeIds.has('c1'),
    '【P1.75】50% 必须是「中间节点仍可见、深层已隐藏」的构造')
  assert.equal(branchSnapshot.collapsedCounts.get('c1'), 1, '【P1.75】+1 必须挂在最近的可见祖先 c1')
  assert.equal(branchSnapshot.collapsedCounts.get('root') ?? 0, 0,
    '【P1.75】祖先链不得重复计数（树根此时必须是 0）')
  assert.equal(branchSnapshot.collapsedTotal, 1)
  assert.equal(branchSnapshot.collapsedFreeCount, 2)
  let previousCollapsed = -1
  for (let ratioStep = 1; ratioStep >= 0.2 - 1e-9; ratioStep -= 0.02) {
    const step = computeLodVisibility({ ...base, zoom: ratioStep * ZOOM_REFERENCE })
    assert.equal(step.collapsedTotal + step.collapsedFreeCount, step.hiddenNodeIds.size,
      '【P1.75】折叠合计 + 游离合计必须恰好等于隐藏节点数')
    assert.ok(step.collapsedTotal <= step.hiddenNodeIds.size)
    assert.ok([...step.collapsedCounts.keys()].every((id: string) => step.visibleNodeIds.has(id)),
      '【P1.75】徽标只能挂在可见节点上')
    assert.ok(step.collapsedTotal >= previousCollapsed, '【P1.75】越缩小，折叠数不得反向变少')
    previousCollapsed = step.collapsedTotal
  }

  // 运行时 store 数据往返：按 nodeId 精确通知、换房间作废旧 scope、清理只清当前 scope。
  const collapseStore = await loadBundled('../src/features/graph/GraphCanvas/model/lodCollapseStore.ts')
  const {
    publishCollapsedCounts, clearCollapsedCounts,
    subscribeCollapsedCount, getCollapsedCount,
  } = collapseStore
  const notified: string[] = []
  const unsubscribeA = subscribeCollapsedCount('a', () => notified.push('a'))
  const unsubscribeB = subscribeCollapsedCount('b', () => notified.push('b'))
  publishCollapsedCounts('room-1', new Map([['a', 2], ['b', 1]]))
  assert.equal(getCollapsedCount('a'), 2)
  assert.equal(getCollapsedCount('b'), 1)
  assert.equal(getCollapsedCount('c'), 0)
  assert.deepEqual(notified.slice().sort(), ['a', 'b'], '【P1.75】发布必须通知到计数变化的卡片')
  notified.length = 0
  publishCollapsedCounts('room-1', new Map([['a', 3], ['b', 1]]))
  assert.deepEqual(notified, ['a'], '【P1.75】计数未变的卡片不得被广播重渲染')
  notified.length = 0
  publishCollapsedCounts('room-2', new Map([['x', 7]]))
  assert.equal(getCollapsedCount('a'), 0, '【P1.75】换房间必须作废旧房间的计数')
  assert.ok(notified.includes('a') && notified.includes('b'))
  assert.equal(getCollapsedCount('x'), 7)
  clearCollapsedCounts('room-1')
  assert.equal(getCollapsedCount('x'), 7, '【P1.75】清理旧 scope 不得误清当前房间')
  clearCollapsedCounts('room-2')
  assert.equal(getCollapsedCount('x'), 0)
  // 顺序铁律：通知监听器时快照必须已经是新值。useSyncExternalStore 会在通知当场
  // 读 getSnapshot；先通知后写会让 React 判定「快照没变」并丢掉这次重渲染。
  const observed: number[] = []
  const unsubscribeObserved = subscribeCollapsedCount('obs', () => observed.push(getCollapsedCount('obs')))
  publishCollapsedCounts('room-order', new Map([['obs', 4]]))
  assert.deepEqual(observed, [4], '【P1.75】通知时 store 快照必须已更新，否则徽标会漏更新')
  publishCollapsedCounts('room-order', new Map([['obs', 9]]))
  assert.deepEqual(observed, [4, 9], '【P1.75】连续缩放每一格都必须读到当格的新计数')
  unsubscribeObserved()
  unsubscribeA()
  unsubscribeB()

  const collapseStoreSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/lodCollapseStore.ts', import.meta.url), 'utf-8')
  const collapseCardSource = await readFile(new URL('../src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx', import.meta.url), 'utf-8')
  const collapseCssSource = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf-8')
  assert.ok(lodSource.includes('computeCollapsedCounts(hierarchy, visibleNodeIds, hiddenNodeIds)'),
    '【P1.75】computeLodVisibility 必须真跑折叠计数，不是只导出函数')
  assert.ok(lodSource.includes('hierarchy.parentEdge.get(cursor)?.source')
    && lodSource.includes('chain.length <= MAX_HIERARCHY_DEPTH'),
  '【P1.75】必须沿从属父链上溯且带防环 / 深度保护')
  assert.ok(!collapseStoreSource.includes('localStorage(')
    && !collapseStoreSource.includes('persist(') && !collapseStoreSource.includes('createJSONStorage('),
  '【P1.75】折叠计数是派生渲染信息，绝不落盘')
  assert.ok(!collapseStoreSource.includes('node.data') && !collapseStoreSource.includes('.data ='),
    '【P1.75】折叠计数不得写节点 data（绕开 7 处字段白名单）')
  assert.ok(collapseStoreSource.indexOf('activeCounts = next') > 0
    && collapseStoreSource.indexOf('activeCounts = next') < collapseStoreSource.indexOf('notifyChanges(previous, next)'),
  '【P1.75】必须先写快照再通知，否则 useSyncExternalStore 会读到旧值并丢弃重渲染')
  assert.ok(hookSource.includes('publishCollapsedCounts(roomPath, visibility.collapsedCounts)')
    && hookSource.includes('clearCollapsedCounts(roomPath)'),
  '【P1.75】画布必须按房间发布计数并在卸载时清理')
  assert.ok(collapseCardSource.includes('useSyncExternalStore')
    && collapseCardSource.includes('subscribeCollapsedCount(nodeId, listener)')
    && collapseCardSource.includes('getCollapsedCount(nodeId)')
    && collapseCardSource.includes('<LodCollapseBadge nodeId={id} />')
    && collapseCardSource.includes('data-tm-lod-collapse-badge={nodeId}')
    && collapseCardSource.includes('data-tm-lod-collapse-count={count}'),
  '【P1.75】卡片必须按 nodeId 精确订阅并渲染 +N 徽标')
  assert.ok(collapseCssSource.includes('.tm-lod-collapse-badge')
    && collapseCssSource.includes('max(0.55, calc(1 - var(--tm-detail-alpha, 1)))')
    && collapseCssSource.includes('pointer-events: none;'),
  '【P1.75】徽标必须随细节淡出而渐显、且不吃鼠标事件')
  assert.ok(controlSource.includes('data-tm-lod-collapsed-total={visibility.collapsedTotal}')
    && controlSource.includes('data-tm-lod-collapsed-free={visibility.collapsedFreeCount}')
    && controlSource.includes('data-tm-lod-collapsed-holders={visibility.collapsedCounts.size}'),
  '【P1.75】控件必须暴露折叠统计供 GUI 实测')
  // 字段白名单守卫：新增计数不得渗进任何落盘 / mapper 层。
  const whitelistFiles = [
    'src/types/graph.ts', 'src/domain/graph/model.ts', 'src/domain/graph/graphMapper.ts',
    'src/domain/graph/normalizeGraphMeta.ts', 'src/core/storage/file.ts',
    'src/core/fs-backend.ts', 'src/hooks/useGraph/graphBuilder.ts',
  ]
  for (const file of whitelistFiles) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf-8')
    assert.ok(!source.includes('collapsedCount'),
      `【P1.75】${file} 不得出现折叠计数字段（不得污染节点字段白名单）`)
  }
}

// --- 【P1.9】碰撞感知的 LOD 硬约束：紧凑到重叠就渐隐（2026-11-09） ---
// 铁律：只查源码字面量不够，必须 esbuild 打包真跑纯函数 + computeLodVisibility 集成，
// 并用 GUI 的真实 DOM AABB 断言守住「缩放后节点不再重合」。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundled = async (relative: string) => {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      banner: { js: 'globalThis.window = globalThis.window || {};' },
    })
    return await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  }
  const cm = await loadBundled('../src/domain/graph/lodCollision.ts')
  const lm = await loadBundled('../src/domain/graph/lod.ts')
  const zm = await loadBundled('../src/domain/graph/zoomScale.ts')
  const compensationAt = (ratio: number) => zm.glyphCompensationForZoom(ratio * zm.ZOOM_REFERENCE)

  // 1) 100% 恒等 / 85% 完全生效 / 全程单调 / 盒倍数与 guard 同源。
  assert.equal(cm.collisionGuardForRatio(1), 0, '【P1.9】100% 必须完全不裁剪（用户手摆的重叠保持原样）')
  assert.equal(cm.collisionGuardForRatio(1.2), 0)
  assert.equal(cm.collisionGuardForRatio(0.85), 1)
  assert.equal(cm.collisionGuardForRatio(0.3), 1)
  let guardPrevious = -1
  for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const guard = cm.collisionGuardForRatio(ratio)
    assert.ok(guard >= guardPrevious - 1e-9, '【P1.9】缩小过程中碰撞约束强度不得回落')
    guardPrevious = guard
  }
  assert.equal(cm.collisionBoxScaleFor(4.33, 0), 1, '【P1.9】guard=0 时盒尺寸必须是锚点壳原尺寸')
  assert.equal(cm.collisionBoxScaleFor(4.33, 1), 4.33)
  assert.ok(cm.collisionBoxScaleFor(4.33, 0.5) < 4.33 && cm.collisionBoxScaleFor(4.33, 0.5) > 1)

  // 2) 密集构造：一排贴在一起的卡片（80×36，间距 40），树根受保护。
  const denseNodes = [
    { id: 'root', position: { x: 0, y: 0 }, width: 80, height: 36 },
    { id: 'a', position: { x: 40, y: 0 }, width: 80, height: 36 },
    { id: 'b', position: { x: 80, y: 0 }, width: 80, height: 36 },
    { id: 'c', position: { x: 120, y: 0 }, width: 80, height: 36 },
    { id: 'd', position: { x: 160, y: 0 }, width: 80, height: 36 },
  ]
  const denseIds = new Set(denseNodes.map((node) => node.id))
  const denseChildren = new Map<string, readonly string[]>([['root', ['a', 'b', 'c', 'd']]])
  const denseOptions = (ratio: number) => ({
    ratio,
    compensation: compensationAt(ratio),
    protectedIds: new Set(['root']),
    priority: ['root', 'a', 'b', 'c', 'd'],
    children: denseChildren,
    maxDepth: 100,
  })
  const denseFull = cm.resolveLodCollisions(denseNodes, denseIds, denseOptions(1))
  assert.equal(denseFull.hiddenIds.size, 0, '【P1.9】100% 端点不得因碰撞裁掉任何节点')
  assert.equal(denseFull.active, false)
  const denseMid = cm.resolveLodCollisions(denseNodes, denseIds, denseOptions(0.5))
  assert.ok(denseMid.active && denseMid.hiddenIds.size > 0, '【P1.9】远景密集布局必须真的抽稀')
  assert.ok(!denseMid.hiddenIds.has('root'), '【P1.9】树根恒定保留，不能被碰撞裁掉')
  const denseKept = new Set([...denseIds].filter((id) => !denseMid.hiddenIds.has(id)))
  assert.ok(cm.countOverlapPairs(denseNodes, denseIds, denseMid.boxScale) > 0,
    '【P1.9】构造必须真的发生过重叠，否则后续断言是空跑')
  assert.equal(cm.countOverlapPairs(denseNodes, denseKept, denseMid.boxScale), 0,
    '【P1.9】裁剪后保留节点的放大盒必须两两不重叠')

  // 3) 单调：已因碰撞收起的节点不能在继续缩小时又回来（不自激震荡）。
  let previousHidden = new Set<string>()
  for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const step = cm.resolveLodCollisions(denseNodes, denseIds, denseOptions(ratio))
    for (const id of previousHidden) {
      assert.ok(step.hiddenIds.has(id),
        `【P1.9】碰撞抽稀必须单调，不允许已收起的节点又出现（ratio=${ratio.toFixed(2)} gone=${id} prev=${[...previousHidden].join(',')} now=${[...step.hiddenIds].join(',')} box=${step.boxScale.toFixed(3)}）`)
    }
    previousHidden = step.hiddenIds
  }

  // 4) 断链保护：父被裁时整棵子树一起裁；用户强制显示是唯一例外。
  const chainNodes = [
    { id: 'root', position: { x: 0, y: 0 }, width: 80, height: 36 },
    { id: 'p', position: { x: 40, y: 0 }, width: 80, height: 36 },
    { id: 'leaf', position: { x: 600, y: 600 }, width: 80, height: 36 },
  ]
  const chainIds = new Set(['root', 'p', 'leaf'])
  const chainChildren = new Map<string, readonly string[]>([['root', ['p']], ['p', ['leaf']]])
  const chainBase = {
    ratio: 0.5,
    compensation: compensationAt(0.5),
    priority: ['root', 'p', 'leaf'],
    children: chainChildren,
    maxDepth: 100,
  }
  const chainResult = cm.resolveLodCollisions(chainNodes, chainIds, {
    ...chainBase, protectedIds: new Set(['root']),
  })
  assert.ok(chainResult.hiddenIds.has('p'), '【P1.9】贴着树根的父节点应被抽稀')
  assert.ok(chainResult.hiddenIds.has('leaf'),
    '【P1.9】父被裁必须连带裁掉整棵子树，即便子节点在远处不重叠')
  const forcedChain = cm.resolveLodCollisions(chainNodes, chainIds, {
    ...chainBase, protectedIds: new Set(['root', 'leaf']),
  })
  assert.ok(!forcedChain.hiddenIds.has('leaf'), '【P1.9】pin / 选中等强制显示优先于碰撞避让')

  // 4b) 强制保留节点即使与**普通**节点重叠也不得被裁（保护优先级 > 视觉避让）。
  // 这条专门守住 `!isProtected` 判定：树根总排第一、前面没有障碍，只测树根会漏抓。
  const protectNodes = [
    { id: 'x', position: { x: 0, y: 0 }, width: 80, height: 36 },
    { id: 'p', position: { x: 40, y: 0 }, width: 80, height: 36 },
    { id: 'q', position: { x: 400, y: 400 }, width: 80, height: 36 },
  ]
  const protectResult = cm.resolveLodCollisions(protectNodes, new Set(['x', 'p', 'q']), {
    ratio: 0.5,
    compensation: compensationAt(0.5),
    protectedIds: new Set(['p']),
    priority: ['x', 'p', 'q'],
    children: new Map(),
    maxDepth: 100,
  })
  assert.ok(protectResult.hiddenIds.has('x') === false && !protectResult.hiddenIds.has('p'),
    '【P1.9】强制保留节点即便与普通节点重叠也不得被裁')
  assert.equal(protectResult.protectedOverlapPairs, 0)

  // 5) 稀疏布局 / 无坐标：必须安全退回，不误裁。
  const sparseNodes = [
    { id: 'root', position: { x: 0, y: 0 }, width: 80, height: 36 },
    { id: 'a', position: { x: 900, y: 900 }, width: 80, height: 36 },
  ]
  assert.equal(cm.resolveLodCollisions(sparseNodes, new Set(['root', 'a']), denseOptions(0.3)).hiddenIds.size, 0,
    '【P1.9】稀疏布局不该触发抽稀')
  const noPosition = [{ id: 'root' }, { id: 'a' }]
  assert.equal(cm.resolveLodCollisions(noPosition, new Set(['root', 'a']), denseOptions(0.3)).hiddenIds.size, 0,
    '【P1.9】无坐标构造必须退回恒等（回归脚本最小构造逐值不变）')

  // 6) 集成真跑：computeLodVisibility 必须消费碰撞结果，且全程树根 / 父子链 / 无重叠。
  const ciNodes = [
    { id: 'cr', position: { x: 0, y: 0 }, width: 80, height: 36 },
    { id: 'cp', position: { x: 100, y: 0 }, width: 80, height: 36 },
    { id: 'cl0', position: { x: 40, y: 40 }, width: 80, height: 36 },
    { id: 'cl1', position: { x: 140, y: 40 }, width: 80, height: 36 },
    { id: 'cf', position: { x: 600, y: 600 }, width: 80, height: 36 },
  ]
  const ciEdges = [
    { id: 'ce0', source: 'cr', target: 'cp', relation: 'subordinate' },
    { id: 'ce1', source: 'cp', target: 'cl0', relation: 'subordinate' },
    { id: 'ce2', source: 'cp', target: 'cl1', relation: 'subordinate' },
  ]
  const ciFull = lm.computeLodVisibility({ nodes: ciNodes, edges: ciEdges, zoom: zm.ZOOM_REFERENCE })
  assert.equal(ciFull.visibleNodeIds.size, ciNodes.length, '【P1.9】100% 集成端点必须全图可见')
  assert.equal(ciFull.collisionHiddenCount, 0)
  assert.equal(ciFull.collisionActive, false)
  const ciMid = lm.computeLodVisibility({ nodes: ciNodes, edges: ciEdges, zoom: 0.6 * zm.ZOOM_REFERENCE })
  assert.equal(ciMid.collisionActive, true, '【P1.9】远景必须启用碰撞约束')
  // 60% 时贴着树根的一级主干属于默认永久显示层数（protected），不再被抽稀；
  // 改用整段行程验证「非保护节点仍会因重叠被裁」。
  let ciPruned = false
  for (let ratio = 0.95; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const probe = lm.computeLodVisibility({ nodes: ciNodes, edges: ciEdges, zoom: ratio * zm.ZOOM_REFERENCE })
    if (probe.collisionHiddenCount > 0) { ciPruned = true; break }
  }
  assert.ok(ciPruned, '【P1.9】远景必须真的抽掉重叠节点')
  const ciFar = lm.computeLodVisibility({ nodes: ciNodes, edges: ciEdges, zoom: zm.MIN_RAW_ZOOM })
  assert.deepEqual([...ciFar.visibleNodeIds], ['cr', 'cp'], '【保底两层】P1.9 的 20% 端点仍保留两层')
  let ciPrevious: Set<string> | undefined
  const ciCounts: number[] = []
  for (let ratio = 1; ratio >= 0.2 - 1e-9; ratio -= 0.02) {
    const step = lm.computeLodVisibility({
      nodes: ciNodes, edges: ciEdges, zoom: ratio * zm.ZOOM_REFERENCE,
      previousVisibleNodeIds: ciPrevious,
    })
    ciCounts.push(step.visibleNodeIds.size)
    assert.ok(step.visibleNodeIds.has('cr'), '【P1.9】树根任何档位都不得被碰撞裁掉')
    assert.ok(step.visibleNodeIds.has('cp'), '【保底两层】保底一级主干任何档位都不得被碰撞裁掉')
    assert.ok(step.hiddenNodeIds.size >= step.collisionHiddenCount,
      '【P1.9】碰撞隐藏数不得大于总隐藏数')
    if (step.collisionActive) {
      assert.equal(
        cm.countOverlapPairs(ciNodes, step.visibleNodeIds, step.collisionBoxScale),
        step.collisionProtectedOverlapPairs,
        '【P1.9】集成后可见节点必须两两不重叠（用户强制保留的节点之间除外）',
      )
    }
    for (const [child, parent] of [['cp', 'cr'], ['cl0', 'cp'], ['cl1', 'cp']]) {
      if (step.visibleNodeIds.has(child)) {
        assert.ok(step.visibleNodeIds.has(parent), '【P1.9】集成路径不得出现子可见、父已隐藏的断链')
      }
    }
    ciPrevious = step.visibleNodeIds
  }
  assert.equal(ciCounts[0], ciNodes.length)
  assert.equal(ciCounts[ciCounts.length - 1], 2, '【保底两层】P1.9 集成路径 20% 端点保留两层')
  for (let i = 1; i < ciCounts.length; i += 1) {
    assert.ok(ciCounts[i] <= ciCounts[i - 1], '【P1.9】集成路径可见数必须单调不回升')
  }

  // 7) 源码接线守卫 + 7 处字段白名单守卫。
  const collisionSource = await readFile(new URL('../src/domain/graph/lodCollision.ts', import.meta.url), 'utf-8')
  const collisionLodSource = await readFile(new URL('../src/domain/graph/lod.ts', import.meta.url), 'utf-8')
  const collisionControlSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/LodControl.tsx', import.meta.url), 'utf-8')
  const collisionGuiSource = await readFile(new URL('./verify-linked-documents-gui.mjs', import.meta.url), 'utf-8')
  assert.ok(collisionLodSource.includes('resolveLodCollisions(nodes, visibleNodeIds,')
    && collisionLodSource.includes('glyphCompensationForZoom(rawZoom)')
    && collisionLodSource.includes('children: hierarchy.children')
    && collisionLodSource.includes('for (const id of collision.hiddenIds) visibleNodeIds.delete(id)'),
  '【P1.9】LOD 必须真跑碰撞裁剪并消费结果，不是只 import')
  assert.ok(collisionSource.includes('boxesOverlap') && collisionSource.includes('protectedIds')
    && collisionSource.includes('collisionBoxScaleFor'),
  '【P1.9】碰撞模块必须按几何盒与保护优先级判定')
  assert.ok(!collisionSource.includes('localStorage(') && !collisionSource.includes('node.data')
    && !collisionSource.includes('.position ='),
  '【P1.9】碰撞裁剪绝不落盘 / 不改坐标 / 不写节点 data')
  assert.ok(collisionControlSource.includes('data-tm-lod-collision={visibility.collisionActive')
    && collisionControlSource.includes('data-tm-lod-collision-hidden={visibility.collisionHiddenCount}')
    && collisionControlSource.includes('data-tm-lod-collision-guard=')
    && collisionControlSource.includes('data-tm-lod-collision-protected-pairs='),
  '【P1.9】控件必须暴露碰撞诊断供 GUI 直读')
  assert.ok(collisionGuiSource.includes('overlapSteps.every((pairs) => pairs === 0)')
    && collisionGuiSource.includes('data-tm-lod-collision-hidden'),
  '【P1.9】GUI 必须用真实 DOM AABB 断言逐档无重叠')
  const collisionWhitelistFiles = [
    'src/types/graph.ts', 'src/domain/graph/model.ts', 'src/domain/graph/graphMapper.ts',
    'src/domain/graph/normalizeGraphMeta.ts', 'src/core/storage/file.ts',
    'src/core/fs-backend.ts', 'src/hooks/useGraph/graphBuilder.ts',
  ]
  for (const file of collisionWhitelistFiles) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf-8')
    assert.ok(!source.includes('collisionHidden') && !source.includes('collisionGuard')
      && !source.includes('collisionBoxScale'),
    `【P1.9】${file} 不得出现碰撞派生字段（不得污染节点字段白名单）`)
  }
}

// --- 房间级图型分类（P3-A）：定义表 / 归一化 / 自动推断 / LOD 策略 / 关系推荐 / 写库入口 ---
// 铁律：只查源码字面量不够，必须 esbuild 打包真跑纯函数 + normalizeConfig + backend.writeConfig。
// 图型存全局 _config.json 的 roomProfiles，漏列 normalizeConfig 或 writeConfig 就会「写完即丢」。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundled = async (relative: string) => {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      banner: { js: 'globalThis.window = globalThis.window || {};' },
    })
    return await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  }
  const gp = await loadBundled('../src/domain/graph/graphProfiles.ts')
  const lodMod = await loadBundled('../src/domain/graph/lod.ts')
  const storageService = await loadBundled('../src/core/storage/service.ts')

  // 1) 唯一定义表：恰好 4 项，语义字段不允许漂移。
  assert.deepEqual([...gp.GRAPH_PROFILE_IDS], ['auto', 'tree', 'flow', 'network'], '【P0】图型 id 集合必须恒定')
  assert.equal(gp.GRAPH_PROFILE_DEFINITIONS.length, 4, '【P0】定义表必须恰好 4 项')
  assert.deepEqual(gp.GRAPH_PROFILE_DEFINITIONS.map((d: any) => d.id), ['auto', 'tree', 'flow', 'network'])
  for (const def of gp.GRAPH_PROFILE_DEFINITIONS) {
    assert.ok(typeof def.label === 'string' && def.label.length > 0, '图型必须有显示名')
    assert.ok(typeof def.description === 'string' && def.description.length > 0, '图型必须有说明')
    assert.ok(def.lodMode === 'auto' || def.lodMode === 'off', '图型 LOD 模式只能是 auto/off')
    assert.ok(def.preferredRelation === null || def.preferredRelation === 'related' || def.preferredRelation === 'subordinate',
      '推荐关系只能是两值之一或 null')
  }
  assert.equal(gp.resolveGraphProfileDefinition('auto').preferredRelation, null, '自动识别本身不推荐关系')
  assert.equal(gp.resolveGraphProfileDefinition('tree').lodMode, 'auto')
  assert.equal(gp.resolveGraphProfileDefinition('tree').skipCoverageProtection, true, '【P0】层级图必须跳过低覆盖保护')
  assert.equal(gp.resolveGraphProfileDefinition('tree').preferredRelation, 'subordinate')
  assert.equal(gp.resolveGraphProfileDefinition('flow').lodMode, 'off', '【P0】流程图必须关闭语义缩放')
  assert.equal(gp.resolveGraphProfileDefinition('flow').skipCoverageProtection, false)
  assert.equal(gp.resolveGraphProfileDefinition('network').skipCoverageProtection, false)
  assert.equal(gp.describeGraphProfile('tree'), '知识结构树')

  // 2) 归一化：非法值收敛为 auto，大小写/空白容错，幂等。
  for (const bad of [undefined, null, 123, {}, 'bogus', 'REL_XXX', '']) {
    assert.equal(gp.normalizeGraphProfileId(bad), 'auto', `非法图型 ${String(bad)} 必须收敛为 auto`)
  }
  assert.equal(gp.normalizeGraphProfileId(' TREE '), 'tree', '大小写与空白必须容错')
  const rawProfiles = { 'kb/a': 'tree', 'kb/b': 'BOGUS', 'kb/c': ' Flow ', '': 'tree' }
  const normalizedProfiles = gp.normalizeRoomProfiles(rawProfiles)
  assert.deepEqual(normalizedProfiles, { 'kb/a': 'tree', 'kb/b': 'auto', 'kb/c': 'flow' }, '【P0】房间映射必须逐项归一化且丢弃空 key')
  assert.equal(rawProfiles['kb/b'], 'BOGUS', '归一化不得修改原对象')
  assert.deepEqual(gp.normalizeRoomProfiles(normalizedProfiles), normalizedProfiles, '房间映射归一化必须幂等')
  for (const bad of [null, 42, [], 'x']) {
    assert.deepEqual(gp.normalizeRoomProfiles(bad), {}, '非法房间映射必须收敛为空对象')
  }

  // 3) 自动推断：保守、可解释，只作建议。
  assert.equal(gp.inferGraphProfile({ nodeCount: 3, edgeCount: 2, subordinateEdgeCount: 0, treeCoverage: 0 }), 'flow',
    '【P0】无从属边且稀疏链状 → 流程图')
  assert.equal(gp.inferGraphProfile({ nodeCount: 5, edgeCount: 10, subordinateEdgeCount: 0, treeCoverage: 0 }), 'network',
    '【P0】无从属边且稠密网状 → 自由关联图')
  assert.equal(gp.inferGraphProfile({ nodeCount: 6, edgeCount: 3, subordinateEdgeCount: 3, treeCoverage: 0.8 }), 'tree',
    '【P0】从属边多且覆盖率高 → 知识结构树')
  assert.equal(gp.inferGraphProfile({ nodeCount: 20, edgeCount: 3, subordinateEdgeCount: 3, treeCoverage: 0.2 }), 'network',
    '【P0】树覆盖率低不能冒充结构树')
  assert.equal(gp.inferGraphProfile({ nodeCount: Number.NaN, edgeCount: -1, subordinateEdgeCount: Number.NaN, treeCoverage: Number.NaN }), 'network',
    '异常统计不得让推断崩溃')
  assert.equal(gp.resolveEffectiveGraphProfileId('auto', 'tree'), 'tree', 'auto 必须解析成推断结果')
  assert.equal(gp.resolveEffectiveGraphProfileId('flow', 'tree'), 'flow', '手动指定必须压过推断')
  assert.equal(gp.resolveEffectiveGraphProfileId('bogus', 'network'), 'network')

  // 4) LOD 策略：用户手动选择永远压过图型。
  assert.deepEqual(gp.resolveGraphProfileLodPolicy('flow', 'auto'), { mode: 'off', skipCoverageProtection: false, source: 'profile' })
  assert.deepEqual(gp.resolveGraphProfileLodPolicy('tree', 'auto'), { mode: 'auto', skipCoverageProtection: true, source: 'profile' })
  assert.deepEqual(gp.resolveGraphProfileLodPolicy('network', 'auto'), { mode: 'auto', skipCoverageProtection: false, source: 'profile' })
  assert.deepEqual(gp.resolveGraphProfileLodPolicy('flow', 'force'), { mode: 'force', skipCoverageProtection: false, source: 'user' },
    '【P0】用户强制必须压过流程图的关闭策略')
  assert.deepEqual(gp.resolveGraphProfileLodPolicy('tree', 'off'), { mode: 'off', skipCoverageProtection: false, source: 'user' },
    '【P0】用户关闭必须压过层级图的跳过保护')

  // 5) 新建连线浮层：只排序/标记，两个选项恒在，绝不自动落盘。
  assert.equal(gp.recommendedRelationForProfile('tree'), 'subordinate')
  assert.equal(gp.recommendedRelationForProfile('flow'), 'related')
  assert.equal(gp.recommendedRelationForProfile('network'), 'related')
  assert.equal(gp.recommendedRelationForProfile('auto'), null, '未解析的 auto 不推荐')
  const relationIds = ['related', 'subordinate']
  assert.deepEqual(gp.orderEdgeRelationOptions(relationIds, 'subordinate'), ['subordinate', 'related'])
  assert.deepEqual(gp.orderEdgeRelationOptions(relationIds, 'related'), ['related', 'subordinate'])
  assert.deepEqual(gp.orderEdgeRelationOptions(relationIds, null), ['related', 'subordinate'])
  assert.deepEqual(gp.orderEdgeRelationOptions(relationIds, 'bogus'), ['related', 'subordinate'], '未知推荐不得吞掉选项')
  assert.deepEqual(relationIds, ['related', 'subordinate'], '排序不得修改原数组')

  // 6) 与 lod.ts 真联动：tree 跳过低覆盖保护，但绝不能越过无树保护。
  const manyFree = [
    { id: 'r' }, { id: 'k' },
    ...Array.from({ length: 18 }, (_, i) => ({ id: `f${i}` })),
  ]
  const oneSubEdge = [{ id: 's1', source: 'r', target: 'k', relation: 'subordinate' }]
  const lowCoverage = lodMod.computeLodVisibility({ nodes: manyFree, edges: oneSubEdge, zoom: 0.2 })
  assert.equal(lowCoverage.reason, 'low-coverage', '【P0】默认仍要按覆盖率保护')
  const treePolicy = gp.resolveGraphProfileLodPolicy('tree', 'auto')
  const treeVis = lodMod.computeLodVisibility({
    nodes: manyFree, edges: oneSubEdge, zoom: 0.2,
    mode: treePolicy.mode, skipCoverageProtection: treePolicy.skipCoverageProtection,
  })
  assert.equal(treeVis.active, true, '【P0】层级图必须能跳过低覆盖保护')
  assert.equal(treeVis.reason, 'active', '跳过保护时不能退化成 forced')
  assert.ok(treeVis.hiddenNodeIds.size > 0, '跳过保护后游离节点必须真的被隐藏')
  const noTreeEvenForTree = lodMod.computeLodVisibility({
    nodes: manyFree,
    edges: [{ id: 'w', source: 'r', target: 'k', relation: 'related' }],
    zoom: 0.2, mode: 'auto', skipCoverageProtection: true,
  })
  assert.equal(noTreeEvenForTree.reason, 'no-tree', '【P0】图型不得越过「一条从属边都没有」的保护')
  assert.equal(noTreeEvenForTree.hiddenNodeIds.size, 0)
  const flowPolicy = gp.resolveGraphProfileLodPolicy('flow', 'auto')
  const flowVis = lodMod.computeLodVisibility({ nodes: manyFree, edges: oneSubEdge, zoom: 0.2, mode: flowPolicy.mode })
  assert.equal(flowVis.reason, 'off', '【P0】流程图图型必须真的关掉 LOD')
  assert.equal(flowVis.hiddenNodeIds.size, 0)

  // 7) 配置往返：normalizeConfig 会重建对象，漏列字段「写完即丢」。
  const cfg = normalizeConfig({
    roomProfiles: { 'kb/a': ' TREE ', 'kb/b': 'bogus', '': 'flow' },
    showEdgeRelationLabels: false,
  })
  assert.deepEqual(cfg.roomProfiles, { 'kb/a': 'tree', 'kb/b': 'auto' }, '【P0】normalizeConfig 必须显式保留房间图型')
  assert.equal(cfg.showEdgeRelationLabels, false, '新增字段不得挤掉已有配置')
  assert.equal(cfg.edgeRelations?.length, 2, '新增字段不得挤掉两类关系定义')
  assert.deepEqual(normalizeConfig(cfg).roomProfiles, cfg.roomProfiles, '配置归一化必须幂等')

  // 8) 【核心】真跑写库入口，断言 backend.writeConfig 收到的对象。
  const calls: Array<Record<string, any>> = []
  const backend = { writeConfig: async (config: Record<string, any>) => { calls.push(config) } }
  const store = storageService.createStore(backend) as { writeConfig: (config: any) => Promise<void> }
  const roomMap = { 'kb/a': 'tree', 'kb/b': 'flow' }
  await store.writeConfig({ roomProfiles: roomMap })
  assert.deepEqual(calls[0].roomProfiles, roomMap, '【P0】房间图型必须真的写进 _config.json')
  await store.writeConfig({ showEdgeRelationLabels: false })
  assert.deepEqual(calls[1].roomProfiles, roomMap, '【P0】后续写入别的配置不得把图型冲掉')
  await store.writeConfig({ roomProfiles: { 'kb/c': 'BOGUS' } })
  assert.deepEqual(calls[2].roomProfiles, { 'kb/c': 'auto' }, '写库入口必须走同一份归一化')

  // 9) 接线保障：纯函数层不写盘，UI 四层都必须消费规则源。
  const profilesSource = await readFile(new URL('../src/domain/graph/graphProfiles.ts', import.meta.url), 'utf-8')
  const normalizeSource = await readFile(new URL('../src/core/storage/normalizeConfig.ts', import.meta.url), 'utf-8')
  const serviceSource = await readFile(new URL('../src/core/storage/service.ts', import.meta.url), 'utf-8')
  const configServiceSource = await readFile(new URL('../src/application/config/configService.ts', import.meta.url), 'utf-8')
  const lodHookSource = await readFile(new URL('../src/features/graph/GraphCanvas/model/useSemanticLod.ts', import.meta.url), 'utf-8')
  const canvasSource = await readFile(new URL('../src/features/graph/GraphCanvas/GraphCanvas.tsx', import.meta.url), 'utf-8')
  const controlSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/LodControl.tsx', import.meta.url), 'utf-8')
  const pickerSource = await readFile(new URL('../src/features/graph/GraphCanvas/components/EdgeRelationPicker.tsx', import.meta.url), 'utf-8')
  assert.equal(profilesSource.includes('writeConfig') || profilesSource.includes('window.api'), false,
    '【P0】图型纯函数层不得写盘 / 不得碰 IPC')
  assert.ok(normalizeSource.includes('roomProfiles: normalizeRoomProfiles(c.roomProfiles)'), 'normalizeConfig 必须显式保留图型')
  assert.ok(serviceSource.includes('nextConfig.roomProfiles = config.roomProfiles'), 'writeConfig 必须显式透传图型映射')
  assert.ok(configServiceSource.includes('setRoomProfiles(normalizeRoomProfiles(config.roomProfiles))'), '启动时必须 hydrate 图型')
  assert.ok(lodHookSource.includes('resolveGraphProfileLodPolicy') && lodHookSource.includes('inferGraphProfile('),
    'LOD hook 必须消费图型策略与自动推断')
  assert.ok(lodHookSource.includes('resolvePolicy:') && lodHookSource.includes('stats.subordinateEdgeCount')
    && lodHookSource.includes('singlePass: true'),
    '【P0】图型推断必须在同一趟可见性计算里完成，不得重新遍历全图')
  assert.equal((lodHookSource.match(/computeLodVisibility\(/g) ?? []).length, 1,
    '【P0】每次 LOD 计划重算只能调用一次 computeLodVisibility，禁止第二遍全图遍历')
  assert.ok(canvasSource.includes('storage.writeConfig({ roomProfiles: map })'), '画布切换图型必须真写盘')
  assert.ok(canvasSource.includes('configuredProfileId'), '画布必须按当前房间取图型')
  assert.ok(controlSource.includes('data-tm-graph-profile-select') && controlSource.includes('data-tm-graph-profile-effective'),
    '控件必须暴露可断言的图型选择器与生效图型')
  assert.ok(pickerSource.includes('orderEdgeRelationOptions') && pickerSource.includes('data-tm-edge-relation-choice={option.id}'),
    '【P0】关系浮层按图型推荐但仍保留两个必选项')
}

// --- 知识库总览（P3-B）：只读房间树 / 上限与防环 / 层级布局 / 懒加载接线 ---
// 铁律：esbuild 打包真跑纯函数（假 storage 天然没有写方法）+ 源码接线断言。
// 总览绝不写盘、绝不读文档正文；进入房间仍走既有 enterRoomInTab → loadRoomGraph。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundled = async (relative: string) => {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      banner: { js: 'globalThis.window = globalThis.window || {};' },
    })
    return await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  }
  const ro = await loadBundled('../src/domain/graph/roomOverview.ts')

  // 1) 路径防护：房间路径只能是 kbs 根下的相对路径。
  assert.equal(ro.isSafeRoomPath(''), false, '【P0】空房间路径必须拒绝')
  assert.equal(ro.isSafeRoomPath('../evil'), false, '【P0】.. 越界路径必须拒绝')
  assert.equal(ro.isSafeRoomPath('kb/a/../evil'), false, '【P0】中段 .. 越界路径必须拒绝')
  assert.equal(ro.isSafeRoomPath('C:/Windows'), false, '【P0】盘符绝对路径必须拒绝')
  assert.equal(ro.isSafeRoomPath('kb/a'), true, '合法的房间相对路径必须通过')
  assert.deepEqual(await ro.collectRoomOverviews(
    { readLayout: async () => ({ nodes: {}, edges: [] }), readRoomNodeSummaries: async () => ({}) },
    { path: '../outside', name: '越界' },
  ), { items: [], truncated: false, readCount: 0 }, '【P0】越界根节点一律不读盘')

  // 2) 假 storage：三层房间树 + 未物化节点 + 越界引用 + 自引用环 + 读取失败。
  const metas: Record<string, any> = {
    kb: {
      nodes: {
        a: { card: { ref: 'a', name: '房间 A' } },
        b: { card: { ref: 'b', name: '房间 B' } },
        ghost: { card: { ref: 'ghost', name: '未物化' } },
        bad: { card: { ref: '../evil', name: '越界' } },
      },
      edges: [{}, {}, {}],
    },
    'kb/a': {
      nodes: {
        x: { card: { ref: 'x', name: '房间 A-X' } },
        self: { card: { ref: 'kb/a', name: '自引用' } },
      },
      edges: [{}],
    },
    'kb/b': { nodes: {}, edges: [] },
  }
  const summaryMap: Record<string, any> = {
    'kb/a': { childCount: 2, hasDetail: false },
    'kb/b': { childCount: 0, hasDetail: true },
    'kb/ghost': { childCount: 0, hasDetail: false },
    'kb/a/x': { childCount: 1, hasDetail: false },
  }
  const layoutCalls: string[] = []
  const summaryCalls: string[][] = []
  const fakeStorage = {
    readLayout: async (path: string) => {
      layoutCalls.push(path)
      if (path === 'kb/a/x') throw new Error('模拟读取失败')
      return metas[path] ?? null
    },
    readRoomNodeSummaries: async (paths: string[]) => {
      summaryCalls.push(paths)
      return Object.fromEntries(paths.map((path) => [path, summaryMap[path]]))
    },
  }
  const result = await ro.collectRoomOverviews(fakeStorage, { path: 'kb', name: '测试库' })
  assert.deepEqual(result.items.map((i: any) => i.path), ['kb', 'kb/a', 'kb/b', 'kb/a/x'],
    '【P0】只展开确实有内容（子节点或文档）的子房间，且自引用不成环')
  assert.equal(result.items.some((i: any) => i.path.includes('ghost') || i.path.includes('evil')), false,
    '【P0】未物化的 P0 轻量节点与越界路径不能变成房间卡片')
  assert.equal(result.readCount, 4, '【P0】每个房间只读一次 readLayout，不得逐节点读小文件')
  assert.equal(layoutCalls.length, 4, '【P0】假 storage 的读盘次数必须与房间数一致')
  assert.equal(summaryCalls.length <= 4, true, '【P0】子房间摘要必须批量读取，不能逐房间往返')
  assert.equal(result.truncated, false, '小房间树不应触发上限')
  const rootItem = result.items.find((i: any) => i.path === 'kb')
  assert.equal(rootItem.nodeCount, 4, '【P0】根房间节点数必须来自真实 meta')
  assert.equal(rootItem.edgeCount, 3, '【P0】根房间边数必须来自真实 meta')
  assert.equal(rootItem.childRoomCount, 2, '【P0】子房间数只统计有内容的房间')
  assert.equal(rootItem.status, 'ready', '正常房间状态必须是 ready')
  assert.equal(result.items.find((i: any) => i.path === 'kb/a/x').status, 'unavailable',
    '【P0】单个房间读取失败必须降级为 unavailable，不能让整个总览崩掉')
  assert.equal(result.items.find((i: any) => i.path === 'kb/a/x').depth, 2, '层级深度必须正确')

  // 3) 上限保护：房间数与深度都必须封顶，避免大知识库打爆 IPC。
  const capped = await ro.collectRoomOverviews(fakeStorage, { path: 'kb', name: '测试库' }, { maxRooms: 2 })
  assert.equal(capped.items.length, 2, '【P0】maxRooms 必须真的截断')
  assert.equal(capped.truncated, true, '截断时必须标记，UI 才能提示')
  const shallow = await ro.collectRoomOverviews(fakeStorage, { path: 'kb', name: '测试库' }, { maxDepth: 1 })
  assert.equal(shallow.items.length, 3, '【P0】maxDepth 必须真的截断深层房间')
  assert.equal(shallow.items.every((i: any) => i.depth <= 1), true)

  // 4) 布局：稳定网格 + 父子层级边（不是聚合边）。
  const layout = ro.layoutRoomOverview(result.items)
  assert.equal(layout.cards.length, 4, '每张房间摘要都必须有卡片')
  assert.equal(new Set(layout.cards.map((c: any) => c.id)).size, 4, '卡片 id 必须唯一（用房间路径）')
  assert.deepEqual(layout.links.map((l: any) => `${l.source}->${l.target}`).sort(), [
    'kb->kb/a', 'kb->kb/b', 'kb/a->kb/a/x',
  ], '【P0】层级边只能连真实存在的父房间')
  assert.deepEqual(ro.layoutRoomOverview(result.items), layout, '布局必须稳定，刷新后位置不跳')
  assert.ok(layout.cards.find((c: any) => c.id === 'kb/a').position.y > layout.cards.find((c: any) => c.id === 'kb').position.y,
    '【P0】子房间卡片必须落在父房间下方')
  const orphan = { ...result.items[1], parentPath: 'not-in-result' }
  assert.equal(ro.layoutRoomOverview([orphan]).links.length, 0, '父房间不在结果里时不得凭空造边')

  // 5) 接线保障：总览只读、双击懒加载、入口与挂载齐全。
  const overviewSource = await readFile(new URL('../src/features/graph/GraphPage/components/RoomOverview.tsx', import.meta.url), 'utf-8')
  const cardSource = await readFile(new URL('../src/features/graph/GraphPage/components/RoomSummaryCard.tsx', import.meta.url), 'utf-8')
  const pageSource = await readFile(new URL('../src/features/graph/GraphPage/GraphPage.tsx', import.meta.url), 'utf-8')
  const controlSource2 = await readFile(new URL('../src/features/graph/GraphCanvas/components/LodControl.tsx', import.meta.url), 'utf-8')
  const pureSource = await readFile(new URL('../src/domain/graph/roomOverview.ts', import.meta.url), 'utf-8')
  assert.equal(pureSource.includes('writeConfig') || pureSource.includes('window.api') || pureSource.includes('writeLayout'), false,
    '【P0】总览纯函数层不得写盘 / 不得碰 IPC')
  assert.equal(overviewSource.includes('writeConfig') || overviewSource.includes('saveGraph') || overviewSource.includes('readTopoDocument'), false,
    '【P0】总览 UI 不得写盘、不得读文档正文')
  assert.ok(overviewSource.includes('collectRoomOverviews(storage, { path: kbPath, name: rootName })'),
    '【P0】总览必须消费唯一纯函数层，且以 kbPath 为根')
  assert.ok(overviewSource.includes('enterRoomInTab(tabId, {'), '【P0】双击必须走既有进入房间链路（懒加载）')
  assert.ok(overviewSource.includes('onNodeDoubleClick={handleEnter}'), '进入房间必须绑在双击上，避免误触')
  assert.ok(overviewSource.includes('<ReactFlowProvider>') && overviewSource.includes('</ReactFlowProvider>'),
    '【P0】总览必须包独立 ReactFlowProvider，否则会复用 App 级 store 画出底层房间节点')
  assert.ok(overviewSource.includes('useGraphSession(tabId)')
    && !overviewSource.includes('useTabStore((state) => state.getGraphSession(tabId))'),
    '【P0】getGraphSession 每次派生新对象，必须走 useShallow 版 hook，否则 React 19 snapshot 不稳定会让总览整个挂掉')
  assert.ok(overviewSource.includes('data-tm-room-overview=') && overviewSource.includes('data-tm-room-overview-count={items.length}'),
    '总览必须暴露可断言的挂载与房间计数')
  assert.ok(cardSource.includes('data-tm-room-summary-card={item.path}'), '卡片必须暴露房间路径')
  assert.ok(cardSource.includes('type="target"') && cardSource.includes('type="source"'),
    '【P0】卡片必须提供隐藏 Handle，否则 ReactFlow 无法计算父子层级边端点')
  assert.ok(pageSource.includes('{isActive && <RoomOverview tabId={tabId} />}'), '【P0】总览必须挂在 graph-panel 内且仅活跃标签渲染')
  assert.ok(controlSource2.includes('data-tm-room-overview-open=') && controlSource2.includes('useRoomOverviewStore.getState().open()'),
    '【P0】镜头控件必须能打开总览')
}

// --- 第 17 组：放大上限收敛到 100% + 左下角一键重置视角（2026-11-10）---
// 【用户决策】「再放大没有意义了，节点已经全部展示」→ 上限 100%；
// 「左下角可以增加一键重置视角到 100% 的按钮」→ 常驻、只改比例、不动平移。
// 纯函数用 esbuild 打包真跑；UI 接线用源码守卫（DOM 行为由 GUI 端到端覆盖）。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/zoomScale.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const zs = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const {
    ZOOM_REFERENCE, MIN_RAW_ZOOM, MAX_RAW_ZOOM, MIN_DISPLAY_PERCENT, MAX_DISPLAY_PERCENT,
    clampRawZoom, rebaseViewportZoom, fromDisplayPercent, stepDisplayZoom,
    toDisplayPercent, glyphScaleForRatio, glyphScaleForZoom, glyphCompensationForZoom,
    quantizeLodZoom, detailAlphaForZoom, semanticZoomVarsForZoom,
    isAtMaxZoom, isAtMinZoom,
  } = zs

  // 1) 上限 = 100% = ZOOM_REFERENCE，四重身份重合。
  assert.equal(MAX_DISPLAY_PERCENT, 100, '【100% 上限】最大显示比例必须是 100%')
  assert.equal(MAX_RAW_ZOOM, ZOOM_REFERENCE, '【100% 上限】最大 raw 必须恒等于 100% 的 raw')
  assert.equal(toDisplayPercent(MAX_RAW_ZOOM), 100)
  assert.equal(MIN_DISPLAY_PERCENT, 5, '【2026-11-11】最小比例放开到 5%')
  assert.equal(MIN_RAW_ZOOM, ZOOM_REFERENCE * 0.05)
  assert.equal(zs.COMPACT_START_PERCENT, 20, '【2026-11-11】20% 是渐隐终点 / 紧凑起点')

  // 2) 所有曾经能超过 100% 的入口都必须被钳住（真跑，不是查字面量）。
  for (const over of [ZOOM_REFERENCE * 1.1, 0.8, 0.91, 1, 1.3, 4, 999]) {
    assert.equal(clampRawZoom(over), ZOOM_REFERENCE, `【100% 上限】clampRawZoom(${over}) 必须钳到 100%`)
    assert.equal(quantizeLodZoom(over), quantizeLodZoom(ZOOM_REFERENCE),
      `【100% 上限】quantizeLodZoom(${over}) 必须与 100% 完全同档`)
  }
  assert.equal(rebaseViewportZoom(9), ZOOM_REFERENCE, '【100% 上限】远古超大镜头必须落到 100%')
  assert.equal(fromDisplayPercent(999), ZOOM_REFERENCE)
  assert.equal(fromDisplayPercent(150), ZOOM_REFERENCE)
  assert.equal(stepDisplayZoom(ZOOM_REFERENCE, 10), ZOOM_REFERENCE, '【100% 上限】放大按钮在 100% 停住')
  assert.equal(stepDisplayZoom(MAX_RAW_ZOOM, -10), fromDisplayPercent(90), '缩小仍可用，行程没被截断')

  // 3) 语义缩放：100% 是唯一恒等点兼上限，越界输入一律恒等 1，节点不虚胖。
  assert.equal(glyphScaleForRatio(1), 1)
  for (const r of [1.01, 1.2, 1.5, 1.8, 2, 3]) {
    assert.equal(glyphScaleForRatio(r), 1, `【100% 上限】glyphScaleForRatio(${r}) 必须钳回 1`)
    assert.equal(glyphScaleForZoom(r * ZOOM_REFERENCE), 1, `【100% 上限】${r * 100}% 屏幕倍率必须恒等 1`)
    assert.equal(glyphCompensationForZoom(r * ZOOM_REFERENCE), 1, `【100% 上限】${r * 100}% 不得施加补偿`)
  }
  assert.equal(glyphScaleForZoom(MAX_RAW_ZOOM), 1)
  assert.equal(glyphCompensationForZoom(MAX_RAW_ZOOM), 1)
  assert.equal(detailAlphaForZoom(MAX_RAW_ZOOM), 1, '【100% 上限】细节必须完整')
  assert.equal(semanticZoomVarsForZoom(MAX_RAW_ZOOM).detailHit, 'auto')
  assert.equal(zs.GLYPH_MAX_SCALE, undefined, '【100% 上限】近景放大常量必须删除')
  assert.equal(zs.GLYPH_SCALE_EXPONENT, undefined, '【100% 上限】近景 pow 分支必须删除')

  // 4) 下限与远景行为完全不变，避免「收上限」顺手把地图式远景弄坏。
  assert.equal(glyphScaleForZoom(MIN_RAW_ZOOM), zs.GLYPH_FAR_SCALE)
  assert.equal(detailAlphaForZoom(MIN_RAW_ZOOM), 0)
  assert.equal(semanticZoomVarsForZoom(MIN_RAW_ZOOM).detailHit, 'none')
  assert.equal(toDisplayPercent(MIN_RAW_ZOOM), 5)

  // 4b) 端点判定必须按显示百分比：滚轮缓动 / 按钮过渡结束后 raw 会带 1e-3 级残差，
  //     用浮点相等会导致「读数已是 100%，放大按钮却没禁用」。
  assert.equal(isAtMaxZoom(ZOOM_REFERENCE), true)
  assert.equal(isAtMaxZoom(MIN_RAW_ZOOM), false)
  assert.equal(isAtMinZoom(MIN_RAW_ZOOM), true)
  assert.equal(isAtMinZoom(ZOOM_REFERENCE), false)
  assert.equal(isAtMaxZoom(ZOOM_REFERENCE - 0.002), true, '100% 前的过渡残差必须仍算到达上限')
  assert.equal(isAtMinZoom(MIN_RAW_ZOOM + 0.0008), true, '5% 附近的过渡残差必须仍算到达下限')
  assert.equal(isAtMaxZoom(0.5 * ZOOM_REFERENCE), false)
  assert.equal(isAtMinZoom(0.5 * ZOOM_REFERENCE), false)
  assert.equal(isAtMaxZoom(1.3), true, '越界 zoom 也钳到上限')

  // 5) 源码接线守卫：画布边界、按钮禁用、左下角重置按钮、只改比例不改平移。
  const canvasSource17 = await readFile(new URL('../src/features/graph/GraphCanvas/GraphCanvas.tsx', import.meta.url), 'utf-8')
  const controlSource17 = await readFile(new URL('../src/features/graph/GraphCanvas/components/LodControl.tsx', import.meta.url), 'utf-8')
  const resetSource17 = await readFile(new URL('../src/features/graph/GraphCanvas/components/ZoomResetButton.tsx', import.meta.url), 'utf-8')
  const miniMapSource17 = await readFile(new URL('../src/features/graph/GraphCanvas/components/CanvasMiniMap.tsx', import.meta.url), 'utf-8')
  const scaleSource17 = await readFile(new URL('../src/domain/graph/zoomScale.ts', import.meta.url), 'utf-8')
  assert.ok(canvasSource17.includes('maxZoom={MAX_RAW_ZOOM}') && canvasSource17.includes('minZoom={MIN_RAW_ZOOM}'),
    '【100% 上限】ReactFlow 的缩放边界必须来自唯一规则源')
  assert.ok(controlSource17.includes('data-tm-zoom-max-percent={formatZoomPercent(MAX_RAW_ZOOM)}')
    && controlSource17.includes('data-tm-zoom-min-percent={formatZoomPercent(MIN_RAW_ZOOM)}'),
    '【100% 上限】控件必须暴露上下限供 GUI 直读')
  assert.ok(controlSource17.includes('const atMaxZoom = isAtMaxZoom(zoomLevel)')
    && controlSource17.includes('const atMinZoom = isAtMinZoom(zoomLevel)')
    // 精确匹配：data-disabled={atMaxZoom} 也含子串 disabled={atMaxZoom}，必须带前置空白。
    && /\sdisabled=\{atMaxZoom\}/.test(controlSource17)
    && /\sdisabled=\{atMinZoom\}/.test(controlSource17),
    '【100% 上限】到端点的方向按钮必须禁用，且判定必须来自唯一规则源')
  assert.ok(controlSource17.includes('reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS })'),
    '【100% 上限】左上角 100% 复位必须消费唯一常量与过渡时长')
  assert.ok(resetSource17.includes('data-tm-zoom-reset-view=')
    && resetSource17.includes('data-tm-zoom-at-reference={atReference')
    && resetSource17.includes('aria-label="一键重置视角到 100%"'),
    '【左下角重置】按钮必须暴露可断言的挂载与状态属性')
  assert.ok(resetSource17.includes('reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS })'),
    '【左下角重置】必须与左上角复位完全同源，只改比例')
  assert.ok(!resetSource17.includes('fitView(') && !resetSource17.includes('setViewport(')
    && !resetSource17.includes('setCenter('),
    '【左下角重置】不得 fitView / 改 pan，否则会重算比例并牵动落盘视野')
  assert.ok(resetSource17.includes('ZOOM_REFERENCE') && resetSource17.includes('ZOOM_TRANSITION_MS')
    && resetSource17.includes('formatZoomPercent(zoomLevel)')
    && resetSource17.includes('const atReference = isAtMaxZoom(zoomLevel)'),
    '【左下角重置】目标比例 / 过渡时长 / 当前读数 / 端点判定必须全部来自规则源')
  assert.ok(miniMapSource17.includes("import ZoomResetButton from './ZoomResetButton'")
    && miniMapSource17.includes('<ZoomResetButton zoomLevel={zoomLevel} />')
    && miniMapSource17.includes('position="bottom-left"'),
    '【左下角重置】必须常驻挂在 bottom-left 面板的按钮组里')
  assert.ok(scaleSource17.includes('export const MAX_DISPLAY_PERCENT = 100')
    && !scaleSource17.includes('GLYPH_MAX_SCALE') && !scaleSource17.includes('GLYPH_SCALE_EXPONENT')
    && !scaleSource17.includes('Math.pow(safe')
    && scaleSource17.includes('if (safe >= GLYPH_FAR_START_RATIO) return GLYPH_MIN_SCALE'),
    '【100% 上限】规则源不得残留 200%、近景放大常量或 pow 放大分支')

  // 6) GUI 端到端断言守卫：改了上限 / 撤了左下角按钮，必须能被静态回归先拦下。
  const zoomGuiSource = await readFile(new URL('./verify-linked-documents-gui.mjs', import.meta.url), 'utf-8')
  assert.ok(zoomGuiSource.includes("atReferenceControl.max === '100%'")
    && zoomGuiSource.includes("atReferenceControl.min === '5%'")
    && zoomGuiSource.includes("=== '200%'") === false,
    '【100% 上限】GUI 必须断言上限读作 100% / 下限 5%，且不得再等 200%')
  assert.ok(zoomGuiSource.includes('data-tm-lod-visible-depth-levels')
    && zoomGuiSource.includes('至少保留两层深度'),
    '【默认两层】GUI 必须实测最远镜头至少两层深度')
  assert.ok(zoomGuiSource.includes('data-tm-lod-preserved-depth-select')
    && zoomGuiSource.includes('"preservedDepth":2')
    && zoomGuiSource.includes("page.select('[data-tm-lod-preserved-depth-select]', '1')"),
    '【自定义永久层数】GUI 必须实测面板随时变更层数、立即生效并持久化')
  assert.ok(zoomGuiSource.includes('atReferenceControl.resetViewInBottomLeft')
    && zoomGuiSource.includes('resetViewHittable')
    && zoomGuiSource.includes('page.mouse.click(resetViewRect.x, resetViewRect.y)'),
    '【左下角重置】GUI 必须用真实鼠标点击验证按钮可命中且能回到 100%')
  assert.ok(zoomGuiSource.includes('viewportCenterFlow')
    && zoomGuiSource.includes('一键重置只改比例、不平移视野'),
    '【左下角重置】GUI 必须断言重置只改比例、不平移视野')
  const scaleWhitelistFiles = [
    'src/types/graph.ts', 'src/domain/graph/model.ts', 'src/domain/graph/graphMapper.ts',
    'src/domain/graph/normalizeGraphMeta.ts', 'src/core/storage/file.ts',
    'src/core/fs-backend.ts', 'src/hooks/useGraph/graphBuilder.ts',
  ]
  for (const file of scaleWhitelistFiles) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf-8')
    assert.ok(!source.includes('zoomResetView') && !source.includes('maxDisplayPercent'),
      `【100% 上限】${file} 不得出现缩放控件字段（不得污染节点字段白名单）`)
  }
}

// --- 第 18 组：缩小 / 有隐藏节点时整张画布只读（2026-11-11）---
// 【用户决策】「缩放后位置等信息失真，移动节点、移动连线、增删连线、重命名等
// 一律禁止，只有比例恢复 100% 之后才可编辑」。
// 铁律：判定与 change 过滤用 esbuild 打包真跑；所有写操作必须在唯一汇聚点
// useGraph() 过闸门，UI 层另有手势 / 浮层禁用，静态守卫防止日后被悄悄摘掉。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/canvasReadOnly.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const ro = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const {
    computeCanvasReadOnly, filterReadOnlyNodeChanges, filterReadOnlyEdgeChanges,
    isViewOnlyNodeChange, isViewOnlyEdgeChange,
  } = ro
  const zsBundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/zoomScale.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const zs = await import(`data:text/javascript;base64,${Buffer.from(zsBundle.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const { ZOOM_REFERENCE, MIN_RAW_ZOOM } = zs

  // 1) 100% + 零隐藏是唯一可编辑态；端点判定必须复用 isAtMaxZoom 的显示百分比语义。
  const editable = computeCanvasReadOnly(ZOOM_REFERENCE, 0)
  assert.equal(editable.readOnly, false, '【只读】100% 且无隐藏节点必须可编辑')
  assert.equal(editable.reason, 'editable')
  assert.equal(editable.atMaxZoom, true)
  assert.equal(computeCanvasReadOnly(ZOOM_REFERENCE - 0.002, 0).readOnly, false,
    '【只读】100% 附近的过渡残差按读数算已到端点，不得误锁')
  assert.equal(computeCanvasReadOnly(1.3, 0).readOnly, false,
    '【只读】越界 zoom 由 isAtMaxZoom 钳到上限，与按钮判定同源')

  // 2) 缩小即锁（哪怕零隐藏，坐标依然失真）；100% 但仍有隐藏节点也锁。
  for (const ratio of [0.99, 0.9, 0.7, 0.5, 0.3]) {
    const state = computeCanvasReadOnly(ZOOM_REFERENCE * ratio, 0)
    assert.equal(state.readOnly, true, `【只读】${ratio * 100}% 零隐藏也必须禁写`)
    assert.equal(state.reason, 'zoomed-out', `【只读】${ratio * 100}% 的原因必须是缩小`)
  }
  assert.equal(computeCanvasReadOnly(MIN_RAW_ZOOM, 5).readOnly, true, '【只读】5% + 隐藏节点必须禁写')
  assert.equal(computeCanvasReadOnly(MIN_RAW_ZOOM, 5).hiddenNodeCount, 5)
  const hiddenAtFull = computeCanvasReadOnly(ZOOM_REFERENCE, 3)
  assert.equal(hiddenAtFull.readOnly, true, '【只读】100% 却仍有隐藏节点的异常态不得解锁')
  assert.equal(hiddenAtFull.reason, 'hidden-nodes')
  assert.equal(computeCanvasReadOnly(ZOOM_REFERENCE, Number.NaN).hiddenNodeCount, 0,
    '【只读】脏隐藏数必须归零，不得 NaN 传染')
  assert.equal(computeCanvasReadOnly(ZOOM_REFERENCE, -7).hiddenNodeCount, 0)

  // 3) change 过滤真跑：写操作全拦，select / 自动测量放行，手动 resize 拦。
  const nodeChanges: any[] = [
    { type: 'position', id: 'a', position: { x: 12, y: 34 }, dragging: true },
    { type: 'position', id: 'a', dragging: false },
    { type: 'remove', id: 'b' },
    { type: 'add', item: { id: 'c' } },
    { type: 'replace', id: 'd', item: { id: 'd' } },
    { type: 'select', id: 'e', selected: true },
    { type: 'dimensions', id: 'f', dimensions: { width: 120, height: 60 } },
    { type: 'dimensions', id: 'f', dimensions: { width: 130, height: 70 }, resizing: true },
    { type: 'dimensions', id: 'f', dimensions: { width: 130, height: 70 }, origin: 'manual' },
    { type: 'dimensions', id: 'f', dimensions: { width: 130, height: 70 }, origin: 'auto-size' },
  ]
  const keptNodes = filterReadOnlyNodeChanges(nodeChanges)
  assert.deepEqual(keptNodes.map((c: any) => c.type), ['select', 'dimensions', 'dimensions'],
    '【只读】只保留 select 与「自动测量 / auto-size」的 dimensions')
  assert.equal(keptNodes[1].id, 'f')
  assert.equal(keptNodes[2].origin, 'auto-size')
  assert.equal(isViewOnlyNodeChange({ type: 'position', id: 'a' } as any), false)
  assert.equal(isViewOnlyNodeChange({ type: 'remove', id: 'a' } as any), false)
  const edgeChanges: any[] = [
    { type: 'remove', id: 'e1' },
    { type: 'add', item: { id: 'e2' } },
    { type: 'replace', id: 'e3', item: { id: 'e3' } },
    { type: 'select', id: 'e4', selected: true },
  ]
  const keptEdges = filterReadOnlyEdgeChanges(edgeChanges)
  assert.deepEqual(keptEdges.map((c: any) => c.type), ['select'],
    '【只读】边的 remove / add / replace 必须拦，select 放行')
  assert.equal(isViewOnlyEdgeChange({ type: 'remove', id: 'e1' } as any), false)

  // 4) 外部 store 真跑：按 tab 隔离 + 先写快照再通知（顺序反了 React 会丢重渲染）。
  const storeBundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/stores/canvasReadOnlyStore.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const store = await import(`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  store.publishCanvasReadOnly('tab-a', ZOOM_REFERENCE, 0)
  assert.equal(store.isCanvasReadOnly('tab-a'), false, '【只读 store】100% tab 可编辑')
  store.publishCanvasReadOnly('tab-a', MIN_RAW_ZOOM, 4)
  assert.equal(store.isCanvasReadOnly('tab-a'), true, '【只读 store】缩小立即合上闸门')
  assert.equal(store.isActiveCanvasReadOnly(), true)
  assert.equal(store.getActiveCanvasReadOnly().hiddenNodeCount, 4)
  store.publishCanvasReadOnly('tab-b', ZOOM_REFERENCE, 0)
  assert.equal(store.isCanvasReadOnly('tab-b'), false, '【只读 store】活动 tab 回到 100% 必须解锁')
  assert.equal(store.isCanvasReadOnly('tab-a'), true, '【只读 store】非活动 tab 的状态不被串改')
  assert.equal(store.isActiveCanvasReadOnly(), false, '【只读 store】切 tab 后 active 快照必须跟着换')
  store.clearCanvasReadOnly('tab-a')
  assert.equal(store.isActiveCanvasReadOnly(), false, '【只读 store】清理非活动 tab 不得误锁当前 tab')
  store.clearCanvasReadOnly('tab-b')
  assert.equal(store.isActiveCanvasReadOnly(), false, '【只读 store】卸载后必须回到可编辑默认态')

  // 5) 源码接线守卫：唯一写闸门、手势禁用、快捷键 / 菜单 / 浮层 / 提示。
  const readSrc = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const graphSource18 = await readSrc('src/hooks/useGraph.ts')
  assert.ok(graphSource18.includes('function guardCanvasEdit<')
    && graphSource18.includes('guardCanvasEdit(tabId, fn, blocked)')
    && graphSource18.includes('filterReadOnlyNodeChanges(changes)')
    && graphSource18.includes('filterReadOnlyEdgeChanges(changes)'),
    '【只读】所有写操作必须在 useGraph 唯一汇聚点过闸门')
  for (const method of [
    'onConnect:', 'onConnectStart:', 'onConnectEnd:', 'createChildNode:', 'deleteChildNode:',
    'renameNode:', 'updateNodeStyle:', 'updateNodesStyle:', 'clearNodesStyle:',
    'updateNodeSizingMode:', 'updateNodeEmojis:', 'createEdge:', 'updateEdgeRelation:',
    'updateEdgeStyle:', 'updateEdgeAnchor:', 'deleteEdge:',
  ]) {
    assert.ok(graphSource18.includes(`${method} edit(`),
      `【只读】${method} 必须被 edit() 包住，否则该编辑入口会漏过去`)
  }
  assert.ok(graphSource18.includes('selectNode: ops.selectNode')
    && graphSource18.includes('onNodeClick: graphEvents.onNodeClick'),
    '【只读】选中 / 查看类操作必须保持放行')

  const canvasSource18 = await readSrc('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  assert.ok(canvasSource18.includes('computeCanvasReadOnly(zoomLevel, hiddenNodeCount)')
    && canvasSource18.includes('publishCanvasReadOnly(tabId, zoomLevel, hiddenNodeCount)')
    && canvasSource18.includes('useLayoutEffect(() => {'),
    '【只读】画布必须按同源判定发布只读状态，且在绘制前生效')
  assert.ok(canvasSource18.includes('nodesDraggable={!canvasReadOnly}')
    && canvasSource18.includes('nodesConnectable={!canvasReadOnly}'),
    '【只读】React Flow 手势层必须关掉拖节点 / 拉连线')
  assert.ok(canvasSource18.includes('data-tm-canvas-readonly={canvasReadOnly')
    && canvasSource18.includes('<CanvasReadOnlyBanner state={readOnlyState}'),
    '【只读】必须暴露诊断属性与只读横幅')
  assert.ok(canvasSource18.includes('elementsSelectable'),
    '【只读】仍要允许选中节点查看信息')

  const modelSource18 = await readSrc('src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts')
  // 2026-11-12 新增第四处：双击连线编辑关系名，只读时也一律不弹浮层。
  assert.equal((modelSource18.match(/if \(isCanvasReadOnly\(tabId\)\) return/g) ?? []).length, 4,
    '【只读】撤销 / 重做 / 快捷键新建节点 / 双击编辑连线四处都必须拦')
  // node / edge / pane / selection / fallback 五个右键入口都必须拦。
  // 2026-11-21 校正：旧断言写死 3，而实现早已增至 5 处（含多选与兜底入口），属过时断言。
  assert.equal((modelSource18.match(/if \(isCanvasReadOnly\(tabId\)\) \{/g) ?? []).length, 5,
    '【只读】节点 / 连线 / 画布 / 多选 / 兜底五种右键菜单都必须不弹出')

  const handlersSource18 = await readSrc('src/hooks/useGraph/graphEventHandlers.ts')
  assert.ok(handlersSource18.includes('if (isCanvasReadOnly(tabId)) return')
    && handlersSource18.includes('onConfirm: (relation) => {'),
    '【只读】连线关系浮层的异步确认与格式刷捷径都必须兜底')
  const edgeActionsSource18 = await readSrc('src/features/graph/GraphPage/model/useEdgeActions.ts')
  assert.ok(edgeActionsSource18.includes('if (isActiveCanvasReadOnly()) return'),
    '【只读】React Flow deleteElements 绕过写闸门，必须单独拦')

  const cardModelSource18 = await readSrc('src/features/graph/GraphCanvas/nodes/KnowledgeCard/model/useKnowledgeCardModel.ts')
  assert.ok(cardModelSource18.includes('selected && !canvasReadOnly')
    && cardModelSource18.includes('&& !canvasReadOnly')
    && cardModelSource18.includes('if (canvasReadOnly) {'),
    '【只读】双击重命名 / 快捷工具栏 / 草稿提交都必须关掉')
  const cardSource18 = await readSrc('src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx')
  assert.ok(cardSource18.includes('!isMultiSelected && !canvasReadOnly')
    && cardSource18.includes('showHoverControls && !canvasReadOnly'),
    '【只读】手动 resize 与连线加号手柄必须卸载')
  const edgeSource18 = await readSrc('src/features/graph/GraphCanvas/edges/FloatingEdge.tsx')
  assert.ok(edgeSource18.includes('&& !canvasReadOnly')
    && edgeSource18.includes('showToolbar ='),
    '【只读】连线工具栏 / 锚点 / 弯曲控制柄必须收起')

  const bannerSource18 = await readSrc('src/features/graph/GraphCanvas/components/CanvasReadOnlyBanner.tsx')
  assert.ok(bannerSource18.includes('data-tm-canvas-readonly-banner=')
    && bannerSource18.includes('data-tm-canvas-readonly-restore=')
    && bannerSource18.includes('reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS })')
    && !bannerSource18.includes('fitView('),
    '【只读】提示条必须给一键恢复 100% 的入口，且只改比例不改平移')
  const controlSource18 = await readSrc('src/features/graph/GraphCanvas/components/LodControl.tsx')
  assert.ok(controlSource18.includes('data-tm-canvas-readonly={readOnlyState.readOnly')
    && controlSource18.includes('data-tm-lod-readonly='),
    '【只读】左侧状态面板必须显示只读状态')
  const cssSource18 = await readSrc('src/styles/base.css')
  assert.ok(cssSource18.includes('.tm-canvas-readonly .react-flow__handle'),
    '【只读】CSS 必须收掉残留的连线手柄命中与 grab 光标')
  const storeSource18 = await readSrc('src/stores/canvasReadOnlyStore.ts')
  assert.ok(storeSource18.indexOf('activeSnapshot = next') < storeSource18.indexOf('for (const listener of listeners) listener()'),
    '【只读 store】必须先写快照再通知，否则 useSyncExternalStore 读到旧值')
  assert.ok(storeSource18.includes('useSyncExternalStore(subscribeCanvasReadOnly, isActiveCanvasReadOnly, isActiveCanvasReadOnly)'),
    '【只读 store】叶子组件必须只订阅布尔，缩放期不得让所有卡片重渲染')

  // 6) 只读是纯视图态：绝不污染节点 / 边字段白名单与落盘格式。
  const readOnlyWhitelistFiles = [
    'src/types/graph.ts', 'src/domain/graph/model.ts', 'src/domain/graph/graphMapper.ts',
    'src/domain/graph/normalizeGraphMeta.ts', 'src/core/storage/file.ts',
    'src/core/fs-backend.ts', 'src/hooks/useGraph/graphBuilder.ts',
  ]
  for (const file of readOnlyWhitelistFiles) {
    const source = await readSrc(file)
    assert.ok(!source.includes('canvasReadOnly') && !source.includes('readOnlyState'),
      `【只读】${file} 不得出现画布只读字段（只读不落盘）`)
  }

  // 7) GUI 端到端守卫：必须真机验证「缩小禁写」与「恢复 100% 解锁」两个方向。
  const guiSource18 = await readSrc('scripts/verify-linked-documents-gui.mjs')
  assert.ok(guiSource18.includes('data-tm-canvas-readonly-banner')
    && guiSource18.includes('data-tm-canvas-readonly-restore')
    && guiSource18.includes('只读期双击重命名不进入编辑、拖动节点坐标不变')
    && guiSource18.includes('只读期仍可选中节点查看')
    && guiSource18.includes('恢复 100% 后只读解除'),
    '【只读】GUI 必须实测缩小禁写（重命名 / 拖动）与恢复 100% 解锁')
  const stylePanelSource18 = await readSrc('src/features/right-panel/components/StyleTab/StyleSection.tsx')
  assert.ok(stylePanelSource18.includes('data-tm-style-panel-readonly=')
    && stylePanelSource18.includes('useActiveCanvasReadOnly()'),
    '【只读】右栏样式面板同写画布数据，必须显示只读提示')
}

// ===========================================================================
// 19) 【2026-11-11 两段镜头 + 密度自适应】5% 下限 / 20% 渐隐终点 / 紧凑只收紧 /
//     节点多树深时每格缩放灵敏度按 1/√N 放慢。真跑 zoomScale 打包产物，不查字面量。
// ===========================================================================
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/zoomScale.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const z = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const {
    ZOOM_REFERENCE, MIN_RAW_ZOOM, MIN_DISPLAY_PERCENT, COMPACT_START_PERCENT,
    COMPACT_START_RATIO, COMPACT_STEP_DECAY, COMPACT_STEP_MIN_PERCENT,
    ZOOM_STEP_PERCENT, LOD_DENSITY_REFERENCE_NODES, MIN_ZOOM_STEP_SENSITIVITY,
    toDisplayPercent, fromDisplayPercent, isCompactZoom,
    zoomStepSensitivityForGraph, densityStepSensitivityForGraph,
    DENSITY_STEP_SCALING_ENABLED, wheelSensitivityForZoom, stepGraphZoom,
    glyphCompensationForZoom, quantizeLodZoom, GLYPH_FAR_SCALE,
  } = z

  // 1) 两段镜头的边界：100% 上限 / 20% 渐隐终点 / 5% 下限。
  assert.equal(MIN_DISPLAY_PERCENT, 5, '【两段镜头】最小比例必须是 5%')
  assert.equal(COMPACT_START_PERCENT, 20, '【两段镜头】渐隐终点 / 紧凑起点是 20%')
  assert.equal(COMPACT_START_RATIO, 0.2)
  assert.equal(toDisplayPercent(MIN_RAW_ZOOM), 5)
  assert.equal(toDisplayPercent(COMPACT_START_RATIO * ZOOM_REFERENCE), 20)
  assert.equal(isCompactZoom(ZOOM_REFERENCE), false, '100% 属于渐隐行程')
  assert.equal(isCompactZoom(0.5 * ZOOM_REFERENCE), false, '50% 属于渐隐行程')
  assert.equal(isCompactZoom(COMPACT_START_RATIO * ZOOM_REFERENCE), false,
    '20% 本身是渐隐终点，不算紧凑区')
  assert.equal(isCompactZoom(0.19 * ZOOM_REFERENCE), true, '20% 以下才进入紧凑行程')
  assert.equal(isCompactZoom(MIN_RAW_ZOOM), true, '5% 是紧凑行程终点')

  // 2) 紧凑区：文字保持（屏幕倍率恒 1.3）+ LOD 量化冻结（可见集合冻结见第 15 组）。
  const c20 = glyphCompensationForZoom(COMPACT_START_RATIO * ZOOM_REFERENCE)
  assert.ok(Math.abs(c20 - GLYPH_FAR_SCALE / 0.2) < 1e-9,
    '20% 端点必须与渐隐区严格连续（1.3/0.2 = 6.5）')
  for (const ratio of [0.19, 0.15, 0.1, 0.05]) {
    const comp = glyphCompensationForZoom(ratio * ZOOM_REFERENCE)
    assert.ok(Math.abs(comp * ratio - GLYPH_FAR_SCALE) < 1e-9,
      `【文字保持】${Math.round(ratio * 100)}% 屏幕字号必须仍是 20% 的大小`)
    assert.ok(comp > c20,
      `【文字保持】${Math.round(ratio * 100)}% 补偿必须继续增大以抵消镜头缩小`)
    assert.equal(quantizeLodZoom(ratio * ZOOM_REFERENCE), 0.2 * ZOOM_REFERENCE,
      `【紧凑区】${Math.round(ratio * 100)}% LOD 计划必须冻结在 20%，零重算`)
  }
  assert.ok(Math.abs(glyphCompensationForZoom(MIN_RAW_ZOOM) - GLYPH_FAR_SCALE / 0.05) < 1e-9,
    '【文字保持】5% 补偿必须是 1.3/0.05 = 26，屏幕字号不缩水')

  // 3) 【恢复固定步进 2026-11-11 晚】用户实测密度限速让鼠标步进偏慢，要求恢复上一版
  //    配置：应用入口恒为 1。旧 1/√N 公式保留在 densityStepSensitivityForGraph，
  //    仍按原样真跑，便于把开关切回 true 时无需重写断言。
  assert.equal(DENSITY_STEP_SCALING_ENABLED, false, '【恢复固定步进】密度自适应必须关闭')
  for (const [n, d] of [[0, 1], [8, 3], [240, 2], [1000, 20], [1e9, 100]]) {
    assert.equal(zoomStepSensitivityForGraph(n, d), 1,
      `【恢复固定步进】任意图规模都必须回到上一版固定步进（n=${n}）`)
  }
  assert.equal(wheelSensitivityForZoom(ZOOM_REFERENCE, 1000, 2), 1,
    '【恢复固定步进】大图滚轮不得再被密度限速')
  assert.equal(wheelSensitivityForZoom(MIN_RAW_ZOOM, 1000, 2), 1,
    '【恢复固定步进】紧凑区同样不再叠加限速')
  // 旧公式真跑（当前未生效）：小图=1、大图 1/√N、树深再放慢、有下限、脏数据回落 1。
  assert.equal(densityStepSensitivityForGraph(0), 1, '旧公式：空图不改变手感')
  assert.equal(densityStepSensitivityForGraph(8, 3), 1, '旧公式：小图逐值不变')
  assert.equal(densityStepSensitivityForGraph(LOD_DENSITY_REFERENCE_NODES, 20), 1,
    '旧公式：不超过参考规模恒为 1')
  const s240 = densityStepSensitivityForGraph(240, 2)
  const s1000 = densityStepSensitivityForGraph(1000, 2)
  const s10000 = densityStepSensitivityForGraph(10000, 2)
  assert.ok(s240 < 1 && s1000 < s240 && s10000 < s1000, '旧公式：图越大每格幅度越小')
  assert.ok(Math.abs(s240 - Math.sqrt(60 / 240)) < 1e-9, '旧公式：严格等于 1/√(N/60)')
  assert.ok(densityStepSensitivityForGraph(1000, 20) < s1000, '旧公式：树越深再放慢一点')
  assert.equal(densityStepSensitivityForGraph(1e9, 100), MIN_ZOOM_STEP_SENSITIVITY,
    '旧公式：万级大图仍保留操作下限')
  assert.equal(densityStepSensitivityForGraph(Number.NaN, Number.NaN), 1,
    '旧公式：脏数据回落 1')
  const hiddenPerNotch = (n: number) => n * ZOOM_STEP_PERCENT * densityStepSensitivityForGraph(n, 1) / (100 - COMPACT_START_PERCENT)
  const linearPerNotch = (n: number) => n * ZOOM_STEP_PERCENT / (100 - COMPACT_START_PERCENT)
  assert.ok(Math.abs(hiddenPerNotch(60) - linearPerNotch(60)) < 1e-9,
    '旧公式：小图与原实现逐值一致')
  assert.ok(hiddenPerNotch(1000) < linearPerNotch(1000) / 3,
    '旧公式：1000 节点时每格隐藏数压到线性 1/3 以下')
  assert.ok(Math.abs(hiddenPerNotch(1000) / hiddenPerNotch(60) - Math.sqrt(1000 / 60)) < 0.01,
    '旧公式：每格隐藏数按 √N 增长')

  // 4) 按钮步进：渐隐区每格 -10% 并稳定停靠 20%；紧凑区等比衰减（越接近下限幅度越小）、
  //    保底步长确保真能到 5%；放大是逆运算，能一路回到 20% 以上。
  let raw = ZOOM_REFERENCE
  const fadeSteps: number[] = []
  for (let i = 0; i < 8; i += 1) {
    const next = stepGraphZoom(raw, -ZOOM_STEP_PERCENT, 1)
    fadeSteps.push(toDisplayPercent(next))
    raw = next
  }
  assert.deepEqual(fadeSteps, [90, 80, 70, 60, 50, 40, 30, 20],
    '【两段镜头】100%→20% 每格 -10%，最后稳定停靠在渐隐终点')
  const compactSteps: number[] = []
  for (let i = 0; i < 16; i += 1) {
    const next = stepGraphZoom(raw, -ZOOM_STEP_PERCENT, 1)
    compactSteps.push(toDisplayPercent(next))
    raw = next
  }
  assert.equal(toDisplayPercent(raw), 5, '【紧凑区】保底步长必须能真正走到 5% 端点')
  const deltas = compactSteps.slice(0, 8).map((p: number, i: number) =>
    (i === 0 ? 20 : compactSteps[i - 1]) - p)
  assert.ok(deltas[0] > deltas[deltas.length - 1],
    '【紧凑区】越接近下限绝对步长越小（越稀疏变快、越紧凑变慢）')
  assert.ok(deltas.every((d: number) => d >= 0), '【紧凑区】步长不得反向放大')
  assert.ok(COMPACT_STEP_DECAY < 1 && COMPACT_STEP_MIN_PERCENT > 0,
    '【紧凑区】必须同时有等比衰减与保底步长')
  let back = raw
  for (let i = 0; i < 16; i += 1) back = stepGraphZoom(back, ZOOM_STEP_PERCENT, 1)
  assert.equal(toDisplayPercent(back), 100,
    '【紧凑区】放大可逆，必须能越过 20% 渐隐终点一路回到 100%（不得卡在 20%）')
  assert.equal(stepGraphZoom(ZOOM_REFERENCE, ZOOM_STEP_PERCENT, 1), ZOOM_REFERENCE,
    '100% 处放大仍必须停住')
  assert.equal(fromDisplayPercent(0), MIN_RAW_ZOOM, '0% 也必须钳到 5% 下限')

  // 5) 源码接线守卫：滚轮 / 按钮 / 面板诊断 / GUI 都必须消费这套规则。
  const readSrc19 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const canvasSource19 = await readSrc19('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  assert.ok(canvasSource19.includes('wheelSensitivityForZoom(')
    && canvasSource19.includes('clampWheelDelta(native.deltaY) * wheelSensitivity')
    && canvasSource19.includes('data-tm-canvas-compact='),
    '【恢复固定步进】滚轮仍走唯一规则源（当前配置为恒 1），并暴露紧凑诊断')
  const controlSource19 = await readSrc19('src/features/graph/GraphCanvas/components/LodControl.tsx')
  assert.ok(controlSource19.includes('stepGraphZoom(reactFlow.getZoom()')
    && controlSource19.includes('zoomStepSensitivityForGraph(')
    && controlSource19.includes('data-tm-lod-compact=')
    && controlSource19.includes('data-tm-lod-wheel-sensitivity=')
    && controlSource19.includes('data-tm-lod-compact-hint')
    && controlSource19.includes('data-tm-lod-compact-glyph-held="true"'),
    '【两段镜头】按钮步进、密度读数与紧凑提示必须接在左侧状态面板')
  const lodSource19 = await readSrc19('src/domain/graph/lod.ts')
  assert.ok(lodSource19.includes('LOD_FLOOR_RATIO = COMPACT_START_RATIO')
    && lodSource19.includes('Math.max(LOD_FLOOR_RATIO, ratio)')
    && lodSource19.includes('ratio >= LOD_FLOOR_RATIO && ratio < LOD_FULL_RATIO'),
    '【紧凑区】渐隐终点必须同源，可见集合冻结且跳过碰撞抽稀')
  const guiSource19 = await readSrc19('scripts/verify-linked-documents-gui.mjs')
  assert.ok(guiSource19.includes("atReferenceControl.min === '5%'")
    && guiSource19.includes("=== '20%'")
    && guiSource19.includes('5% 紧凑镜头：可见集合与 20% 端点完全一致')
    && guiSource19.includes('5% 紧凑镜头：文字保持可读字号')
    && guiSource19.includes('data-tm-lod-compact-hint'),
    '【两段镜头】GUI 必须实测 20% 渐隐终点、5% 下限、紧凑区节点冻结与文字保持')
}

// ===========================================================================
// 20) 【2026-11-11 多选水平镜像 + 紧凑区文字保持】
//     esbuild 真跑 domain/graph/mirrorSelection.ts 的数据往返（坐标 / 锚点 / 曲线 /
//     字段透传 / 幂等），另加源码守卫确认写闸门、undo 合并、菜单与只读接线。
// ===========================================================================
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/mirrorSelection.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const {
    applyHorizontalMirror, computeHorizontalMirror, mirrorAnchorHorizontally,
    mirrorNodeWidth, MIRROR_MIN_SELECTED_NODES, DEFAULT_MIRROR_NODE_WIDTH,
  } = m

  assert.equal(MIRROR_MIN_SELECTED_NODES, 2, '【多选镜像】少于 2 个节点没有「左右布局」可翻')
  assert.equal(mirrorNodeWidth({ id: 'x', position: { x: 0, y: 0 } }), DEFAULT_MIRROR_NODE_WIDTH,
    '【多选镜像】缺宽度必须回落到 120（与落盘侧一致）')
  assert.equal(mirrorNodeWidth({ id: 'x', position: { x: 0, y: 0 }, width: Number.NaN }), DEFAULT_MIRROR_NODE_WIDTH,
    '【多选镜像】脏宽度不得污染中轴')
  assert.equal(mirrorNodeWidth({ id: 'x', position: { x: 0, y: 0 }, measured: { width: 180 } }), 180,
    '【多选镜像】未显式设宽时优先用测量宽度')
  assert.deepEqual(mirrorAnchorHorizontally({ u: 0.2, v: 0.75 }), { u: 0.8, v: 0.75 },
    '【多选镜像】锚点只翻 u，v 保持')
  assert.equal(mirrorAnchorHorizontally(null), undefined, '非法锚点不写补丁')

  // 三个选中节点宽度不同（100/200/120），包围盒 left=0 / right=920 → 中轴 460。
  // mid(450) 与 out(1500) 不选中，用来验证「跨界连线」的方向变化判定。
  const nodes: any[] = [
    { id: 'a', position: { x: 0, y: 100 }, width: 100, selected: true, data: { label: 'A' } },
    { id: 'b', position: { x: 400, y: 100 }, width: 200, selected: true, data: { label: 'B' } },
    { id: 'c', position: { x: 800, y: 300 }, width: 120, selected: true, data: { label: 'C' } },
    { id: 'mid', position: { x: 450, y: 500 }, width: 100, data: { label: 'MID' } },
    { id: 'out', position: { x: 1500, y: 100 }, width: 100, data: { label: 'OUT' } },
  ]
  const edges: any[] = [
    { id: 'e1', source: 'a', target: 'b', data: {
      sourceAnchor: { u: 1, v: 0.3 }, targetAnchor: { u: 0, v: 0.7 },
      curveControl: { u: 0.5, v: 0.25 }, relation: 'subordinate', lineWidth: 2 } },
    { id: 'e2', source: 'b', target: 'c', data: {
      sourceAnchor: { u: 0.8, v: 0.4 }, targetAnchor: null,
      curveControl: { u: 0.4, v: -0.3 } } },
    { id: 'e3', source: 'c', target: 'out', data: { sourceAnchor: { u: 1, v: 0.5 } } },
    { id: 'e4', source: 'out', target: 'out', data: { curveControl: { u: 0.5, v: 0.6 } } },
    // 跨界但水平方向反转（c 从 860 翻到 60，越过 mid 的 500）→ v 必须取反。
    { id: 'e5', source: 'c', target: 'mid', data: {
      sourceAnchor: { u: 1, v: 0.2 }, curveControl: { u: 0.5, v: 0.4 } } },
    // 跨界但水平方向不变（a 从 50 翻到 870，仍在 out 的 1550 左侧）→ v 保持。
    { id: 'e6', source: 'a', target: 'out', data: {
      sourceAnchor: { u: 1, v: 0.1 }, curveControl: { u: 0.5, v: 0.4 } } },
  ]
  const selectedIds = ['a', 'b', 'c']
  const patch = computeHorizontalMirror(nodes, edges, selectedIds)
  assert.ok(patch, '【多选镜像】3 个选中节点必须产出补丁')
  assert.equal(patch.axisX, 460, '【多选镜像】中轴必须由包围盒左右端点决定')
  assert.deepEqual(patch.flippedEdgeIds.sort(), ['e1', 'e2', 'e3', 'e5', 'e6'],
    '【多选镜像】只有至少一端在选区内的边参与翻转')

  const result = applyHorizontalMirror(nodes, edges, selectedIds)
  assert.ok(result)
  const pos = (list: any[], id: string) => list.find((n: any) => n.id === id).position
  assert.deepEqual(pos(result.nodes, 'a'), { x: 820, y: 100 }, '【多选镜像】a 右边界换到 920')
  assert.deepEqual(pos(result.nodes, 'b'), { x: 320, y: 100 }, '【多选镜像】b 右边界换到 520')
  assert.deepEqual(pos(result.nodes, 'c'), { x: 0, y: 300 }, '【多选镜像】c 左边界换到 0')
  assert.deepEqual(pos(result.nodes, 'mid'), { x: 450, y: 500 })
  assert.deepEqual(pos(result.nodes, 'out'), { x: 1500, y: 100 })
  const mirrorBounds = (list: any[]) => {
    let lo = Infinity; let hi = -Infinity
    for (const id of selectedIds) {
      const n = list.find((item: any) => item.id === id)
      lo = Math.min(lo, n.position.x)
      hi = Math.max(hi, n.position.x + mirrorNodeWidth(n))
    }
    return { lo, hi }
  }
  assert.deepEqual(mirrorBounds(result.nodes), mirrorBounds(nodes),
    '【多选镜像】包围盒左右端点不变 → 原地翻转，整体位置不平移')
  for (const id of selectedIds) {
    assert.equal(pos(result.nodes, id).y, pos(nodes, id).y, '【多选镜像】只翻 x，纵坐标必须不变')
    assert.equal(result.nodes.find((n: any) => n.id === id).width,
      nodes.find((n: any) => n.id === id).width, '【多选镜像】节点尺寸不得改变')
    assert.ok(result.nodes.find((n: any) => n.id === id).data.label, '【多选镜像】节点 data 原样透传')
  }
  assert.ok(result.nodes[3] === nodes[3] && result.nodes[4] === nodes[4],
    '【多选镜像】未选中节点必须保持原引用（不触发重渲染）')
  assert.equal(result.edges.length, edges.length, '【多选镜像】不得增删连线')

  const byId = (id: string) => result.edges.find((e: any) => e.id === id)
  assert.equal(byId('e1').source, 'a')
  assert.equal(byId('e1').target, 'b')
  assert.equal(byId('e1').data.relation, 'subordinate', '【多选镜像】关系 / 样式必须透传')
  assert.equal(byId('e1').data.lineWidth, 2)
  assert.deepEqual(byId('e1').data.sourceAnchor, { u: 0, v: 0.3 })
  assert.deepEqual(byId('e1').data.targetAnchor, { u: 1, v: 0.7 })
  assert.deepEqual(byId('e1').data.curveControl, { u: 0.5, v: -0.25 },
    '【多选镜像】两端都选中时曲线弯曲方向必须跟着翻')
  assert.ok(Math.abs(byId('e2').data.sourceAnchor.u - 0.2) < 1e-9
    && byId('e2').data.sourceAnchor.v === 0.4,
    '【多选镜像】锚点 u 取反（允许 1-u 的浮点尾差），v 不变')
  assert.deepEqual(byId('e2').data.curveControl, { u: 0.4, v: 0.3 })
  assert.deepEqual(byId('e3').data.sourceAnchor, { u: 0, v: 0.5 },
    '【多选镜像】跨界边只翻落在选区内的那一端')
  assert.ok(byId('e4') === edges[3], '【多选镜像】两端都在选区外的边必须保持原引用')
  assert.deepEqual(byId('e5').data.curveControl, { u: 0.5, v: -0.4 },
    '【多选镜像】跨界边方向反转时曲线弯曲方向也要翻')
  assert.deepEqual(byId('e5').data.sourceAnchor, { u: 0, v: 0.2 })
  assert.deepEqual(byId('e6').data.curveControl, { u: 0.5, v: 0.4 },
    '【多选镜像】跨界边方向未反转时不要动用户设定的弯曲量')
  assert.deepEqual(byId('e6').data.sourceAnchor, { u: 0, v: 0.1 })

  // 幂等：再翻一次必须逐值回到原布局（含锚点与曲线）。
  const twice = applyHorizontalMirror(result.nodes, result.edges, selectedIds)
  assert.ok(twice)
  for (const id of nodes.map((n: any) => n.id)) {
    assert.ok(Math.abs(pos(twice.nodes, id).x - pos(nodes, id).x) < 1e-9
      && Math.abs(pos(twice.nodes, id).y - pos(nodes, id).y) < 1e-9,
      `【多选镜像】两次翻转必须回到原坐标（${id}）`)
  }
  const twiceE1 = twice.edges.find((e: any) => e.id === 'e1')
  assert.deepEqual(twiceE1.data.sourceAnchor, { u: 1, v: 0.3 })
  assert.deepEqual(twiceE1.data.targetAnchor, { u: 0, v: 0.7 })
  assert.deepEqual(twiceE1.data.curveControl, { u: 0.5, v: 0.25 },
    '【多选镜像】锚点与曲线也必须可逆')
  // 不传 selectedIds 时从 nodes[].selected 派生，结果逐值一致。
  const auto = applyHorizontalMirror(nodes, edges)
  assert.ok(auto)
  assert.deepEqual(auto.nodes.map((n: any) => n.position), result.nodes.map((n: any) => n.position),
    '【多选镜像】store 选中态与显式 id 列表同源')
  assert.equal(applyHorizontalMirror(nodes, edges, ['a']), null, '只选 1 个节点不翻转')
  assert.equal(applyHorizontalMirror(nodes, edges, []), null, '空选区不翻转')
  assert.equal(applyHorizontalMirror(nodes, edges, ['nope', 'nope2']), null, '脏 id 不翻转')

  // 源码接线守卫：写闸门 / 单步 undo / 上方菜单 / 只读 / 文字保持 / GUI 实测。
  const readSrc20 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const graphSource20 = await readSrc20('src/hooks/useGraph.ts')
  assert.ok(graphSource20.includes('flipSelectionHorizontally: edit('),
    '【多选镜像】必须过 useGraph 的唯一写闸门（缩小/有隐藏节点时禁写）')
  const opsSource20 = await readSrc20('src/hooks/useGraph/selectionMirrorOperations.ts')
  assert.ok(opsSource20.includes('commitGraphHistorySnapshot(')
    && opsSource20.includes('setNodesPreservingSelection(') && opsSource20.includes('setEdges(')
    && opsSource20.includes('temporalState.pause()') && opsSource20.includes('saveLater('),
    '【多选镜像】节点 + 连线必须合并成一条 undo 历史并保存')
  const contextSource20 = await readSrc20('src/contexts/GraphContext.tsx')
  assert.ok(contextSource20.includes('flipSelectionHorizontally'),
    '【多选镜像】方法必须经 GraphContext 暴露给画布')
  const canvasSource20 = await readSrc20('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  assert.ok(canvasSource20.includes('MIRROR_MIN_SELECTED_NODES')
    && canvasSource20.includes('!canvasReadOnly')
    && canvasSource20.includes('showSelectionMirror')
    && canvasSource20.includes('!showSelectionMirror'),
    '【多选镜像】菜单只在多选且可写时出现，且与 Shift 提示条互斥')
  const menuSource20 = await readSrc20('src/features/graph/GraphCanvas/components/SelectionMirrorMenu.tsx')
  assert.ok(menuSource20.includes('Panel position="top-center"')
    && menuSource20.includes('pointer-events-auto')
    && menuSource20.includes('data-tm-selection-mirror-flip'),
    '【多选镜像】上方菜单必须真实可点（Panel 默认 pointer-events:none）')
  const mirrorSource20 = await readSrc20('src/domain/graph/mirrorSelection.ts')
  assert.ok(mirrorSource20.includes('return { ...edge, data: { ...(edge.data ?? {}), ...dataPatch } }'),
    '【多选镜像】边字段必须展开透传，不能重建白名单')
  const zoomSource20 = await readSrc20('src/domain/graph/zoomScale.ts')
  assert.ok(zoomSource20.includes('GLYPH_FAR_SCALE / Math.max(MIN_DISPLAY_PERCENT / 100, ratio)')
    && zoomSource20.includes('文字仍保持'),
    '【文字保持】紧凑区必须按 1/ratio 撑大补偿，而不是冻结')
  const guiSource20 = await readSrc20('scripts/verify-linked-documents-gui.mjs')
  assert.ok(guiSource20.includes('Shift 多选两个节点后上方出现镜像菜单')
    && guiSource20.includes('水平镜像翻转：节点左右互换')
    && guiSource20.includes('5% 紧凑镜头：文字保持可读字号'),
    '【多选镜像 / 文字保持】GUI 必须端到端实测')
}

// --- 第 21 组：画布状态抽屉融合（2026-11-11）---
// 房间路径 / 最近打开 / 镜头状态原本三层 UI 都压在画布同一角。现在统一成一个
// 抽屉式面板：整体 + 每个功能区独立折叠；长路径用固定宽度 + 首尾压缩 +
// 「位置」区纵向滚动解决，绝不把控件越撑越长。GUI 实测量关键交互。
{
  const readSrc21 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const pageSrc21 = await readSrc21('src/features/graph/GraphPage/GraphPage.tsx')
  const canvasSrc21 = await readSrc21('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  const controlSrc21 = await readSrc21('src/features/graph/GraphCanvas/components/LodControl.tsx')
  const sectionSrc21 = await readSrc21('src/features/graph/GraphCanvas/components/CanvasStatusSection.tsx')
  const prefsSrc21 = await readSrc21('src/features/graph/GraphCanvas/model/canvasStatusPreferences.ts')
  const pathSrc21 = await readSrc21('src/features/layout/Breadcrumb/Breadcrumb.tsx')
  const recentSrc21 = await readSrc21('src/features/layout/RoomHistory/RoomHistory.tsx')
  const guiSrc21 = await readSrc21('scripts/verify-linked-documents-gui.mjs')

  assert.ok(!pageSrc21.includes('<Breadcrumb') && !pageSrc21.includes('<RoomHistory')
    && !pageSrc21.includes('absolute top-3 left-3'),
    '【状态抽屉】旧面包屑 / 历史的绝对定位层必须移除，否则仍与 top-left Panel 重叠')
  assert.ok(/<LodControl\s+tabId=\{tabId\}/.test(canvasSrc21),
    '【状态抽屉】抽屉必须按 tabId 取房间路径与最近打开')
  assert.ok(controlSrc21.includes('data-tm-canvas-status-drawer')
    && controlSrc21.includes('data-tm-canvas-status-title')
    && controlSrc21.includes('data-tm-room-path-full')
    && controlSrc21.includes('setCanvasStatusDrawerOpen('),
    '【状态抽屉】标题栏必须是房间路径面包屑，且整体可折叠')
  for (const id of ['path', 'view', 'recent', 'details']) {
    assert.ok(controlSrc21.includes(`<CanvasStatusSection\n              id="${id}"`),
      `【状态抽屉】缺少独立功能区：${id}`)
  }
  assert.ok(controlSrc21.includes('useRoomPathItems(tabId)') && controlSrc21.includes('useRecentRooms(tabId)')
    && controlSrc21.includes('toggleCanvasStatusSection(id)'),
    '【状态抽屉】路径 / 历史 / 分区折叠必须接到统一偏好源')
  assert.ok(controlSrc21.includes('data-tm-lod-depth-panel') && controlSrc21.includes('data-tm-graph-profile-select')
    && controlSrc21.includes('data-tm-lod-preserved-depth-select') && controlSrc21.includes('data-tm-room-overview-open='),
    '【状态抽屉】融合不得丢掉镜头 / 诊断 / 总览控件')
  assert.ok(sectionSrc21.includes('data-tm-status-section={id}')
    && sectionSrc21.includes('data-tm-status-section-open={open ? \'true\' : \'false\'}')
    && sectionSrc21.includes('max-h-0 opacity-0 pointer-events-none'),
    '【状态抽屉】分区折叠只改高度 / 透明度，DOM 常驻（GUI 仍要读诊断文本）')
  assert.ok(prefsSrc21.includes('topomind_canvas_status_v1') && prefsSrc21.includes('useSyncExternalStore')
    && prefsSrc21.includes('LEGACY_RECENT_KEY')
    && ['path', 'view', 'recent', 'details'].every((id) => prefsSrc21.includes(`${id}:`)),
    '【状态抽屉】四个分区开关必须独立持久化并兼容旧「最近打开」折叠键')
  assert.ok(pathSrc21.includes('compactRoomPath') && pathSrc21.includes('hasMiddle')
    && pathSrc21.includes('max-h-40') && pathSrc21.includes('data-tm-room-path-list=""'),
    '【长路径】标题只留首段 + 省略 + 当前段，完整链路放进限高滚动区')
  assert.ok(!recentSrc21.includes('usePersistedCollapsed') && recentSrc21.includes('useRecentRooms')
    && recentSrc21.includes('max-h-44'),
    '【状态抽屉】历史列表不再自带折叠壳，改由抽屉统一管')
  assert.ok(guiSrc21.includes('画布状态抽屉：') && guiSrc21.includes('data-tm-canvas-status-toggle'),
    '【状态抽屉】GUI 必须端到端实测融合 / 分区独立折叠 / 整体折叠')
}

// --- 第 22 组：选中子树（2026-11-11）---
// 以选中节点为根，沿从属边选中整棵子树。esbuild 真跑纯函数（树校验 / 旧关系值 /
// related 边 / 脏数据 / 幂等 / 引用复用），另加源码守卫确认菜单、右键与接线。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/selectSubtree.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    banner: { js: 'globalThis.window = globalThis.window || {};' },
  })
  const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const { collectSubtreeNodeIds, applySubtreeSelection } = m
  const sorted = (ids: string[]) => [...ids].sort()

  const nodes22 = [
    { id: 'root', data: { label: '根' }, selected: false },
    { id: 'a', data: { label: 'A' }, selected: false },
    { id: 'b', selected: false },
    { id: 'a1', selected: false },
    { id: 'a2', selected: false },
    { id: 'free1', selected: true },
    { id: 'free2', selected: false },
    { id: 'other', selected: false },
  ]
  const edges22 = [
    { id: 'e1', source: 'root', target: 'a', relation: 'subordinate' },
    { id: 'e2', source: 'root', target: 'b', relation: 'subordinate' },
    // 旧中文关系值必须在读盘兼容层映射回 subordinate。
    { id: 'e3', source: 'a', target: 'a1', relation: '从属' },
    { id: 'e4', source: 'a1', target: 'a2', relation: 'subordinate' },
    { id: 'e5', source: 'free1', target: 'free2', relation: 'related' },
    // a2 → root 会成环；other → a1 违反唯一父：两条都应被树校验器降级，且不死循环。
    { id: 'e6', source: 'a2', target: 'root', relation: 'subordinate' },
    { id: 'e7', source: 'other', target: 'a1', relation: 'subordinate' },
  ]

  assert.deepEqual(sorted(collectSubtreeNodeIds(nodes22, edges22, ['root'])),
    ['a', 'a1', 'a2', 'b', 'root'],
    '【选中子树】根的子树含全部后代；related 边与降级边不得进入')
  assert.deepEqual(sorted(collectSubtreeNodeIds(nodes22, edges22, ['a'])), ['a', 'a1', 'a2'],
    '【选中子树】从中间节点展开不得把父节点 / 兄弟分支带上')
  assert.deepEqual(collectSubtreeNodeIds(nodes22, edges22, ['free1']), ['free1'],
    '【选中子树】related 弱关系不构成父子')
  assert.deepEqual(collectSubtreeNodeIds(nodes22, edges22, ['a2']), ['a2'],
    '【选中子树】成环的从属边必须降级，遍历不能回卷')
  const multi = collectSubtreeNodeIds(nodes22, edges22, ['a', 'b', 'a'])
  assert.equal(multi[0], 'a', '【选中子树】多个根按入参顺序展开')
  assert.deepEqual(sorted(multi), ['a', 'a1', 'a2', 'b'], '【选中子树】多个根取并集并去重')
  assert.deepEqual(collectSubtreeNodeIds(nodes22, edges22, ['nope']), [],
    '【选中子树】脏 rootId 不得凭空造出节点')
  assert.equal(applySubtreeSelection(nodes22, edges22, ['nope']), null,
    '【选中子树】没有有效根时不产出补丁')

  const patch22 = applySubtreeSelection(nodes22, edges22, ['a'])
  assert.ok(patch22, '【选中子树】必须产出选中补丁')
  assert.deepEqual(sorted(patch22.subtreeIds), ['a', 'a1', 'a2'])
  assert.deepEqual(sorted(patch22.addedIds), ['a', 'a1', 'a2'])
  assert.equal(patch22.changed, true)
  assert.deepEqual(sorted(patch22.nodes.filter((n: any) => n.selected).map((n: any) => n.id)),
    ['a', 'a1', 'a2'],
    '【选中子树】是替换式选中：原选中的游离节点必须取消')
  assert.equal(patch22.nodes[1].data.label, 'A', '【选中子树】其它字段展开透传')
  assert.ok(patch22.nodes[7] === nodes22[7], '【选中子树】选中态没变的节点保持原引用')
  const patch22b = applySubtreeSelection(patch22.nodes, edges22, ['a'])
  assert.ok(patch22b)
  assert.equal(patch22b.changed, false, '【选中子树】连点两次必须幂等')
  assert.ok(patch22b.nodes.every((n: any, i: number) => n === patch22.nodes[i]),
    '【选中子树】幂等调用不得产生新节点对象')
  assert.equal(applySubtreeSelection(nodes22, edges22, ['free1']).changed, false,
    '【选中子树】叶子根且已选中时是空操作')

  // 渲染层把 relation 放在 data 上；磁盘边放在顶层，两条读盘路径都要通。
  const dataNodes22 = [{ id: 'p' }, { id: 'q' }, { id: 'r' }]
  const dataEdges22 = [
    { id: 'd1', source: 'p', target: 'q', data: { relation: 'subordinate' } },
    { id: 'd2', source: 'q', target: 'r', data: { relation: 'related' } },
  ]
  assert.deepEqual(collectSubtreeNodeIds(dataNodes22, dataEdges22, ['p']), ['p', 'q'],
    '【选中子树】渲染层 data.relation 与顶层 relation 同源')

  const readSrc22 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const domainSrc22 = await readSrc22('src/domain/graph/selectSubtree.ts')
  assert.ok(domainSrc22.includes('buildHierarchy(') && domainSrc22.includes('readEdgeRelationId(')
    && domainSrc22.includes('isSubordinate('),
    '【选中子树】必须复用 graphHierarchy 的唯一树规则，不另写深度推断')
  const opsSrc22 = await readSrc22('src/hooks/useGraph/selectionSubtreeOperations.ts')
  assert.ok(opsSrc22.includes('applySubtreeSelection(') && opsSrc22.includes('store.setNodes(patch.nodes)')
    && opsSrc22.includes('selectedNodeIds') && !opsSrc22.includes('saveLater('),
    '【选中子树】只写运行时 selected 字段：不落盘、不进 undo')
  const graphOpsSrc22 = await readSrc22('src/hooks/useGraph/graphOperations.ts')
  assert.ok(graphOpsSrc22.includes('buildSelectionSubtreeOperations('),
    '【选中子树】操作必须挂在 graphOperations 上')
  const useGraphSrc22 = await readSrc22('src/hooks/useGraph.ts')
  assert.ok(useGraphSrc22.includes('selectSubtree: ops.selectSubtree')
    && !useGraphSrc22.includes('selectSubtree: edit('),
    '【选中子树】选中是视图态，不得被只读写闸门误拦')
  const contextSrc22 = await readSrc22('src/contexts/GraphContext.tsx')
  assert.ok(contextSrc22.includes('selectSubtree: graph.selectSubtree'),
    '【选中子树】方法必须经 GraphContext 暴露给画布与右键菜单')
  const canvasSrc22 = await readSrc22('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  assert.ok(canvasSrc22.includes('showSelectionMenu') && canvasSrc22.includes('selectedIds={selectedNodeIds}')
    && canvasSrc22.includes('onSelectSubtree={graph.selectSubtree}'),
    '【选中子树】单选就要出菜单，且必须传真实选中 id 列表')
  const menuSrc22 = await readSrc22('src/features/graph/GraphCanvas/components/SelectionMirrorMenu.tsx')
  assert.ok(menuSrc22.includes('Panel position="top-center"')
    && menuSrc22.includes('data-tm-selection-menu') && menuSrc22.includes('data-tm-selection-subtree')
    && menuSrc22.includes('data-tm-selection-ids') && menuSrc22.includes('data-tm-selection-mirror-menu')
    && menuSrc22.includes('data-tm-selection-mirror-flip'),
    '【选中子树】上方菜单同时保留镜像诊断契约，并暴露选中 ids 供 GUI 断言')
  const ctxMenuSrc22 = await readSrc22('src/features/graph/GraphPage/components/GraphPageContextMenu.tsx')
  assert.ok(ctxMenuSrc22.includes("label: '选中子树'") && ctxMenuSrc22.includes('onSelectSubtree(targetId)'),
    '【选中子树】节点右键菜单必须有独立入口')
  const pageActionsSrc22 = await readSrc22('src/features/graph/GraphPage/model/useGraphPageActions.ts')
  assert.ok(pageActionsSrc22.includes('graph.selectSubtree([nodeId])'),
    '【选中子树】右键入口必须以被右键的节点为根')
  const guiSrc22 = await readSrc22('scripts/verify-linked-documents-gui.mjs')
  assert.ok(guiSrc22.includes('选中子树：') && guiSrc22.includes('data-tm-selection-subtree')
    && guiSrc22.includes('data-tm-selection-ids'),
    '【选中子树】GUI 必须端到端实测单选菜单 / 整树选中 / 幂等 / 右键入口')
}

// --- 第 23 组：学习统计面板信息架构精简（2026-11-11）---
// 重构目标：一屏看全貌（今日 / 4 个核心 KPI / 热力图 / 趋势），细节按需展开；
// 删除复述型结论、功能自述、重复指标卡与硬编码色阶。这里是源码级守卫，
// 防止旧版 20+ 区块 / 40+ 指标卡回灌。
{
  const readSrc23 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const root23 = 'src/plugins/builtin/learning-statistics/'
  const [page23, overview23, detail23, parts23, preview23] = await Promise.all([
    readSrc23(root23 + 'LearningStatisticsPage.tsx'),
    readSrc23(root23 + 'LearningOverviewPanel.tsx'),
    readSrc23(root23 + 'LearningDetailPanel.tsx'),
    readSrc23(root23 + 'LearningStatisticsParts.tsx'),
    readSrc23(root23 + 'LearningQuickPreview.tsx'),
  ])
  const views23 = [page23, overview23, detail23].join('\n')
  const all23 = [views23, parts23, preview23].join('\n')
  const count23 = (source: string, needle: string) => source.split(needle).length - 1

  // SSR 断言（verify-plugin-runtime-guards）依赖首屏含「学习统计」；loading 态也必须可见。
  assert.ok(page23.includes('>学习统计</h1>'),
    '【学习统计精简】页面标题必须保留，插件运行时守卫以 renderToStaticMarkup 断言')
  assert.ok(page23.includes('data-tm-learning-filter') && count23(page23, '<select') === 2,
    '【学习统计精简】上下文筛选压成一行工具栏：两个下拉，不再是大卡片 + 9 个 pill')

  // 新信息架构的四层：今日 Hero / 唯一 KPI 行 / 两张主图 / 按需明细。
  assert.ok(overview23.includes('data-tm-learning-overview') && overview23.includes('data-tm-learning-hero')
    && overview23.includes('data-tm-learning-kpi') && overview23.includes('testId="heatmap"')
    && overview23.includes('testId="trend"'),
    '【学习统计精简】核心概览 = 今日 Hero + KPI + 热力图 + 趋势图')
  assert.ok(detail23.includes('testId="distribution"') && detail23.includes('data-tm-learning-day-detail')
    && detail23.includes('onBackToSummary'),
    '【学习统计精简】未选日期只看分布，选日期才展开当天明细并可返回')
  assert.ok(parts23.includes('export function MetricTile') && parts23.includes('export function DistributionCard')
    && overview23.includes("from './LearningStatisticsParts.tsx'")
    && detail23.includes("from './LearningStatisticsParts.tsx'"),
    '【学习统计精简】两个面板共用一套展示原语，不各写一份指标卡 / 分布卡')

  // 每个关键指标只出现一次，杜绝左右栏互相复述。
  for (const label of ['范围总时长', '日均时长', '活跃天数', '达标天数', '今日学习']) {
    assert.equal(count23(views23, label), 1,
      `【学习统计精简】「${label}」在主视图只能出现 1 次`)
  }
  assert.equal(count23(views23, 'goalAnalytics'), 0,
    '【学习统计精简】多套达标率 / 本周目标节奏已删除，不再计算 goalAnalytics')
  assert.equal(count23(views23, 'computeGoalAnalytics'), 0,
    '【学习统计精简】页面不得再引入目标分析派生数据')

  // 冗余文案清单：功能自述、英文 eyebrow、复述型结论段落、旧版独立大区块。
  const removed23 = [
    'Learning Center', 'Now Learning', 'Range Summary', 'Day Detail',
    '已接入概览区', '当前范围汇总', '范围观察', '目标结论',
    '本周累计目标', '学习节奏', '目标完成情况', 'Session 时间轴',
    '当日时段分布', '当前未启用上下文筛选', 'grid-cols-12',
    '正在整理', '点击热力图日期可在右侧',
  ]
  for (const text of removed23) {
    assert.equal(count23(all23, text), 0,
      `【学习统计精简】冗余文案「${text}」不得回灌`)
  }

  // 单色制：热力色阶改用 accent 的 color-mix，删除硬编码橙红（含暗色缺失的 hex）。
  assert.ok(parts23.includes('export function heatColorStyle') && parts23.includes('color-mix(in srgb, var(--color-accent)')
    && parts23.includes('export function heatCellStyle') && preview23.includes('heatCellStyle(')
    && !all23.includes('#fdd9c9') && !all23.includes('#c63d34'),
    '【学习统计精简】热力色阶统一到 accent 单色，页面与速览共用')
}

// --- 第 24 组：当天学习记录半小时方块图（2026-11-11）---
// 把冗长的 session 列表换成 48 格半小时方块图。esbuild 真跑切分纯函数
// （半小时边界 / 跨小时 / 跨午夜折回 / 起止相同 / 重叠 session / 脏数据），
// 另加源码守卫确认 UI 已换成方块图、旧死代码已清理。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundle24 = await build({
    entryPoints: [fileURLToPath(new URL('../src/shared/utils/learningAnalytics.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    banner: { js: 'globalThis.window = globalThis.window || {};' },
  })
  const m24 = await import(`data:text/javascript;base64,${Buffer.from(bundle24.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const { buildDayHalfHourBuckets, DAY_HALF_HOUR_BUCKETS, HALF_HOUR_SECONDS } = m24

  const at24 = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute, 0, 0).getTime()
  const session24 = (id: string, sh: number, sm: number, eh: number, em: number, day = 11, endDay = day) => {
    const startTime = at24(day, sh, sm)
    const endTime = at24(endDay, eh, em)
    return { id, startTime, endTime, duration: Math.round((endTime - startTime) / 1000) }
  }
  const total24 = (buckets: Array<{ duration: number }>) => buckets.reduce((sum, bucket) => sum + bucket.duration, 0)

  assert.equal(DAY_HALF_HOUR_BUCKETS, 48, '【半小时方块】一天固定 48 格')
  assert.equal(HALF_HOUR_SECONDS, 1800, '【半小时方块】每格容量 30 分钟')

  const empty24 = buildDayHalfHourBuckets([])
  assert.equal(empty24.length, 48, '【半小时方块】空输入也返回 48 格')
  assert.equal(total24(empty24), 0, '【半小时方块】空输入全为 0')
  assert.equal(empty24[0].label, '00:00 - 00:30', '【半小时方块】首格标签')
  assert.equal(empty24[1].label, '00:30 - 01:00', '【半小时方块】同小时下半格标签')
  assert.equal(empty24[47].label, '23:30 - 00:00', '【半小时方块】末格跨日标签回绕到 00:00')
  assert.equal(empty24[41].hour, 20, '【半小时方块】index 41 属于 20 点')
  assert.equal(empty24[41].half, 1, '【半小时方块】index 41 是下半格')
  assert.equal(empty24[41].label, '20:30 - 21:00', '【半小时方块】index 41 标签')

  const cross24 = buildDayHalfHourBuckets([session24('a', 20, 0, 20, 45)])
  assert.equal(cross24[40].duration, 1800, '【半小时方块】20:00–20:30 整格填满')
  assert.equal(cross24[41].duration, 900, '【半小时方块】20:30–20:45 只占下半格 15 分钟')
  assert.equal(total24(cross24), 2700, '【半小时方块】各格合计等于 session 墙钟跨度')
  assert.deepEqual(cross24[40].sessionIds, ['a'], '【半小时方块】记录该格来源 session')
  assert.deepEqual(cross24[41].sessionIds, ['a'], '【半小时方块】同一 session 跨两格分别记录')

  const boundary24 = buildDayHalfHourBuckets([session24('b', 20, 30, 21, 0)])
  assert.equal(boundary24[40].duration, 0, '【半小时方块】20:30 起不得溢出到上半格')
  assert.equal(boundary24[41].duration, 1800, '【半小时方块】恰好 30 分钟只落一格')
  assert.equal(boundary24[42].duration, 0, '【半小时方块】21:00 边界不落到下一小时')

  const instant24 = buildDayHalfHourBuckets([{
    id: 'live', startTime: at24(11, 20, 10), endTime: at24(11, 20, 10), duration: 600,
  }])
  assert.equal(instant24[40].duration, 600, '【半小时方块】起止相同的进行中 session 整段计入起始半格')
  assert.equal(total24(instant24), 600, '【半小时方块】零跨度 session 不丢时长')

  const overlap24 = buildDayHalfHourBuckets([
    session24('a', 20, 0, 20, 20),
    session24('b', 20, 10, 20, 30),
  ])
  assert.equal(overlap24[40].duration, 2400, '【半小时方块】重叠 session 的格内时长累加')
  assert.deepEqual(overlap24[40].sessionIds, ['a', 'b'], '【半小时方块】格内 sessionIds 去重且按时间顺序')

  const midnight24 = buildDayHalfHourBuckets([session24('n', 23, 45, 0, 15, 11, 12)])
  assert.equal(midnight24[47].duration, 900, '【半小时方块】跨午夜前半段落 23:30–00:00')
  assert.equal(midnight24[0].duration, 900, '【半小时方块】跨午夜后半段按小时折回 00:00–00:30')
  assert.equal(total24(midnight24), 1800, '【半小时方块】跨午夜总时长不丢')

  const dirty24 = buildDayHalfHourBuckets([
    { id: 'nan', startTime: NaN, endTime: NaN, duration: NaN },
    { id: 'rev', startTime: at24(11, 9, 0), endTime: at24(11, 8, 0), duration: 300 },
    null,
  ])
  assert.equal(dirty24.length, 48, '【半小时方块】脏数据仍返回 48 格且不抛错')
  assert.ok(dirty24.every((bucket: any) => Number.isFinite(bucket.duration)),
    '【半小时方块】脏数据不得把 NaN 写进格子')
  assert.equal(dirty24[18].duration, 300, '【半小时方块】end < start 按零跨度处理')
  assert.equal(buildDayHalfHourBuckets(null).length, 48, '【半小时方块】非数组输入安全降级')

  const readSrc24 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const analyticsSrc24 = await readSrc24('src/shared/utils/learningAnalytics.ts')
  assert.ok(analyticsSrc24.includes('export const buildDayHalfHourBuckets')
    && analyticsSrc24.includes('export const HALF_HOUR_SECONDS')
    && !analyticsSrc24.includes('export const buildDayHourBuckets'),
    '【半小时方块】半小时切分是算法层唯一入口，旧的小时桶死代码已清理')
  assert.ok(analyticsSrc24.includes('if (segmentEnd <= cursor) break'),
    '【半小时方块】分摊循环必须有防死循环保护')
  assert.ok(analyticsSrc24.includes('appendSessionHours(hourTotals, session)'),
    '【半小时方块】范围趋势的小时统计仍复用 appendSessionHours，不得误删')
  const blocksSrc24 = await readSrc24('src/plugins/builtin/learning-statistics/DayHalfHourBlocks.tsx')
  assert.ok(blocksSrc24.includes('buildDayHalfHourBuckets(sessions)')
    && blocksSrc24.includes('HALF_HOUR_SECONDS')
    && blocksSrc24.includes('heatCellStyle(')
    && blocksSrc24.includes('grid-flow-col')
    && blocksSrc24.includes('repeat(24, ${HEAT_CELL_SIZE}px)')
    && blocksSrc24.includes('repeat(2, ${HEAT_CELL_SIZE}px)'),
    '【半小时方块】2 行 × 24 列共用热力格子，色深按 30 分钟容量归一')
  assert.ok(blocksSrc24.includes('data-tm-learning-half-hour')
    && blocksSrc24.includes('data-tm-learning-half-hour-block')
    && blocksSrc24.includes('data-tm-half-hour-duration')
    && blocksSrc24.includes('data-tm-learning-half-hour-detail'),
    '【半小时方块】方块与按需展开明细都要暴露诊断属性')
  const detailSrc24 = await readSrc24('src/plugins/builtin/learning-statistics/LearningDetailPanel.tsx')
  assert.ok(detailSrc24.includes('<DayHalfHourBlocks') && detailSrc24.includes('key={selectedDate}'),
    '【半小时方块】日明细接入方块图，切日期用 key 收起上次展开')
  assert.ok(!detailSrc24.includes('sessions.map(') && !detailSrc24.includes('divide-y divide-')
    && !detailSrc24.includes('这一天没有符合当前筛选条件的学习记录'),
    '【半小时方块】冗长的 session 列表与旧空状态必须移除')
}

// --- 第 25 组：当天热力图与「每日记录」共用同一视觉（2026-11-11）---
// 用户要求当天记录「就是跟每日记录一样的热力图」：13px 正方形格、4px 间距、
// 同一 accent 色阶、悬停读数、点击选中，全部收敛到 HeatCell 唯一原语。
{
  const readSrc25 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const parts25 = await readSrc25('src/plugins/builtin/learning-statistics/LearningStatisticsParts.tsx')
  const overview25 = await readSrc25('src/plugins/builtin/learning-statistics/LearningOverviewPanel.tsx')
  const blocks25 = await readSrc25('src/plugins/builtin/learning-statistics/DayHalfHourBlocks.tsx')
  const preview25 = await readSrc25('src/plugins/builtin/learning-statistics/LearningQuickPreview.tsx')

  assert.ok(parts25.includes('export const HEAT_CELL_SIZE = 13')
    && parts25.includes('export function HeatCell')
    && parts25.includes('export function heatCellStyle')
    && parts25.includes('heatColorStyle(duration, capacity)'),
    '【热力图统一】格子尺寸 / 组件 / 色阶必须在共用原语里唯一定义')
  assert.ok(parts25.includes('width: HEAT_CELL_SIZE, height: HEAT_CELL_SIZE'),
    '【热力图统一】格子必须是正方形，不再有拉伸长条')
  assert.ok(overview25.includes('<HeatCell') && !overview25.includes('const CELL_SIZE')
    && overview25.includes('grid-flow-col')
    && overview25.includes('repeat(7, ${HEAT_CELL_SIZE}px)'),
    '【热力图统一】每日记录热力图消费共用格子，7 行日历布局不变')
  assert.ok(blocks25.includes('<HeatCell') && blocks25.includes('grid-flow-col')
    && blocks25.includes('repeat(2, ${HEAT_CELL_SIZE}px)')
    && blocks25.includes('repeat(24, ${HEAT_CELL_SIZE}px)')
    && !blocks25.includes('minmax(0, 1fr)') && !blocks25.includes('h-[18px]'),
    '【热力图统一】当天 48 格为 2 行 × 24 列同款正方形格')
  assert.ok(blocks25.includes('data-tm-learning-half-hour-aside')
    && blocks25.includes('hoveredBucket')
    && blocks25.includes('data-tm-learning-half-hour-block')
    && blocks25.includes('data-tm-half-hour-index')
    && blocks25.includes('data-tm-half-hour-duration'),
    '【热力图统一】悬停读数与格子诊断属性保留')
  assert.ok(blocks25.includes('[0, 0.3, 0.55, 0.8, 1.2]')
    && blocks25.includes('点击方块查看该时段'),
    '【热力图统一】图例与每日记录一致（少 → 多 5 档 + 操作提示）')
  assert.ok(preview25.includes('HEAT_CELL_SIZE') && preview25.includes('heatCellStyle('),
    '【热力图统一】标题栏速览也用同一尺寸与色阶')
  assert.ok(!blocks25.includes('每格 30 分钟 · 上排') && !overview25.includes('heatColorStyle('),
    '【热力图统一】删除拉伸长条说明条与面板内重复色阶调用')
}

// --- 第 26 组：恢复固定步进 + 只读提示条下方的缩放滑动条（2026-11-11 晚）---
// 用户：鼠标步进偏慢 → 回到上一版固定步进；只读提示条下方加 range 滑动条，
// 拖动可快速改比例，显隐与提示条完全同源（不自己判定 readOnly）。
{
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundle26 = await build({
    entryPoints: [fileURLToPath(new URL('../src/domain/graph/zoomScale.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const z26 = await import(`data:text/javascript;base64,${Buffer.from(bundle26.outputFiles[0].text).toString('base64')}`) as Record<string, any>
  const {
    DENSITY_STEP_SCALING_ENABLED: enabled26, MIN_RAW_ZOOM: minRaw26,
    ZOOM_REFERENCE: ref26, MIN_DISPLAY_PERCENT: minPct26, MAX_DISPLAY_PERCENT: maxPct26,
    fromDisplayPercent: fromPct26, toDisplayPercent: toPct26,
    zoomStepSensitivityForGraph: stepSens26, wheelSensitivityForZoom: wheelSens26,
  } = z26

  assert.equal(enabled26, false, '【恢复固定步进】缩放配置必须停在上一次的固定步进')
  assert.equal(stepSens26(1000, 20), 1, '【恢复固定步进】步进灵敏度恒 1')
  assert.equal(wheelSens26(ref26, 1000, 20), 1, '【恢复固定步进】滚轮不再被密度降速')
  assert.equal(minPct26, 5, '【缩放滑动条】左端点 5%')
  assert.equal(maxPct26, 100, '【缩放滑动条】右端点 100%')
  assert.equal(fromPct26(minPct26), minRaw26, '【缩放滑动条】5% 换算到 raw 下限')
  assert.equal(fromPct26(maxPct26), ref26, '【缩放滑动条】100% 换算到 raw 上限')
  assert.equal(fromPct26(0), minRaw26, '【缩放滑动条】越界低值要钳到 5%')
  assert.equal(fromPct26(200), ref26, '【缩放滑动条】超过 100% 要钳到 100%')
  for (const p of [5, 20, 50, 85, 100]) {
    assert.equal(toPct26(fromPct26(p)), p, `【缩放滑动条】${p}% 往返换算无损`)
  }

  const readSrc26 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const slider26 = await readSrc26('src/features/graph/GraphCanvas/components/CanvasZoomSlider.tsx')
  assert.ok(slider26.includes('type="range"')
    && slider26.includes('min={MIN_DISPLAY_PERCENT}')
    && slider26.includes('max={MAX_DISPLAY_PERCENT}')
    && slider26.includes('step={1}')
    && slider26.includes('value={percent}')
    && slider26.includes('fromDisplayPercent(next)')
    && slider26.includes('duration: 0'),
    '【缩放滑动条】5~100% 受控 range，拖动即时 zoomTo 且钳制在合法区间')
  assert.ok(slider26.includes('nodrag nowheel')
    && slider26.includes('accentColor')
    && !slider26.includes('fitView('),
    '【缩放滑动条】不吃画布拖拽/滚轮手势、单色 accent、不重排视野')
  assert.ok(slider26.includes('data-tm-canvas-zoom-slider=')
    && slider26.includes('data-tm-canvas-zoom-slider-input=')
    && slider26.includes('data-tm-canvas-zoom-slider-value=')
    && slider26.includes('data-tm-canvas-zoom-slider-readout='),
    '【缩放滑动条】诊断属性与读数必须暴露给 GUI')
  assert.ok(!slider26.includes('CanvasReadOnlyState')
    && !slider26.includes('computeCanvasReadOnly')
    && !slider26.includes('state.readOnly'),
    '【缩放滑动条】不得自己判定只读，显隐必须完全由提示条托管')
  const banner26 = await readSrc26('src/features/graph/GraphCanvas/components/CanvasReadOnlyBanner.tsx')
  assert.ok(banner26.includes('if (!state.readOnly) return null')
    && banner26.includes('<CanvasZoomSlider zoomLevel={zoomLevel} />')
    && banner26.includes('flex flex-col')
    && banner26.includes('pointer-events-none'),
    '【缩放滑动条】挂在提示条同一 Panel 下方，显隐复用同一个 readOnly 判定')
  const canvas26 = await readSrc26('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  assert.ok(canvas26.includes('<CanvasReadOnlyBanner state={readOnlyState} zoomLevel={zoomLevel} />'),
    '【缩放滑动条】挂载点仍是画布的只读提示组件')
  const gui26 = await readSrc26('scripts/verify-linked-documents-gui.mjs')
  assert.ok(gui26.includes('阶段 S') && gui26.includes('data-tm-canvas-zoom-slider'),
    '【缩放滑动条】GUI 阶段 S 必须实测出现/隐藏与拖动')
}

// 任务 #76~#79：统一资源树（节点树 + 节点内文档树）——按层加载、离散节点分组、
// 派生索引搜索 / 定位。主进程服务用内存 fs 真跑，不靠源码字面量蒙混。
{
  const posix = (await import('node:path')).posix
  const treeService = await import(
    new URL('../electron/services/unified-document-tree-service.js', import.meta.url).href
  ) as Record<string, any>

  const dirs = new Map<string, string[]>()
  const files = new Map<string, string>()
  const stats = new Map<string, { mtimeMs: number, size: number, ctimeMs: number }>()
  let writes = 0
  const putFile = (p: string, value: unknown, mtimeMs = 1) => {
    const text = JSON.stringify(value)
    files.set(p, text)
    stats.set(p, { mtimeMs, size: text.length, ctimeMs: 1 })
  }
  const addDir = (p: string, names: string[]) => dirs.set(p, names)
  const fsMock = {
    existsSync: (p: string) => files.has(p) || dirs.has(p),
    readdirSync: (p: string) => (dirs.get(p) ?? []).map((name) => ({
      name,
      isDirectory: () => dirs.has(`${p}/${name}`),
    })),
    statSync: (p: string) => {
      const stat = stats.get(p)
      if (!stat) throw new Error('ENOENT ' + p)
      return stat
    },
  }
  const docsOf = (spec: Record<string, { title: string, parentId?: string }>) => ({
    version: 2,
    documents: Object.fromEntries(Object.entries(spec).map(([id, item], index) => [id, {
      id, type: 'smart', title: item.title, path: `${id}.tdoc.json`,
      parentId: item.parentId ?? null, sortOrder: index,
    }])),
  })
  // 房间与从属连线两种层级同时存在：room 是连线树根，free 是它的 subordinate
  // 子节点，empty 无文档应被剪掉，bridge 自身无文档但 leaf 有文档 → 仅路径容器。
  const graphMetas: Record<string, any> = {
    '': { children: {} },
    KB1: {
      children: {
        room: { name: '房间一' },
        free: { name: '离散画布节点' },
        empty: { name: '空节点' },
        bridge: { name: '路径容器' },
      },
      edges: [
        { id: 'e1', source: 'room', target: 'free', relation: 'subordinate' },
        { id: 'e2', source: 'empty', target: 'free', relation: 'subordinate' },
        { id: 'e3', source: 'free', target: 'room', relation: 'subordinate' },
        { id: 'e4', source: 'room', target: 'empty', relation: 'related' },
        { id: 'e5', source: 'room', target: 'bridge', relation: '从属' },
      ],
    },
    'KB1/room': { children: { 'card-a': { name: '节点 A' } } },
    'KB1/bridge': { children: { leaf: { name: '叶子节点' } } },
    KB2: { children: {} },
  }

  addDir('/root', ['kbs', '_docs'])
  addDir('/root/kbs', ['KB1', 'KB2'])
  addDir('/root/kbs/KB1', ['_docs', 'room', 'free', 'bridge'])
  addDir('/root/kbs/KB1/room', ['_docs', 'card-a', 'stray'])
  addDir('/root/kbs/KB1/room/card-a', ['_docs'])
  addDir('/root/kbs/KB1/room/stray', ['_docs'])
  addDir('/root/kbs/KB1/free', ['_docs'])
  addDir('/root/kbs/KB1/bridge', ['_docs', 'leaf'])
  addDir('/root/kbs/KB1/bridge/leaf', ['_docs'])
  addDir('/root/kbs/KB2', ['_docs'])
  for (const d of [
    '/root/_docs', '/root/kbs/KB1/_docs', '/root/kbs/KB1/room/_docs',
    '/root/kbs/KB1/room/card-a/_docs', '/root/kbs/KB1/room/stray/_docs',
    '/root/kbs/KB1/free/_docs', '/root/kbs/KB1/bridge/leaf/_docs', '/root/kbs/KB2/_docs',
  ]) addDir(d, ['tree.json'])
  putFile('/root/_docs/tree.json', docsOf({ doc_root: { title: '工作区根文档' } }))
  putFile('/root/kbs/KB1/_docs/tree.json', docsOf({
    doc_kb_root: { title: 'KB 根文档' },
    doc_kb_child: { title: 'KB 子文档', parentId: 'doc_kb_root' },
  }))
  putFile('/root/kbs/KB1/room/_docs/tree.json', docsOf({ doc_room: { title: '房间文档' } }))
  putFile('/root/kbs/KB1/room/card-a/_docs/tree.json', docsOf({
    doc_a: { title: '文档 A' },
    doc_a_child: { title: 'A 的子文档', parentId: 'doc_a' },
    doc_orphan: { title: '孤儿文档', parentId: 'doc_missing' },
    doc_cycle1: { title: '环一', parentId: 'doc_cycle2' },
    doc_cycle2: { title: '环二', parentId: 'doc_cycle1' },
  }))
  putFile('/root/kbs/KB1/room/stray/_docs/tree.json', docsOf({ doc_stray: { title: '离散节点文档' } }))
  putFile('/root/kbs/KB1/free/_docs/tree.json', docsOf({ doc_free: { title: '连线子文档' } }))
  putFile('/root/kbs/KB1/bridge/leaf/_docs/tree.json', docsOf({ doc_leaf: { title: '叶子文档' } }))
  putFile('/root/kbs/KB2/_docs/tree.json', docsOf({ doc_b: { title: '文档 B' } }))

  const service = treeService.createUnifiedDocumentTreeService({
    fs: fsMock,
    path: posix,
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath: (_root: string, rel: string) => (rel ? `/root/kbs/${rel}` : '/root/kbs'),
    readGraphMeta: (_root: string, roomPath: string) => graphMetas[roomPath] ?? { children: {} },
    readJsonFile: (p: string) => (files.has(p) ? JSON.parse(files.get(p) as string) : {}),
    writeJsonFile: (p: string, value: unknown) => { writes += 1; putFile(p, value, 2) },
    statSync: (p: string) => fsMock.statSync(p),
  })

  // 1) key 协议：对渲染层不透明、可往返、恶意 key 一律拒绝。
  const cardKey = treeService.cardTreeKey('KB1/room/card-a')
  const docKey = treeService.documentTreeKey('KB1/room/card-a', 'doc_a')
  assert.equal(treeService.parseUnifiedTreeKey(cardKey).cardPath, 'KB1/room/card-a', '【统一树】card key 必须可往返')
  assert.equal(treeService.parseUnifiedTreeKey(docKey).docId, 'doc_a', '【统一树】document key 必须可往返')
  assert.equal(treeService.parseUnifiedTreeKey(treeService.UNIFIED_TREE_ROOT_KEY).kind, 'root', '【统一树】root key')
  for (const bad of ['kb:..%2F..', 'doc:KB1:', 'kb:', 'garbage', 'doc:..%2Fetc:x']) {
    assert.equal(treeService.parseUnifiedTreeKey(bad).kind, 'unknown', `【统一树】非法 key 必须拒绝: ${bad}`)
  }

  // 2) 默认只加载顶层根：绝不返回任何文档、绝不读 tree.json、绝不建索引。
  const rootLevel = service.listTreeLevel('/root', treeService.UNIFIED_TREE_ROOT_KEY)
  assert.equal(rootLevel.nodes.length, 4, '【统一树】顶层＝工作区根 + 2 个知识库 + 离散节点分组')
  assert.ok(rootLevel.nodes.every((n: any) => n.kind !== 'document'),
    '【统一树】默认层不得平铺任何文档（这是打开不再全量加载的核心）')
  assert.equal(writes, 0, '【统一树】打开树视图不得写搜索索引')
  assert.ok(rootLevel.nodes.some((n: any) => n.kind === 'group' && n.key === treeService.UNIFIED_TREE_ORPHANS_KEY),
    '【统一树】离散节点必须有独立分组入口')

  // 3) 房间层＝从属森林第一层（只列有文档的节点）+ 该节点的文档树根文档。
  const kbLevel = service.listTreeLevel('/root', treeService.cardTreeKey('KB1'))
  const kbCards = kbLevel.nodes.filter((n: any) => n.kind === 'card')
  const kbDocs = kbLevel.nodes.filter((n: any) => n.kind === 'document')
  assert.deepEqual(kbCards.map((n: any) => n.cardPath), ['KB1/room'],
    '【统一树】房间第一层只留连线树根：空节点 / 无文档 related 目标 / 连线子节点都不出现')
  assert.equal(kbCards[0].label, '房间一', '【统一树】子节点必须显示 graph meta 里的可读名称')
  assert.equal(kbCards[0].origin, 'subordinate', '【统一树】带 subordinate 出边的树根标为从属来源')
  assert.equal(kbCards[0].hasDocuments, true, '【统一树】有文档的节点显式标记 hasDocuments')
  assert.equal(kbDocs.length, 1, '【统一树】节点层只给根文档，子文档留给下一层')
  assert.equal(kbDocs[0].candidate?.docId, 'doc_kb_root', '【统一树】根文档节点携带完整候选 DTO')
  assert.equal(kbDocs[0].candidate?.documentPathLabel, '', '【统一树】顶层文档没有节点内路径')
  assert.equal(kbDocs[0].hasChildren, true, '【统一树】有子文档的文档节点才可展开')

  const childLevel = service.listTreeLevel('/root', treeService.documentTreeKey('KB1', 'doc_kb_root'))
  assert.equal(childLevel.nodes.length, 1, '【统一树】文档层只返回直接子文档')
  assert.equal(childLevel.nodes[0].candidate?.documentPathLabel, 'KB 根文档',
    '【统一树】子文档路径按祖先标题链生成')
  assert.equal(childLevel.nodes[0].subtitle, 'KB1', '【统一树】文档行仍显示所属节点面包屑')

  // 3b) 展开连线树根：同一层里「从属连线子节点 / 房间子节点 / 仅路径容器」用 origin 区分。
  const roomLevel = service.listTreeLevel('/root', treeService.cardTreeKey('KB1/room'))
  const roomCard = (p: string) => roomLevel.nodes.find((n: any) => n.cardPath === p)
  assert.equal(roomCard('KB1/free')?.origin, 'subordinate',
    '【统一树】父房间连线边指下来的子节点标为从属来源')
  assert.equal(roomCard('KB1/room/card-a')?.origin, 'room',
    '【统一树】本节点房间画布里的子节点标为房间来源')
  assert.equal(roomCard('KB1/bridge')?.origin, 'path',
    '【统一树】自身无文档、仅靠后代有文档保留的容器标为仅路径')
  assert.equal(roomCard('KB1/bridge')?.hasDocuments, false,
    '【统一树】仅路径容器必须显式标记自身没有文档')
  assert.equal(roomLevel.nodes.filter((n: any) => n.kind === 'document').length, 1,
    '【统一树】房间层仍带该节点自己的根文档')
  assert.ok(!roomLevel.nodes.some((n: any) => n.cardPath === 'KB1/empty'),
    '【统一树】无文档且无有文档后代的节点一律不列')
  const bridgeLevel = service.listTreeLevel('/root', treeService.cardTreeKey('KB1/bridge'))
  assert.equal(bridgeLevel.nodes.filter((n: any) => n.cardPath === 'KB1/bridge/leaf').length, 1,
    '【统一树】仅路径容器仍能展开到真正挂文档的后代')
  assert.equal(bridgeLevel.nodes[0]?.origin, 'room',
    '【统一树】路径容器的后代按自己的房间关系标注')

  // 4) 文档树坏数据：父缺失 / 互相成环一律降级为根，任何文档都不会丢失。
  const deepLevel = service.listTreeLevel('/root', treeService.cardTreeKey('KB1/room/card-a'))
  const deepIds = deepLevel.nodes.filter((n: any) => n.kind === 'document').map((n: any) => n.candidate?.docId)
  assert.deepEqual(deepIds.sort(), ['doc_a', 'doc_cycle1', 'doc_cycle2', 'doc_orphan'].sort(),
    '【统一树】父缺失 / 成环文档降级为根，子文档不提前出现')

  // 5) 工作区根节点只展示自己的文档，不把知识库当子节点重复一遍。
  const rootDocsLevel = service.listTreeLevel('/root', treeService.cardTreeKey('__ROOT__'))
  assert.equal(rootDocsLevel.nodes.length, 1, '【统一树】__ROOT__ 层只给自己的文档')
  assert.equal(rootDocsLevel.nodes[0].candidate?.docId, 'doc_root', '【统一树】工作区根文档可被找到')

  // 6) 离散节点：物理存在但父房间未登记，展开分组才全库扫描，且能继续展开出文档。
  const orphanLevel = service.listTreeLevel('/root', treeService.UNIFIED_TREE_ORPHANS_KEY)
  assert.equal(orphanLevel.nodes.length, 1, '【统一树】离散分组只收真正未登记的节点')
  assert.equal(orphanLevel.nodes[0].cardPath, 'KB1/room/stray', '【统一树】离散节点保留真实物理路径')
  assert.equal(orphanLevel.nodes[0].orphan, true, '【统一树】离散节点带标记供 UI 区分')
  const orphanDocs = service.listTreeLevel('/root', treeService.cardTreeKey('KB1/room/stray'))
  assert.equal(orphanDocs.nodes[0].candidate?.docId, 'doc_stray', '【统一树】离散节点的文档仍可逐层读到')

  // 7) 搜索：空 query 不扫描；有 query 走派生索引，签名变化才重解析，损坏可自愈。
  assert.deepEqual(service.searchDocuments('/root', ''), [], '【统一树】空 query 直接返回，不扫描全库')
  assert.equal(writes, 0, '【统一树】空 query 不得创建搜索索引')
  const byNode = service.searchDocuments('/root', '节点 A')
  assert.ok(byNode.some((c: any) => c.docId === 'doc_a'), '【统一树】可按所属节点面包屑检索')
  assert.equal(writes, 1, '【统一树】首次搜索才落盘派生索引')
  // 关键字是父文档标题：既命中该父文档自身，也命中子文档的 documentPathLabel，
  // 而子文档标题「KB 子文档」并不含关键字 —— 这才能证明路径参与了检索。
  const byPath = service.searchDocuments('/root', 'KB 根文档')
  assert.deepEqual(byPath.map((c: any) => c.docId).sort(), ['doc_kb_child', 'doc_kb_root'].sort(),
    '【统一树】可按节点内文档路径检索到标题不含关键字的子文档')
  assert.equal(writes, 1, '【统一树】无变化的搜索必须完全命中索引，不重复写盘')
  putFile('/root/kbs/KB2/_docs/tree.json', docsOf({ doc_b: { title: '文档 B 改名' } }), 9)
  const renamed = service.searchDocuments('/root', '改名')
  assert.equal(renamed[0]?.title, '文档 B 改名', '【统一树】tree.json 签名变化必须增量重解析')
  assert.equal(writes, 2, '【统一树】只重建变化的房间')
  putFile('/root/.topomind/document-tree-index.json', { version: 999 }, 77)
  const healed = service.searchDocuments('/root', '文档 A')
  assert.ok(healed.some((c: any) => c.docId === 'doc_a'), '【统一树】索引损坏必须自动重建且结果正确')

  // 8) 定位：docId → 从根到该文档的 key 链（节点树分段 + 文档祖先链）。
  const pathKeys = service.resolveDocumentPath('/root', 'doc_a_child')
  assert.deepEqual(pathKeys, [
    treeService.UNIFIED_TREE_ROOT_KEY,
    treeService.cardTreeKey('KB1'),
    treeService.cardTreeKey('KB1/room'),
    treeService.cardTreeKey('KB1/room/card-a'),
    treeService.documentTreeKey('KB1/room/card-a', 'doc_a'),
    treeService.documentTreeKey('KB1/room/card-a', 'doc_a_child'),
  ], '【统一树】定位链必须同时覆盖节点树与文档树')
  const freePathKeys = service.resolveDocumentPath('/root', 'doc_free')
  assert.deepEqual(freePathKeys, [
    treeService.UNIFIED_TREE_ROOT_KEY,
    treeService.cardTreeKey('KB1'),
    treeService.cardTreeKey('KB1/room'),
    treeService.cardTreeKey('KB1/free'),
    treeService.documentTreeKey('KB1/free', 'doc_free'),
  ], '【统一树】连线子节点的定位链必须插入 subordinate 祖先，不能只给物理路径')
  assert.deepEqual(service.resolveDocumentPath('/root', 'no_such'), [], '【统一树】不存在的文档返回空链')
  assert.ok(service.listTreeLevel('/root', 'kb:..%2F..').nodes.length === 0,
    '【统一树】路径穿越 key 必须返回空层')

  // 9) 接线守卫：三层 IPC + 存储透传 + 通用 hook/视图 + 两弹窗不再全量加载。
  const readSrc27 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const preload27 = await readSrc27('electron/preload.js')
  const main27 = await readSrc27('electron/main.js')
  const fileService27 = await readSrc27('electron/file-service.js')
  const fsBackend27 = await readSrc27('src/core/fs-backend.ts')
  const file27 = await readSrc27('src/core/storage/file.ts')
  const service27 = await readSrc27('src/core/storage/service.ts')
  const types27 = await readSrc27('src/core/storage/types.ts')
  const treeSrc27 = await readSrc27('electron/services/unified-document-tree-service.js')
  const hook27 = await readSrc27('src/features/documents/unifiedTree/useUnifiedTree.ts')
  const view27 = await readSrc27('src/features/documents/unifiedTree/UnifiedTreeView.tsx')
  const ds27 = await readSrc27('src/features/documents/unifiedTree/createStorageTreeDataSource.ts')
  for (const channel of ['fs:listUnifiedTreeLevel', 'fs:searchUnifiedDocuments', 'fs:resolveUnifiedDocumentPath']) {
    assert.ok(preload27.includes(`'${channel}'`) && main27.includes(`ipcMain.handle('${channel}'`)
      && fileService27.includes(`${channel.split(':')[1]}: function`),
      `【统一树】${channel} 必须贯通 preload / main / file-service`)
  }
  assert.ok(fsBackend27.includes('listUnifiedTreeLevel:')
    && file27.includes('listUnifiedTreeLevel: async')
    && service27.includes('async listUnifiedTreeLevel(')
    && types27.includes('listUnifiedTreeLevel:'),
    '【统一树】FSB / backend / store / types 四层必须同步透传')
  assert.ok(!treeSrc27.includes('scanDocumentEntries(') && !treeSrc27.includes('listDocumentCandidates('),
    '【统一树】按层服务不得回灌全量扫描')
  assert.ok(hook27.includes('loadLevel(UNIFIED_TREE_ROOT_KEY)') && hook27.includes('inflight')
    && hook27.includes('expandPath') && hook27.includes('refresh'),
    '【统一树】hook 必须惰性加载、合并并发、支持定位与刷新')
  assert.ok(view27.includes('data-tm-unified-tree') && view27.includes('data-tm-unified-tree-levels')
    && view27.includes('data-tm-unified-tree-node'),
    '【统一树】视图必须暴露按需加载诊断属性')
  assert.ok(ds27.includes('storage.listUnifiedTreeLevel') && ds27.includes('storage.searchUnifiedDocuments')
    && ds27.includes('storage.resolveUnifiedDocumentPath'),
    '【统一树】数据源适配器必须覆盖层查询 / 搜索 / 定位')
  const gui27 = await readSrc27('scripts/verify-linked-documents-gui.mjs')
  assert.ok(gui27.includes('阶段 T')
    && gui27.includes('data-tm-link-document-levels')
    && gui27.includes('data-tm-doc-link-levels')
    && gui27.includes('data-tm-unified-tree-node'),
    '【统一树】GUI 必须实测「默认只加载一层 / 展开才加载下一层」')
}

// 任务 #81~#84：只列有文档的节点 + 按 subordinate 连线树构造层级 + 房间/从属来源区分。
// 连线森林是模块级纯函数，用真实 import 直接跑，不靠源码字面量蒙混。
{
  const treeService28 = await import(
    new URL('../electron/services/unified-document-tree-service.js', import.meta.url).href
  ) as Record<string, any>
  const forestOf = treeService28.buildSubordinateForest
  assert.equal(typeof forestOf, 'function', '【统一树连线】森林构造必须是可独立真跑的导出纯函数')

  const forest = forestOf({
    children: { a: {}, b: {}, c: {}, d: {}, e: {}, f: {} },
    edges: [
      { id: 'e1', source: 'a', target: 'b', relation: 'subordinate' },
      { id: 'e2', source: 'c', target: 'b', relation: 'subordinate' },
      { id: 'e3', source: 'b', target: 'a', relation: 'subordinate' },
      { id: 'e4', source: 'a', target: 'c', relation: 'related' },
      { id: 'e5', source: 'a', target: 'd', relation: '从属' },
      { id: 'e6', source: 'a', target: 'e', data: { relation: 'subordinate' } },
      { id: 'e7', source: 'a', target: 'a', relation: 'subordinate' },
      { id: 'e8', source: 'a', target: 'missing', relation: 'subordinate' },
    ],
  })
  assert.deepEqual(forest.topLevel.slice().sort(), ['a', 'c', 'f'].sort(),
    '【统一树连线】related 目标 / 无入边节点都是第一层，成环边不得把树根吞掉')
  assert.deepEqual(forest.childrenOf('a').slice().sort(), ['b', 'd', 'e'].sort(),
    '【统一树连线】只认第一条从属入边（多父降级），旧中文值与 data.relation 都要兼容')
  assert.equal(forest.childrenOf('b').length, 0, '【统一树连线】成环边必须降级')
  assert.equal(forest.hasSubordinateChildren('a'), true, '【统一树连线】树根判定只数生效的从属边')
  assert.equal(forest.hasSubordinateChildren('c'), false, '【统一树连线】related 边不算从属出边')

  // 深度上限：102 个节点串成 101 条从属边，最后一条必须被拒（降级为游离）。
  const deepChildren = Object.fromEntries(Array.from({ length: 102 }, (_, i) => [`n${i}`, {}]))
  const deepEdges = Array.from({ length: 101 }, (_, i) => ({
    id: `d${i}`, source: `n${i}`, target: `n${i + 1}`, relation: 'subordinate',
  }))
  const deepForest = forestOf({ children: deepChildren, edges: deepEdges })
  assert.equal(deepForest.topLevel.length, 2,
    '【统一树连线】超过 100 层的边必须降级，绝不无限生长')
  assert.deepEqual(deepForest.topLevel.slice().sort(), ['n0', 'n101'].sort(),
    '【统一树连线】超深降级只影响越界那条边，其余链完整保留')

  const readSrc28 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const treeSrc28 = await readSrc28('electron/services/unified-document-tree-service.js')
  const viewSrc28 = await readSrc28('src/features/documents/unifiedTree/UnifiedTreeView.tsx')
  const dtoSrc28 = await readSrc28('src/core/fs-backend.ts')
  const guiSrc28 = await readSrc28('scripts/verify-linked-documents-gui.mjs')
  assert.ok(treeSrc28.includes('if (!isRelevant(roomPath, nodeId, forest)) return')
    && treeSrc28.includes('forest.childrenOf(nodeId)')
    && treeSrc28.includes("origin: ownDocs ? origin : 'path'")
    && treeSrc28.includes('buildSubordinateForest(parentMeta)')
    && treeSrc28.includes('buildSubordinateForest(selfMeta)'),
    '【统一树连线】房间层必须同时消费剪枝（含连线子树下溯）、来源标注与父/自身两份连线森林')
  assert.ok(treeSrc28.includes('forest.parentOf(cursor)') && treeSrc28.includes('ancestors.unshift(parent)'),
    '【统一树连线】定位链必须按连线祖先补齐，避免 expandPath 展开到一半断链')
  assert.ok(!treeSrc28.includes('registered.has(entry.name)'),
    '【统一树连线】不得回灌「物理游离子目录全量平铺」（离散节点统一归分组）')
  assert.ok(!treeSrc28.includes('readTopoDocument') && !treeSrc28.includes('readFileSync'),
    '【统一树连线】存在性探测只解析 tree.json 清单，不得读文档正文')
  assert.ok(viewSrc28.includes('data-tm-unified-tree-origin')
    && viewSrc28.includes('data-tm-unified-tree-has-docs')
    && viewSrc28.includes('ORIGIN_LABEL') && viewSrc28.includes('GitBranch'),
    '【统一树连线】视图必须用不同图标/徽标区分房间、从属与仅路径')
  assert.ok(dtoSrc28.includes("origin?: 'room' | 'subordinate' | 'path'"),
    '【统一树连线】来源字段必须落在 FSB DTO 上，不能只靠前端猜')
  assert.ok(guiSrc28.includes('阶段 U') && guiSrc28.includes('data-tm-unified-tree-origin'),
    '【统一树连线】GUI 必须实测只列有文档的节点与两类来源标签')
}

// ===== 第 29 组：右栏是画布浮层，展开/折叠不得挤压任何画布布局（2026-11-12） =====
{
  const readSrc29 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const pageSrc29 = await readSrc29('src/features/graph/GraphPage/GraphPage.tsx')
  const panelSrc29 = await readSrc29('src/features/right-panel/RightPanelContainer.tsx')
  const canvasSrc29 = await readSrc29('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  const miniMapSrc29 = await readSrc29('src/features/graph/GraphCanvas/components/CanvasMiniMap.tsx')
  const guiSrc29 = await readSrc29('scripts/verify-linked-documents-gui.mjs')

  assert.ok(pageSrc29.includes('id="app-layout" className="relative w-full h-full"'),
    '【右栏浮层】app-layout 不得再是 flex 两栏，否则右栏会参与布局挤压画布')
  assert.ok(pageSrc29.includes('id="graph-panel" className="absolute inset-0 isolate overflow-clip'),
    '【右栏浮层】画布必须绝对铺满并 isolate 自成一层，宽度才不受右栏影响')
  assert.ok(!pageSrc29.includes('className="flex-1 h-full relative overflow-clip'),
    '【右栏浮层】不得回灌 flex-1 画布（那会让展开右栏改变 React Flow 容器尺寸）')
  assert.ok(panelSrc29.includes("${collapsed ? 'hidden' : 'flex'}"),
    '【右栏浮层】折叠仍只隐藏同一组件树，保留文档保存 session / dirty close guard')
  assert.ok(panelSrc29.includes('absolute inset-y-0 right-0 z-30')
    && panelSrc29.includes('absolute inset-0 z-30'),
    '【右栏浮层】常态贴右、最大化铺满，两者都必须 absolute 且不占布局宽度')
  assert.ok(!panelSrc29.includes('z-[100]'),
    '【右栏浮层】层级不得高于 fixed 右键菜单 z-50，避免菜单被面板盖住')
  assert.ok(!canvasSrc29.includes('rightPanel') && !miniMapSrc29.includes('rightPanel'),
    '【右栏浮层】画布 / 缩略图不得订阅右栏状态，布局只由画布容器自身尺寸决定')
  assert.ok(canvasSrc29.includes('element.clientWidth') && canvasSrc29.includes('ResizeObserver'),
    '【右栏浮层】canvasSize 仍由画布容器自身的 ResizeObserver 驱动')
  assert.ok(miniMapSrc29.includes('width: canvasSize.width / Math.max(viewport.zoom, 0.0001)'),
    '【右栏浮层】缩略图视口框只由 canvasSize + viewport 派生，画布宽度恒定则视口框恒定')
  assert.ok(guiSrc29.includes('阶段 V') && guiSrc29.includes('data-tm-right-panel-overlay'),
    '【右栏浮层】GUI 必须实测折叠/展开往返的画布布局不变量')
}

// ===== 第 30 组：全局弹窗未打开时不得发起统一树查询（2026-11-12） =====
// 现象：App 根常驻的 LinkDocumentDialog 挂载即加载 root 层，而启动阶段还在 setup
// 视图、currentWorkDir=null（SetupPage 自动恢复是异步 IPC），requireRootDir() 必抛
// 「未选择工作目录」，每次启动都往控制台刷一条 Store.listUnifiedTreeLevel error。
{
  const readSrc30 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const dlgSrc30 = await readSrc30('src/features/graph/components/LinkDocumentDialog.tsx')
  const appSrc30 = await readSrc30('src/App.tsx')
  const hookSrc30 = await readSrc30('src/features/documents/unifiedTree/useUnifiedTree.ts')
  const editorSrc30 = await readSrc30('src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx')
  const guiSrc30 = await readSrc30('scripts/verify-linked-documents-gui.mjs')

  const bodyStart30 = dlgSrc30.indexOf('const LinkDocumentDialogBody')
  assert.ok(bodyStart30 > 0, '【启动期统一树】数据层必须下沉到独立的 Body 组件')
  const shell30 = dlgSrc30.slice(0, bodyStart30)
  const body30 = dlgSrc30.slice(bodyStart30)
  assert.ok(shell30.includes('if (!dialog) return null'),
    '【启动期统一树】App 根常驻的外壳必须在弹窗未打开时直接返回空')
  assert.ok(!shell30.includes('useUnifiedTree(') && !shell30.includes('useStorage()')
    && !shell30.includes('createStorageTreeDataSource('),
    '【启动期统一树】外壳不得挂任何统一树数据 hook（工作目录就绪前会抛未选择工作目录）')
  assert.ok(shell30.includes('<LinkDocumentDialogBody') && shell30.includes('key='),
    '【启动期统一树】Body 必须按 dialog 条件挂载，切换节点时用 key 重建缓存')
  assert.ok(body30.includes('useUnifiedTree(dataSource)') && body30.includes('createStorageTreeDataSource(storage)'),
    '【启动期统一树】按层加载只发生在弹窗打开后的 Body 内')
  assert.ok(!/^\s+tree\.refresh\(\)/m.test(body30),
    '【启动期统一树】打开弹窗不得再重复 refresh，否则一次打开并发两次 root 层查询')
  assert.ok(appSrc30.includes('<LinkDocumentDialog />'),
    '【启动期统一树】弹窗仍全局常驻，守卫必须留在外壳而不是靠 App 层条件渲染')
  assert.ok(hookSrc30.includes('useEffect(() => { void loadLevel(UNIFIED_TREE_ROOT_KEY) }, [loadLevel])'),
    '【启动期统一树】hook 仍保持挂载即按层加载 root 的惰性语义')
  assert.ok(editorSrc30.includes("{docLinkPicker && typeof document !== 'undefined'"),
    '【启动期统一树】编辑器选择器也必须保持条件挂载')
  assert.ok(guiSrc30.includes('阶段 W') && guiSrc30.includes('__tmStartupConsoleErrors'),
    '【启动期统一树】GUI 必须实测 reload 启动期控制台没有工作目录误调用')
}

// ===== 第 31 组：新建节点即时呈现，不再为 1 个节点重载整房间（2026-11-12） =====
// 旧链：saveNow 全量写盘 → createChildCardNode 读+写整份 layout → loadRoom 重扫
// N 个节点的目录摘要并重建全部节点 → 再全量 map 一遍设标题编辑态。全 O(N)、串行、
// 完成才更新 UI，节点 >400 时约半秒。新链：同步追加 1 个节点 + 后台合并落盘。
{
  const readSrc31 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const crudSrc31 = await readSrc31('src/hooks/useGraph/nodeCrudOperations.ts')
  const opsSrc31 = await readSrc31('src/hooks/useGraph/graphOperations.ts')
  const builderSrc31 = await readSrc31('src/hooks/useGraph/graphBuilder.ts')
  const guiSrc31 = await readSrc31('scripts/verify-linked-documents-gui.mjs')

  const fastStart31 = crudSrc31.indexOf('const createChildNodeOptimistic')
  const dispatchStart31 = crudSrc31.indexOf('const createChildNode = async')
  assert.ok(fastStart31 > 0 && dispatchStart31 > fastStart31,
    '【新建节点丝滑】热路径必须与冷路径分开，不能回灌整房间重载')
  const fastSrc31 = crudSrc31.slice(fastStart31, dispatchStart31)
  assert.ok(!/\bawait\b/.test(fastSrc31) && !fastSrc31.includes('loadRoom(')
    && !fastSrc31.includes('saveNow(') && !fastSrc31.includes('createChildCardNode('),
    '【新建节点丝滑】热路径不得有任何等待 / 整房间重载 / 同步全量读写盘')
  assert.ok(fastSrc31.includes('store.setNodes([...store.nodes, newNode])'),
    '【新建节点丝滑】必须同步追加节点，未变更节点保持原引用')
  assert.ok(fastSrc31.includes('void saveLater(roomPath)'),
    '【新建节点丝滑】落盘只走后台 debounced 保存，按房间 key 与后续编辑合并')
  assert.ok(!fastSrc31.includes('.map('),
    '【新建节点丝滑】不得再全量 map 一遍节点设标题编辑态')
  assert.ok(crudSrc31.slice(dispatchStart31).includes('currentLoadedRoomPathRef.current !== reloadPath')
    && crudSrc31.includes('createChildNodeViaReload'),
    '【新建节点丝滑】子房间创建 / 房间未加载完成必须保留旧链，保证磁盘一定写入')
  assert.ok(opsSrc31.includes('currentLoadedRoomPathRef,'),
    '【新建节点丝滑】graphOperations 必须把房间加载状态透传给 CRUD 层')
  assert.ok(builderSrc31.includes('export function buildCreatedKnowledgeNode'),
    '【新建节点丝滑】新节点必须由复用 buildNodes 字段契约的纯函数构造')
  assert.ok(guiSrc31.includes('阶段 X'),
    '【新建节点丝滑】GUI 必须实测点击到节点出现的耗时与后台落盘')

  // 真跑纯函数：乐观节点必须能被保存通道原样写回，否则重启后字段会静默丢失。
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundled31 = await build({
    entryPoints: [fileURLToPath(new URL('../src/hooks/useGraph/graphBuilder.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const graphBuilder31 = await import(
    `data:text/javascript;base64,${Buffer.from(bundled31.outputFiles[0].text).toString('base64')}`
  ) as Record<string, any>
  const created31 = graphBuilder31.buildCreatedKnowledgeNode({
    roomPath: '计算机/算法', kbPath: '计算机', cardId: 'card-x', name: '新节点',
    position: { x: 10, y: 20 }, size: { width: 130, height: 60 },
    editTitle: true, fallbackIndex: 3,
  })
  assert.equal(created31.id, 'card-x', '【新建节点丝滑】新节点 id 必须是 cardId')
  assert.equal(created31.type, 'knowledgeCard', '【新建节点丝滑】节点类型必须与加载路径一致')
  assert.deepEqual(created31.position, { x: 10, y: 20 }, '【新建节点丝滑】必须保留右键 / 快捷键给出的坐标')
  assert.equal(created31.width, 130, '【新建节点丝滑】必须继承默认节点宽度')
  assert.equal(created31.height, 60, '【新建节点丝滑】必须继承默认节点高度')
  assert.equal(created31.selected, true, '【新建节点丝滑】新节点应直接选中')
  assert.equal(created31.data.label, '新节点', '【新建节点丝滑】显示名必须写进 data.label')
  assert.equal(created31.data.cardRef, 'card-x', '【新建节点丝滑】cardRef 必须指向自身')
  assert.equal(created31.data.parent, '计算机/算法', '【新建节点丝滑】data.parent 必须是当前房间')
  assert.equal(created31.data.titleEditRequested, true, '【新建节点丝滑】标题编辑态必须直接挂在新节点上')
  const meta31 = graphBuilder31.buildMetaFromNodesEdges([created31], [])
  assert.equal(meta31.nodes['card-x'].card.name, '新节点',
    '【新建节点丝滑】乐观节点必须能被保存通道原样序列化')
  assert.equal(meta31.nodes['card-x'].width, 130,
    '【新建节点丝滑】序列化不能丢尺寸')
  const auto31 = graphBuilder31.buildCreatedKnowledgeNode({
    roomPath: '计算机', kbPath: '计算机', cardId: 'card-y', name: '自动排布', fallbackIndex: 2,
  })
  assert.deepEqual(auto31.position, { x: 420, y: 272 },
    '【新建节点丝滑】未给坐标时必须复现 buildNodes 的默认排布')
  assert.equal(auto31.data.titleEditRequested, undefined,
    '【新建节点丝滑】未要求编辑标题时不得带运行时编辑标记')
}

// ===== 第 32 组：删除节点不再重载整房间 + 批量样式一次写回（2026-11-12） =====
// 旧删除链：deleteCardNodeAndPruneGraph 直接改 store 内部 Map → saveNow 全量写盘
// → loadRoom 重扫 N 个节点目录摘要并重建全图 → 全量 map 清选中。全 O(N) 串行。
// 旧批量样式：forEach 逐个 updateNode，每次都全量 map + new Map + 全量 selection
// 扫描，选中 K 个节点就是 O(K·N)。两者都必须换成一次 store 写回。
{
  const readSrc32 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const crudSrc32 = await readSrc32('src/hooks/useGraph/nodeCrudOperations.ts')
  const builderSrc32 = await readSrc32('src/hooks/useGraph/graphBuilder.ts')
  const cardSvcSrc32 = await readSrc32('src/application/graph/cardNodeService.ts')
  const appIndexSrc32 = await readSrc32('src/application/graph/index.ts')
  const opsSrc32 = await readSrc32('src/hooks/useGraph/graphOperations.ts')
  const storageApiSrc32 = await readSrc32('src/hooks/useGraph/useGraphStorageApi.ts')
  const guiSrc32 = await readSrc32('scripts/verify-linked-documents-gui.mjs')

  const delStart32 = crudSrc32.indexOf('const deleteChildNode = async')
  const delEnd32 = crudSrc32.indexOf('const renameNode = async')
  assert.ok(delStart32 > 0 && delEnd32 > delStart32,
    '【删除节点丝滑】必须存在独立的删除节点实现')
  const delSrc32 = crudSrc32.slice(delStart32, delEnd32)
  assert.ok(!delSrc32.includes('loadRoom(') && !delSrc32.includes('saveNow('),
    '【删除节点丝滑】删 1 个节点不得整房间重载 / 同步全量写盘')
  assert.ok(!delSrc32.includes('await deleteCardNodeAndPruneGraph('),
    '【删除节点丝滑】不得回灌「直接改 store 内部 Map」的旧服务')
  assert.ok(delSrc32.includes('await storage.deleteCard(cardPath, nodeLabel)'),
    '【删除节点丝滑】唯一 IO 只能是被删节点自己的目录（局部 rename 进回收站）')
  assert.ok(delSrc32.includes('current.removeNodes([nodeId])')
    && delSrc32.includes('current.removeEdgesByNodeIds([nodeId])'),
    '【删除节点丝滑】必须同步用 store 原语删节点与关联边，让 UI 同帧更新')
  assert.ok(delSrc32.includes('temporal.pause()') && delSrc32.includes('temporal.resume()'),
    '【删除节点丝滑】删除必须排除在 undo 历史之外（否则撤销会造出空壳节点）')
  assert.ok(delSrc32.includes('void saveLater(currentRoomPath)'),
    '【删除节点丝滑】落盘只走后台 debounced 保存，与后续编辑按房间 key 合并')
  assert.ok(!delSrc32.includes('.map('),
    '【删除节点丝滑】不得再全量 map 一遍节点清选中')
  assert.ok(!cardSvcSrc32.includes('nodesById.delete') && !cardSvcSrc32.includes('edgesById.delete')
    && !appIndexSrc32.includes('deleteCardNodeAndPruneGraph'),
    '【删除节点丝滑】应用层不得保留绕过 zustand set 的 Map 直改副作用')
  assert.ok(opsSrc32.includes('deleteCard: (cardPath: string, label?: string)')
    && storageApiSrc32.includes('storage.deleteCard(cardPath, label)'),
    '【删除节点丝滑】回收站标签必须透传到主进程 .trash.json')

  const batchStart32 = crudSrc32.indexOf('const updateNodesStyle = async')
  const batchEnd32 = crudSrc32.indexOf('const updateNodeSizingMode = async')
  assert.ok(batchStart32 > 0 && batchEnd32 > batchStart32,
    '【批量样式】必须存在批量样式与清除样式实现')
  const batchSrc32 = crudSrc32.slice(batchStart32, batchEnd32)
  assert.ok(!batchSrc32.includes('store.updateNode(') && !batchSrc32.includes('forEach('),
    '【批量样式】不得逐节点 updateNode（每次都触发一次全量 store 更新）')
  assert.ok(batchSrc32.includes('applyNodeStylePatch(') && batchSrc32.includes('clearNodeStyles(')
    && (batchSrc32.match(/store\.setNodes\(nextNodes\)/g) ?? []).length === 2,
    '【批量样式】两个操作各只做一次 setNodes 写回')
  assert.ok(guiSrc32.includes('阶段 Y'),
    '【删除节点丝滑】GUI 必须实测删除耗时与后台落盘')

  // 真跑 store 原语：删除后数组/Map 必须一致、未变更节点保持引用、关联边被裁。
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundleStore32 = await build({
    entryPoints: [fileURLToPath(new URL('../src/stores/graphStore.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const graphStore32 = await import(
    `data:text/javascript;base64,${Buffer.from(bundleStore32.outputFiles[0].text).toString('base64')}`
  ) as Record<string, any>
  const store32 = graphStore32.createGraphStore()
  const nodes32 = [
    { id: 'a', selected: true, position: { x: 0, y: 0 }, data: { label: 'A' } },
    { id: 'b', selected: false, position: { x: 1, y: 0 }, data: { label: 'B' } },
    { id: 'c', selected: false, position: { x: 2, y: 0 }, data: { label: 'C' } },
  ]
  const edges32 = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
  ]
  store32.getState().setNodes(nodes32)
  store32.getState().setEdges(edges32)
  store32.getState().removeNodes(['a'])
  store32.getState().removeEdgesByNodeIds(['a'])
  const after32 = store32.getState()
  assert.equal(after32.nodes.length, 2, '【删除节点丝滑】store 原语必须真的移除节点')
  assert.equal(after32.nodes[0], nodes32[1], '【删除节点丝滑】未变更节点必须保持原引用')
  assert.equal(after32.nodesMap.has('a'), false, '【删除节点丝滑】nodesMap 必须与数组一致')
  assert.equal(after32.edges.length, 1, '【删除节点丝滑】关联边必须被裁掉')
  assert.equal(after32.edges[0].id, 'e2', '【删除节点丝滑】无关边必须保留')
  assert.equal(after32.selectedNodeCount, 0, '【删除节点丝滑】选中态必须随删除重算')
  assert.equal(after32.selectedNodeId, null, '【删除节点丝滑】选中节点必须清空')

  // 真跑批量样式纯函数：一次遍历、无变化返回 null、未变更节点保持引用。
  const bundleBuilder32 = await build({
    entryPoints: [fileURLToPath(new URL('../src/hooks/useGraph/graphBuilder.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const graphBuilder32 = await import(
    `data:text/javascript;base64,${Buffer.from(bundleBuilder32.outputFiles[0].text).toString('base64')}`
  ) as Record<string, any>
  const patched32 = graphBuilder32.applyNodeStylePatch(nodes32, ['a', 'b'], { headerFontSize: 20 })
  assert.ok(Array.isArray(patched32), '【批量样式】有变化时返回新数组')
  assert.equal(patched32[0].data.nodeStyle.headerFontSize, 20, '【批量样式】样式必须合并进 data.nodeStyle')
  assert.equal(patched32[2], nodes32[2], '【批量样式】未选中节点必须保持原引用')
  assert.equal(nodes32[0].data.nodeStyle, undefined, '【批量样式】不得原地修改旧节点')
  assert.equal(graphBuilder32.applyNodeStylePatch(patched32, ['a', 'b'], { headerFontSize: 20 }), null,
    '【批量样式】重复应用同一 patch 必须返回 null，避免无意义的 setNodes')
  assert.equal(graphBuilder32.applyNodeStylePatch(nodes32, ['c'], {}), null,
    '【批量样式】空 patch 必须返回 null')
  const cleared32 = graphBuilder32.clearNodeStyles(patched32, ['a'])
  assert.equal(cleared32[0].data.nodeStyle, undefined, '【批量样式】清除后不得残留 nodeStyle')
  assert.equal(cleared32[1], patched32[1], '【批量样式】清除时未选中节点保持原引用')
  assert.equal(graphBuilder32.clearNodeStyles(nodes32, ['c']), null,
    '【批量样式】本就无样式的节点必须返回 null')
}

// --- 第 33 组：连线终点轻量关系菜单 + 双击编辑自定义关系名（2026-11-12） ---
// 铁律：字段必须贯穿 7 处白名单（真跑往返验证，不只查字面量）；浮层必须贴事件坐标
// 且**没有居中模态遮罩**；双击写操作必须过唯一写闸门；旧「自定义关系 CRUD 已删除」契约不回灌。
{
  const read33 = async (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const [
    relations33, types33, model33, mapper33, normalizeMeta33, file33, fsBackend33, builder33,
    picker33, handlers33, canvasModel33, canvas33, useGraph33, context33, edgeOps33, floating33, panel33,
  ] = await Promise.all([
    read33('../src/domain/graph/edgeRelations.ts'),
    read33('../src/types/graph.ts'),
    read33('../src/domain/graph/model.ts'),
    read33('../src/domain/graph/graphMapper.ts'),
    read33('../src/domain/graph/normalizeGraphMeta.ts'),
    read33('../src/core/storage/file.ts'),
    read33('../src/core/fs-backend.ts'),
    read33('../src/hooks/useGraph/graphBuilder.ts'),
    read33('../src/features/graph/GraphCanvas/components/EdgeRelationPicker.tsx'),
    read33('../src/hooks/useGraph/graphEventHandlers.ts'),
    read33('../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts'),
    read33('../src/features/graph/GraphCanvas/GraphCanvas.tsx'),
    read33('../src/hooks/useGraph.ts'),
    read33('../src/contexts/GraphContext.tsx'),
    read33('../src/hooks/useGraph/edgeOperations.ts'),
    read33('../src/features/graph/GraphCanvas/edges/FloatingEdge.tsx'),
    read33('../src/features/right-panel/components/StyleTab/EdgeRelationPanel.tsx'),
  ])

  // 1) 唯一规则源：归一化 + describeEdgeSemantic 消费自定义名。
  assert.ok(relations33.includes('export function normalizeEdgeRelationLabel(')
    && relations33.includes('normalizeEdgeRelationLabel(customLabel)'),
  '【连线关系】自定义关系名归一化与优先级必须在 edgeRelations.ts 唯一定义')

  // 2) 7 处字段白名单：只加返回类型不算，必须在 map 本体 / 读入边界里真实透传。
  assert.equal((types33.match(/relationLabel\?: string/g) ?? []).length, 2,
    '【连线关系】types/graph.ts 的 GraphEdge 与 KnowledgeEdge.data 都要有字段')
  assert.equal((model33.match(/relationLabel\?: string/g) ?? []).length, 2,
    '【连线关系】domain/graph/model.ts 的 RoomGraphEdge 与 KBEdge 都要有字段')
  assert.equal((mapper33.match(/relationLabel: normalizeEdgeRelationLabel\(edge\.relationLabel\)/g) ?? []).length, 2,
    '【连线关系】graphMapper 双向都要透传字段')
  assert.ok(normalizeMeta33.includes('relationLabel: normalizeEdgeRelationLabel(rawEdge.relationLabel)'),
    '【连线关系】normalizeGraphMeta 读入边界必须归一化字段')
  assert.equal((file33.match(/relationLabel: normalizeEdgeRelationLabel\(e\.relationLabel\)/g) ?? []).length, 2,
    '【连线关系】file.ts 的 FSB 双向转换都要透传字段')
  assert.ok(fsBackend33.includes('relationLabel?: string'),
    '【连线关系】fs-backend 的原始边类型必须放行字段')
  assert.ok(builder33.includes('relationLabel: normalizeEdgeRelationLabel(e.data?.relationLabel)')
    && builder33.includes('relationLabel: e.relationLabel'),
  '【连线关系】graphBuilder 写盘与回读都要带字段')

  // 3) 浮层：贴在事件坐标、视口内钳位、轻量菜单形态（无全屏遮罩）。
  assert.ok(picker33.includes("'data-tm-edge-relation-inline': 'true'")
    && picker33.includes("'data-tm-edge-relation-anchor-x'")
    && picker33.includes('window.innerWidth - rect.width')
    && picker33.includes('window.innerHeight - rect.height')
    && picker33.includes('data-tm-edge-relation-picker'),
  '【连线关系】新建关系菜单必须按落点坐标定位并做视口钳位')
  assert.equal(picker33.includes('inset-0 flex items-center justify-center'), false,
    '【P0】不得回灌「全屏遮罩 + 屏幕居中」的模态形态')
  assert.equal(picker33.includes('bg-[color-mix(in_srgb,var(--color-text-primary)_28%'), false,
    '【P0】不得回灌遮罩背景')
  assert.ok(picker33.includes('fixed z-[60]') && !picker33.includes('z-[99998]'),
    '【连线关系】轻量菜单层级必须低于弹窗，不得回灌居中模态的 99998')
  assert.ok(picker33.includes('orderEdgeRelationOptions')
    && picker33.includes('data-tm-edge-relation-choice={option.id}')
    && picker33.includes('data-tm-edge-relation-mandatory'),
  '【连线关系】两个必选项 / 图型推荐 / 关联强契约不得丢')

  // 4) 落点捕获必须在 xyflow 的 document 冒泡 mouseup 之前（window 捕获阶段）。
  assert.ok(handlers33.includes("window.addEventListener('mouseup', record, true)")
    && handlers33.includes("window.addEventListener('touchend', record, true)")
    && handlers33.includes('anchor: { ...connectionPointRef.current }')
    && handlers33.includes('setAnchor(point)'),
  '【连线关系】松手坐标必须在捕获阶段记录并交给关系菜单')
  assert.ok(handlers33.includes('pointerPointFromEvent(event)'),
    '【连线关系】onConnectEnd 必须用事件坐标纠偏菜单位置')

  // 5) 双击编辑：事件接线 → 轻量编辑器 → 写闸门 → 线上标签。
  assert.ok(canvasModel33.includes('handleEdgeDoubleClick')
    && canvasModel33.includes('useEdgeRelationEditorStore.getState().open(')
    && canvasModel33.includes('if (isCanvasReadOnly(tabId)) return'),
  '【连线关系】双击必须在画布模型里打开编辑器且只读时不弹')
  assert.ok(canvas33.includes('onEdgeDoubleClick={handleEdgeDoubleClick}')
    && canvas33.includes('<EdgeRelationQuickEditor />'),
  '【连线关系】ReactFlow 必须接通双击并挂载轻量编辑器')
  assert.ok(picker33.includes('data-tm-edge-relation-label-input')
    && picker33.includes('data-tm-edge-relation-editor-choice={item.id}'),
  '【连线关系】编辑器必须能写自定义名并切换关联/从属')
  assert.ok(edgeOps33.includes('const updateEdgeRelationLabel = async')
    && edgeOps33.includes('delete nextData.relationLabel'),
  '【连线关系】写入必须归一化、清空时删字段')
  assert.ok(useGraph33.includes('updateEdgeRelationLabel: edit(ops.updateEdgeRelationLabel, noResult)'),
    '【P0】双击写关系名必须过 useGraph 唯一写闸门')
  assert.ok(context33.includes('updateEdgeRelationLabel: graph.updateEdgeRelationLabel'),
    '【连线关系】GraphContext 必须暴露写操作')
  assert.ok(floating33.includes('describeEdgeSemantic(edgeData?.relation, edgeRelations, edgeData?.relationLabel)')
    && floating33.includes('data-tm-edge-relation-custom')
    && floating33.includes('!isEditingThisEdge')
    && floating33.includes('{semantic.label}'),
  '【P0】关联边标签必须显示自定义名且恒显示契约不变')
  assert.equal(panel33.includes('data-tm-edge-relation-add'), false,
    '【P0】自定义关系名是**单条边**属性，不得回灌全局自定义关系 CRUD')

  // 6) 真跑纯函数：自定义名归一化、显示优先级、mandatoryLabel 恒显示。
  const defs33 = normalizeEdgeRelationDefinitions(undefined)
  assert.equal(normalizeEdgeRelationLabel('  前置知识  '), '前置知识')
  assert.equal(normalizeEdgeRelationLabel(''), undefined)
  assert.equal(normalizeEdgeRelationLabel('   '), undefined)
  assert.equal(normalizeEdgeRelationLabel(42), undefined)
  assert.equal(normalizeEdgeRelationLabel('x'.repeat(40))?.length, 24,
    '【连线关系】超长自定义名必须在规则源截断')
  assert.equal(describeEdgeSemantic('related', defs33, '前置知识').label, '前置知识')
  assert.equal(describeEdgeSemantic('related', defs33, '前置知识').mandatoryLabel, true)
  assert.equal(describeEdgeSemantic('related', defs33, '   ').label, DEFAULT_RELATED_DISPLAY_NAME)
  assert.equal(describeEdgeSemantic('related', defs33).label, DEFAULT_RELATED_DISPLAY_NAME)
  assert.equal(describeEdgeSemantic('subordinate', defs33, '前置知识').mandatoryLabel, false)
  assert.equal(assertEdgeRelationForCreate('related', defs33).ok, true,
    '【P0】新建连线强校验不得被自定义名改动破坏')

  // 7) esbuild 真跑往返：store 边 → _graph.json → store 边，字段不能在中途被吃掉。
  const { build: esbuild33 } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const loadBundled33 = async (relative: string) => {
    const bundled = await esbuild33({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    ) as Record<string, any>
  }
  const graphBuilder33 = await loadBundled33('../src/hooks/useGraph/graphBuilder.ts')
  const nodes33 = [
    { id: 'a33', position: { x: 0, y: 0 }, data: { label: 'A' } },
    { id: 'b33', position: { x: 200, y: 0 }, data: { label: 'B' } },
  ]
  const roundTrip33 = graphBuilder33.buildEdges(
    graphBuilder33.buildMetaFromNodesEdges(nodes33, [
      { id: 'e33', source: 'a33', target: 'b33', data: { relation: 'related', relationLabel: '  前置知识  ' } },
    ]),
    '',
  )
  assert.equal(roundTrip33[0].data.relationLabel, '前置知识',
    '【P0】自定义关系名必须经写盘/读盘往返不丢')
  const blankMeta33 = graphBuilder33.buildMetaFromNodesEdges(nodes33, [
    { id: 'e33b', source: 'a33', target: 'b33', data: { relation: 'related', relationLabel: '   ' } },
  ])
  assert.equal(blankMeta33.edges[0].relationLabel, undefined,
    '【连线关系】空白自定义名不得落盘为脏字符串')
  const normalizeGraphMeta33 = await loadBundled33('../src/domain/graph/normalizeGraphMeta.ts')
  const parsed33 = normalizeGraphMeta33.normalizeGraphMeta({
    edges: [{
      id: 'e33c', source: { ref: 'a33' }, target: { ref: 'b33' },
      relation: 'related', relationLabel: '  前置知识  ', weight: 'minor',
    }],
  })
  assert.equal(parsed33.edges[0].relationLabel, '前置知识',
    '【P0】旧档/外部导入读入边界必须归一化自定义关系名')
}

// --- 第 34 组：连线工具栏下拉菜单不得被两端锚点穿透（2026-11-13） ---
// 铁律：静态层级 10 < 锚点 11 < 弯曲手柄 12 < 菜单展开 20；两个下拉面板仍是
// 工具栏内部的 absolute 面板，靠**提升父级层叠上下文**解决，而不是面板自己写更大的 z-index。
{
  const read34 = async (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const [anchor34, bend34, toolbar34, quick34, popover34, floating34] = await Promise.all([
    read34('../src/features/graph/GraphCanvas/edges/EdgeAnchorHandles.tsx'),
    read34('../src/features/graph/GraphCanvas/edges/EdgeBendHandle.tsx'),
    read34('../src/features/graph/GraphCanvas/edges/EdgeToolbarAnchor.tsx'),
    read34('../src/features/graph/GraphCanvas/edges/QuickEdgeToolbar.tsx'),
    read34('../src/features/graph/GraphCanvas/edges/QuickEdgeStylePopover.tsx'),
    read34('../src/features/graph/GraphCanvas/edges/FloatingEdge.tsx'),
  ])

  const idleZ34 = Number(toolbar34.match(/zIndex: elevated \? \d+ : (\d+)/)?.[1] ?? NaN)
  const openZ34 = Number(toolbar34.match(/zIndex: elevated \? (\d+) : \d+/)?.[1] ?? NaN)
  const anchorZ34 = Number(anchor34.match(/zIndex: (\d+)/)?.[1] ?? NaN)
  const bendZ34 = Number(bend34.match(/zIndex: (\d+)/)?.[1] ?? NaN)
  assert.ok(idleZ34 < anchorZ34 && anchorZ34 < bendZ34 && bendZ34 < openZ34,
    `【P0】层级链必须是 静态 ${idleZ34} < 锚点 ${anchorZ34} < 弯曲 ${bendZ34} < 展开 ${openZ34}`)
  assert.ok(toolbar34.includes('elevated?: boolean')
    && floating34.includes('elevated={showToolbar && toolbarMenuOpen}')
    && floating34.includes('onFloatingOpenChange={setToolbarMenuOpen}'),
  '【连线菜单】elevated 必须由 FloatingEdge 接线到工具栏外壳')
  assert.ok(quick34.includes('onFloatingOpenChange?: (open: boolean) => void')
    && quick34.includes('onFloatingOpenChange?.(stylePanelOpen || relationMenuOpen)'),
  '【连线菜单】关系菜单 / 样式面板任一展开都要通知提层级')
  assert.ok(quick34.includes('data-tm-edge-relation-menu') && quick34.includes('z-[11]')
    && popover34.includes('z-[11]'),
  '【连线菜单】两个下拉面板仍是工具栏内部 absolute 面板，不许改成绕过层级的 portal')
  assert.ok(toolbar34.includes('opacity: faded ? 0 : 1')
    && toolbar34.includes("pointerEvents: faded ? 'none' : 'all'"),
  '【P0】拖动锚点时工具栏淡出让位的机制不得丢')
  assert.equal(toolbar34.includes('zIndex: 10,'), false,
    '【P0】不得回灌固定 zIndex: 10（下拉菜单会继续被锚点穿透）')
}

// --- 第 35 组：左侧节点树（房间根 / 房间子节点 / 游离 / 同级顺序 / 浮层） ---
// 铁律：treeOrder 必须真的贯通 7 处字段白名单（只加类型不算），排序规则唯一在
// domain/graph/nodeTree.ts；面板是 absolute 浮层，画布对展开折叠完全无感知。
{
  const read35 = async (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const [
    types35, model35, mapper35, normalize35, storage35, backend35, builder35,
    treeSource35, treeOrder35, panel35, hook35, page35, useGraph35, context35, ops35,
    graphOps35, store35,
  ] = await Promise.all([
    read35('../src/types/graph.ts'),
    read35('../src/domain/graph/model.ts'),
    read35('../src/domain/graph/graphMapper.ts'),
    read35('../src/domain/graph/normalizeGraphMeta.ts'),
    read35('../src/core/storage/file.ts'),
    read35('../src/core/fs-backend.ts'),
    read35('../src/hooks/useGraph/graphBuilder.ts'),
    read35('../src/domain/graph/nodeTree.ts'),
    read35('../src/domain/graph/treeOrder.ts'),
    read35('../src/features/graph/GraphPage/components/NodeTreePanel.tsx'),
    read35('../src/features/graph/GraphPage/model/useNodeTree.ts'),
    read35('../src/features/graph/GraphPage/GraphPage.tsx'),
    read35('../src/hooks/useGraph.ts'),
    read35('../src/contexts/GraphContext.tsx'),
    read35('../src/hooks/useGraph/nodeTreeOperations.ts'),
    read35('../src/hooks/useGraph/graphOperations.ts'),
    read35('../src/stores/nodeTreePanelStore.ts'),
  ])
  const count35 = (text: string, needle: string) => text.split(needle).length - 1

  // 1) 字段白名单：7 处都要有「写在 map 本体里」的赋值，不能只在类型里出现
  assert.ok(count35(types35, 'treeOrder?: number') >= 2, '【P0】GraphChild + KnowledgeNodeData 都要有 treeOrder')
  assert.ok(count35(model35, 'treeOrder?: number') >= 2, '【P0】KBNode + RoomGraphNode 都要有 treeOrder')
  assert.ok(count35(mapper35, 'treeOrder: normalizeTreeOrder') >= 2, '【P0】graphMapper 双向都要写 treeOrder')
  assert.ok(normalize35.includes('treeOrder: normalizeTreeOrder(rawNode.treeOrder)'), '【P0】normalizeGraphMeta 读盘要保留 treeOrder')
  assert.ok(storage35.includes('treeOrder: normalizeTreeOrder(child.treeOrder)')
    && storage35.includes('treeOrder: normalizeTreeOrder(node.treeOrder)'),
  '【P0】convertFSBToGraph / convertGraphToFSB 两处 map 本体都要写 treeOrder')
  assert.ok(backend35.includes('treeOrder?: number'), '【P0】fs-backend 顶层 children 类型要放行 treeOrder')
  assert.ok(builder35.includes('treeOrder: normalizeTreeOrder(node.data.treeOrder)')
    && builder35.includes('treeOrder: roomNode.treeOrder')
    && builder35.includes('export function applyTreeOrderPatch'),
  '【P0】graphBuilder 写盘 + 回读 + 批量排序纯函数都要带 treeOrder')
  assert.ok(treeOrder35.includes('export function normalizeTreeOrder')
    && treeSource35.includes("from './treeOrder.ts'"),
  '【P0】归一化规则源唯一在 treeOrder.ts，格式层不得依赖 nodeTree.ts')

  // 2) 浮层布局：不参与 flex 两栏、画布对面板状态无感知
  assert.ok(panel35.includes('absolute inset-y-0 left-0 z-30')
    && panel35.includes('data-tm-node-tree-collapsed="false"')
    && panel35.includes('data-tm-node-tree-toggle=""'),
  '【P0】左侧节点树必须是可折叠的 absolute 浮层')
  assert.ok(page35.includes('<NodeTreePanel tabId={tabId} isActive={isActive} />')
    && page35.includes('id="app-layout" className="relative w-full h-full"'),
  '【P0】节点树挂在 #app-layout 内，且 #app-layout 不得变成 flex 两栏')
  assert.ok(store35.includes('useNodeTreePanelStore') && !panel35.includes('rightPanel'),
  '【P0】画布 / 缩略图不得订阅节点树面板状态，面板也不得读右栏状态')
  assert.ok(hook35.includes('useGraphStore((state) => state.nodes)')
    && hook35.includes('useGraphStore((state) => state.edges)'),
  '【P0】树必须与根节点新增/修改（store nodes/edges）同步')
  assert.ok(hook35.includes('storage.readLayout(targetRoomPath)')
    && hook35.includes('readRoomNodeSummaries')
    && hook35.includes('setRooms({})'),
  '【P0】子房间按需读一次 meta + 摘要，换房间清缓存')
  assert.ok(panel35.includes('data-tm-node-tree-chevron=""')
    && panel35.includes('void loadChildRoom(node.childRoomPath)'),
  '【P0】默认全部折叠，点箭头才加载子房间')
  assert.ok(panel35.includes('reorderSiblings') && panel35.includes('flattenTreeForSearch')
    && panel35.includes('data-tm-node-tree-search=""')
    && panel35.includes('data-tm-node-tree-origin={node.origin}'),
  '【P0】搜索 / 拖动排序 / 来源标记都要接线')

  // 3) 写操作：唯一写闸门 + 一次 setNodes + 后台合并落盘
  assert.ok(ops35.includes('applyTreeOrderPatch') && ops35.includes('void saveLater')
    && ops35.includes('state.setNodes(nextNodes)'),
  '【P0】排序写入只做一次 setNodes + saveLater，绝不重载整房间')
  assert.ok(graphOps35.includes('buildNodeTreeOperations') && graphOps35.includes('...nodeTreeOps'),
  '【P0】排序操作必须接进 graphOperations 返回')
  assert.ok(useGraph35.includes('setNodeTreeOrder: edit(ops.setNodeTreeOrder, noResult)'),
  '【P0】排序写入必须过 useGraph 的唯一写闸门')
  assert.ok(context35.includes('setNodeTreeOrder: graph.setNodeTreeOrder'),
  '【P0】排序写入必须由 GraphContext 暴露给面板')
  assert.equal(treeSource35.includes("if (!q) return []"), true,
  '【P0】空查询不得遍历整棵树（与统一文档树同款硬约束）')

  // 4) esbuild 真跑纯函数：树结构 / 排序 / 拖动 / 搜索 + 写盘往返
  const { build: build35 } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const bundle35 = async (relative: string) => {
    const result = await build35({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const treeMod = await bundle35('../src/domain/graph/nodeTree.ts') as {
    buildNodeTree: (input: unknown) => any
    toNodeTreeRoom: (input: unknown) => unknown
    reorderSiblings: (siblings: readonly any[], from: string, to: string) => Array<{ id: string; treeOrder: number }> | null
    flattenTreeForSearch: (root: any, query: string) => Array<{ id: string; path: string[] }>
    normalizeTreeOrder: (value: unknown) => number | undefined
  }
  const builderMod = await bundle35('../src/hooks/useGraph/graphBuilder.ts') as {
    applyTreeOrderPatch: (nodes: any[], updates: Array<{ id: string; treeOrder: number }>) => any[] | null
    buildMetaFromNodesEdges: (nodes: any[], edges: any[], viewport?: unknown) => unknown
  }
  const storageMod = await bundle35('../src/core/storage/file.ts') as {
    convertGraphToFSB: (meta: unknown) => { children?: Record<string, Record<string, unknown>> }
    convertFSBToGraph: (raw: unknown) => { nodes: Record<string, Record<string, unknown>> }
  }

  const root35 = treeMod.toNodeTreeRoom({
    roomPath: 'kb', roomName: 'KB',
    nodes: [
      { id: 'A', label: 'A', childCount: 1 },
      { id: 'B', label: 'B' }, { id: 'C', label: 'C' },
      { id: 'R', label: 'R' }, { id: 'D', label: 'D' },
      { id: 'F1', label: '游离 1' }, { id: 'F2', label: '游离 2' },
    ],
    edges: [
      { id: 'e1', source: 'A', target: 'B', relation: 'subordinate' },
      { id: 'e2', source: 'A', target: 'C', relation: 'subordinate' },
      { id: 'e3', source: 'R', target: 'D', relation: 'subordinate' },
      { id: 'e4', source: 'F1', target: 'F2', relation: 'related' },
    ],
  })
  const childRoom35 = treeMod.toNodeTreeRoom({
    roomPath: 'kb/A', roomName: 'A',
    nodes: [{ id: 'AA', label: 'AA' }, { id: 'AB', label: 'AB' }, { id: 'AF', label: 'AF' }],
    edges: [{ id: 'ce1', source: 'AA', target: 'AB', relation: 'subordinate' }],
  })

  // 未加载时：A 只有普通子节点，带可展开标记但不长房间子节点
  const folded35 = treeMod.buildNodeTree({ root: root35, rooms: {}, resolveChildRoomPath: (r: string, id: string) => `${r}/${id}` })
  const foldedA35 = folded35.children.find((node: any) => node.id === 'A')
  assert.equal(folded35.origin, 'room-root', '【P0】顶层是当前房间虚拟根')
  assert.deepEqual(folded35.children.map((node: any) => node.id), ['A', 'R', 'F1', 'F2'],
    '【P0】从属树根按遍历顺序在前，游离节点恒末尾')
  assert.equal(foldedA35.hasChildRoom, true, '【P0】childCount>0 的节点要标记为可进入房间')
  assert.equal(foldedA35.roomLoaded, false, '【P0】子房间默认全部折叠')
  assert.deepEqual(foldedA35.children.map((node: any) => node.id), ['B', 'C'],
    '【P0】折叠时不长出房间子节点')

  // 加载后：AA 直接挂在 A 下、与 B/C 同级、默认第一；AF 作为房间游离挂末尾
  const loaded35 = treeMod.buildNodeTree({
    root: root35, rooms: { 'kb/A': childRoom35 },
    resolveChildRoomPath: (r: string, id: string) => `${r}/${id}`,
  })
  const a35 = loaded35.children.find((node: any) => node.id === 'A')
  assert.equal(a35.roomLoaded, true, '【P0】加载后标记已加载')
  assert.deepEqual(a35.children.map((node: any) => node.id), ['AA', 'B', 'C', 'AF'],
    '【P0】房间子节点默认第一，普通子节点居中，游离恒末尾')
  assert.equal(a35.children[0].origin, 'room-child', '【P0】房间子节点必须带来源标记')
  assert.equal(a35.depth, 1, '【P0】从属树根深度 1')
  assert.equal(a35.children.find((node: any) => node.id === 'B')?.depth, 2,
    '【P0】从属子节点深度必须逐级递增，不能整棵树塌成 1')
  assert.equal(a35.children[0].children[0]?.depth, 3,
    '【P0】房间子节点下的从属子节点深度继续递增')
  assert.equal(loaded35.children.find((node: any) => node.id === 'F1')?.depth, 1,
    '【P0】游离节点属于房间第一层')
  assert.equal(a35.children[3].origin, 'free', '【P0】房间游离节点必须带游离标记')
  assert.deepEqual(a35.children[0].children.map((node: any) => node.id), ['AB'],
    '【P0】AA 的子节点挂在 AA 下')
  assert.ok(a35.children.filter((node: any) => node.origin === 'subordinate').every((node: any) => node.sortable),
    '【P0】当前房间从属节点可拖动排序')
  assert.ok(a35.children.filter((node: any) => node.origin !== 'subordinate').every((node: any) => !node.sortable),
    '【P0】房间子节点 / 游离节点不可自定义排序')
  assert.ok(loaded35.children.filter((node: any) => node.origin === 'free').every((node: any) => !node.sortable),
    '【P0】当前房间游离节点不可自定义排序')

  // 游离节点也可能同时是可进入房间（无边但有子房间目录），房间子节点不能漏挂
  const freeRoomRoot35 = treeMod.toNodeTreeRoom({
    roomPath: 'kb2', roomName: 'KB2',
    nodes: [{ id: 'FR', label: '游离房间', childCount: 1 }, { id: 'X', label: 'X' }],
    edges: [],
  })
  const freeChildRoom35 = treeMod.toNodeTreeRoom({
    roomPath: 'kb2/FR', roomName: 'FR',
    nodes: [{ id: 'RR', label: 'RR' }, { id: 'RS', label: 'RS' }],
    edges: [{ id: 'fr-e1', source: 'RR', target: 'RS', relation: 'subordinate' }],
  })
  const freeLoaded35 = treeMod.buildNodeTree({
    root: freeRoomRoot35, rooms: { 'kb2/FR': freeChildRoom35 },
    resolveChildRoomPath: (r: string, id: string) => `${r}/${id}`,
  })
  const fr35 = freeLoaded35.children.find((node: any) => node.id === 'FR')
  assert.equal(fr35?.origin, 'free', '【P0】无边节点仍是游离节点')
  assert.equal(fr35?.children[0]?.origin, 'room-child',
    '【P0】游离房间节点也必须挂出子房间的房间子节点')
  assert.deepEqual(fr35?.children[0]?.children.map((node: any) => node.id), ['RS'],
    '【P0】游离房间里的从属树子节点仍逐层挂载')

  // 显式 treeOrder：升序在前，未写过的新节点按遍历顺序追加尾部
  const orderedRoot35 = treeMod.toNodeTreeRoom({
    roomPath: 'kb', roomName: 'KB',
    nodes: [
      { id: 'A', label: 'A' }, { id: 'B', label: 'B', treeOrder: 1 },
      { id: 'C', label: 'C', treeOrder: 0 }, { id: 'N', label: '新增' },
    ],
    edges: ['B', 'C', 'N'].map((id: string, index: number) => ({
      id: `o${index}`, source: 'A', target: id, relation: 'subordinate',
    })),
  })
  const ordered35 = treeMod.buildNodeTree({ root: orderedRoot35, rooms: {} })
  assert.deepEqual(ordered35.children[0].children.map((node: any) => node.id), ['C', 'B', 'N'],
    '【P0】treeOrder 升序 + 新节点追加尾部（存量按遍历顺序初始化）')

  const keyOf35 = (id: string) => `kb:${id}`
  const updates35 = treeMod.reorderSiblings(ordered35.children[0].children, keyOf35('C'), keyOf35('N'))
  assert.deepEqual(updates35, [
    { id: 'B', treeOrder: 0 }, { id: 'N', treeOrder: 1 }, { id: 'C', treeOrder: 2 },
  ], '【P0】拖动排序要给同父所有可排序兄弟重排 treeOrder')
  assert.equal(treeMod.reorderSiblings(a35.children, a35.children[0].key, keyOf35('B')), null,
    '【P0】房间子节点不可作为拖动源')
  assert.equal(treeMod.reorderSiblings(a35.children, keyOf35('B'), a35.children[3].key), null,
    '【P0】游离节点不可作为拖放目标')
  assert.deepEqual(treeMod.flattenTreeForSearch(loaded35, ''), [], '【P0】空查询直接返回空')
  assert.equal(treeMod.flattenTreeForSearch(loaded35, 'aa').some((hit) => hit.id === 'AA'), true,
    '【P0】搜索要能命中已加载的子房间节点')
  assert.equal(treeMod.normalizeTreeOrder(Number.NaN), undefined, '【P0】脏值视为未排序')

  // 拖动写入只改 data.treeOrder，坐标 / 尺寸 / 未变更节点引用全部不变
  const patchNodes35 = [
    { id: 'B', position: { x: 11, y: 22 }, width: 120, data: { label: 'B' } },
    { id: 'C', position: { x: 33, y: 44 }, data: { label: 'C' } },
  ]
  const patched35 = builderMod.applyTreeOrderPatch(patchNodes35, [{ id: 'B', treeOrder: 0 }])!
  assert.ok(patched35, '【P0】排序补丁要有变化')
  assert.notEqual(patched35[0], patchNodes35[0], '【P0】被排序节点要换成新引用')
  assert.equal(patched35[1], patchNodes35[1], '【P0】未变更节点保持引用')
  assert.deepEqual(patched35[0].position, { x: 11, y: 22 }, '【P0】顺序绝不改画布坐标')
  assert.equal(patched35[0].data.treeOrder, 0)
  assert.equal(builderMod.applyTreeOrderPatch(patched35, [{ id: 'B', treeOrder: 0 }]), null,
    '【P0】无变化时连一次 setNodes 都不发')

  // 写盘往返：treeOrder 真的进 _graph.json.children，老档缺字段不凭空生成
  const meta35 = builderMod.buildMetaFromNodesEdges(
    [{ id: 'B', position: { x: 0, y: 0 }, width: 120, height: 52, data: { label: 'B', treeOrder: 3 } },
      { id: 'C', position: { x: 1, y: 1 }, width: 120, height: 52, data: { label: 'C' } }],
    [], { zoom: 1, pan: { x: 0, y: 0 } },
  )
  const written35 = JSON.parse(JSON.stringify(storageMod.convertGraphToFSB(meta35)))
  assert.equal(written35.children?.B?.treeOrder, 3, '【P0】treeOrder 必须真的写进磁盘 JSON')
  assert.equal(written35.children?.C?.treeOrder, undefined, '【P0】老档无字段时不凭空生成')
  assert.equal(storageMod.convertFSBToGraph(written35).nodes.B.treeOrder, 3,
    '【P0】写盘往返后 treeOrder 不能丢')
}

// --- 第 36 组：节点树默认折叠 / 展开态记忆 / 子树懒加载 / 不透明背景 / 状态抽屉让位 / 语义图标 ---
{
  const read36 = async (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const [panel36, store36, tree36, hook36, css36, page36, overview36, card36] = await Promise.all([
    read36('../src/features/graph/GraphPage/components/NodeTreePanel.tsx'),
    read36('../src/stores/nodeTreePanelStore.ts'),
    read36('../src/domain/graph/nodeTree.ts'),
    read36('../src/features/graph/GraphPage/model/useNodeTree.ts'),
    read36('../src/styles/base.css'),
    read36('../src/features/graph/GraphPage/GraphPage.tsx'),
    read36('../src/features/graph/GraphPage/components/RoomOverview.tsx'),
    read36('../src/features/graph/GraphPage/components/RoomSummaryCard.tsx'),
  ])
  const has36 = (text: string, needle: string) => text.includes(needle)

  // 1) 背景：--color-background-primary 在 tokens.css 里从未定义，用到就是透明。
  assert.ok(!has36(panel36, '--color-background-primary')
    && has36(panel36, 'bg-[var(--color-surface)]')
    && !has36(overview36, '--color-background-primary')
    && !has36(card36, '--color-background-primary'),
  '【P0】面板背景必须用已定义的 --color-surface，禁回灌未定义的 background-primary')

  // 2) 默认折叠 + 按房间记忆：状态在 store / localStorage，不在组件本地 state。
  assert.ok(has36(store36, "const EXPANDED_KEY = 'topomind_node_tree_expanded_v2'")
    && has36(store36, 'expandedByRoom: readExpandedByRoom()')
    && has36(store36, 'writeExpandedByRoom(next)')
    && has36(store36, 'defaultExpandedKeys(rootKey)')
    && has36(store36, 'toggleExpandedKeys(keysFor(roomPath, rootKey), key)')
    && has36(store36, 'ensureExpandedKeys(current, key)'),
  '【P0】展开态按房间持久化，缺省只展开房间虚拟根')
  assert.ok(has36(panel36, 'defaultExpandedKeys(rootKey)')
    && has36(panel36, 'data-tm-node-tree-expanded-count')
    && has36(panel36, 'data-tm-node-tree-expand-all')
    && has36(panel36, 'data-tm-node-tree-collapse-all')
    && has36(panel36, 'expandNode(roomPath, rootKey, node.key)')
    && !has36(panel36, 'useState<Set<string>>'),
  '【P0】默认折叠 / 展开全部 / 收起全部 / 房间加载只展开都接线，禁回灌本地展开 state')

  // 3) 懒加载：折叠分支不构造子树，箭头只认 hasChildren；搜索仍走完整树。
  assert.ok(has36(tree36, 'expandedKeys?: ReadonlySet<string>')
    && has36(tree36, 'if (expandedKeys && !expandedKeys.has(makeNodeTreeKey(room.roomPath, id))) return []')
    && has36(tree36, 'hasChildren: (hierarchy.children.get(id)?.length ?? 0) > 0 || !!childRoomPath')
    && has36(tree36, 'children: rootOpen')
    && has36(tree36, 'export function collectNodeTreeKeys')
    && has36(tree36, 'export function makeNodeTreeKey')
    && has36(tree36, 'export function makeRoomRootKey'),
  '【P0】树规则源必须支持展开集合、hasChildren 与 tree key 唯一编码')
  assert.ok(has36(hook36, 'const fullTree = useMemo(() => buildNodeTree({')
    && has36(hook36, 'const visibleTree = useMemo(() => buildNodeTree({')
    && has36(hook36, 'expandedKeys,')
    && has36(hook36, 'collectNodeTreeKeys(fullTree)'),
  '【P0】完整树供搜索/计数/展开全部，懒加载树供列表渲染')
  assert.ok(has36(panel36, 'renderLevel([visibleTree], 0)')
    && has36(panel36, 'const showChevron = node.hasChildren || roomPending')
    && has36(panel36, 'data-tm-node-tree-lazy=')
    && has36(panel36, 'if (isExpanded && node.children.length > 0)'),
  '【P0】列表只渲染展开路径，折叠分支零 DOM')

  // 4) 状态抽屉让位：纯 CSS 变量，只动 top-left Panel 的 margin-left。
  assert.ok(has36(css36, '#app-layout .react-flow__panel.top.left')
    && has36(css36, 'margin-left: calc(12px + var(--tm-node-tree-offset, 0px)) !important'),
  '【P0】只让 top-left 画布状态抽屉横向让位')
  assert.ok(has36(panel36, "'--tm-node-tree-offset'")
    && has36(panel36, 'NODE_TREE_PANEL_WIDTH')
    && has36(page36, 'id="app-layout" className="relative w-full h-full"'),
  '【P0】让位由 CSS 变量驱动，#app-layout 不得改 flex 两栏')

  // 5) 语义化图标：房间 / 可进入房间 / 分支 / 游离 / 普通卡片逐级区分。
  for (const icon36 of ['ListTree', 'Layers3', 'FolderOpen', 'FolderTree', 'FileText', 'CircleDashed']) {
    assert.ok(has36(panel36, icon36), `【P1】语义图标 ${icon36} 必须在面板里`)
  }
  assert.ok(!has36(panel36, 'GitBranch') && !/<Circle\s/.test(panel36),
    '【P1】不得回灌 GitBranch / 通用 Circle 图标')

  // 6) esbuild 真跑纯函数：默认折叠集合 / 懒加载层级 / 展开全部 / 搜索用完整树。
  const { build: build36 } = await import('esbuild')
  const { fileURLToPath: toPath36 } = await import('node:url')
  const bundle36 = async (relative: string) => {
    const res = await build36({
      entryPoints: [toPath36(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(res.outputFiles[0].text).toString('base64')}`)
  }
  const nt36 = await bundle36('../src/domain/graph/nodeTree.ts') as {
    toNodeTreeRoom: (input: unknown) => unknown
    buildNodeTree: (input: unknown) => any
    makeRoomRootKey: (roomPath: string) => string
    defaultExpandedKeys: (rootKey: string) => Set<string>
    toggleExpandedKeys: (keys: ReadonlySet<string>, key: string) => Set<string>
    ensureExpandedKeys: (keys: ReadonlySet<string>, key: string) => Set<string>
    collectNodeTreeKeys: (root: any) => string[]
    flattenTreeForSearch: (root: any, query: string) => Array<{ id: string }>
  }
  const room36 = nt36.toNodeTreeRoom({
    roomPath: 'kb', roomName: 'KB',
    nodes: [
      { id: 'A', label: 'A', childCount: 1 }, { id: 'B', label: 'B' },
      { id: 'C', label: 'C' }, { id: 'F', label: 'F' },
    ],
    edges: [
      { id: 'e1', source: 'A', target: 'B', relation: 'subordinate' },
      { id: 'e2', source: 'B', target: 'C', relation: 'subordinate' },
    ],
  })
  const resolve36 = (r: string, id: string) => `${r}/${id}`
  const rootKey36 = nt36.makeRoomRootKey('kb')
  assert.equal(rootKey36, 'room-root:kb', '【P0】房间虚拟根 key 编码唯一')
  const def36 = nt36.defaultExpandedKeys(rootKey36)
  assert.deepEqual([...def36], [rootKey36], '【P0】默认展开集合只有房间根，其余全部折叠')

  const lazy36 = nt36.buildNodeTree({
    root: room36, rooms: {}, resolveChildRoomPath: resolve36, expandedKeys: def36,
  })
  assert.equal(lazy36.origin, 'room-root', '【P0】懒加载树顶层仍是房间虚拟根')
  assert.deepEqual(lazy36.children.map((n: any) => n.id), ['A', 'F'],
    '【P0】默认仍能看到房间第一层')
  const aLazy36 = lazy36.children.find((n: any) => n.id === 'A')
  assert.deepEqual(aLazy36.children, [], '【P0】折叠节点一行子树都不构造')
  assert.equal(aLazy36.hasChildren, true, '【P0】折叠节点仍要能显示展开箭头')
  assert.equal(aLazy36.hasChildRoom, true, '【P0】可进入房间标记与懒加载无关')
  assert.equal(aLazy36.roomLoaded, false, '【P0】未展开绝不读子房间')

  const one36 = nt36.buildNodeTree({
    root: room36, rooms: {}, resolveChildRoomPath: resolve36,
    expandedKeys: nt36.toggleExpandedKeys(def36, 'kb:A'),
  })
  const aOne36 = one36.children.find((n: any) => n.id === 'A')
  assert.deepEqual(aOne36.children.map((n: any) => n.id), ['B'],
    '【P0】展开 A 只构建它的直接子节点')
  assert.equal(aOne36.children[0].hasChildren, true, '【P0】B 有子节点仍显示箭头')
  assert.deepEqual(aOne36.children[0].children, [], '【P0】B 未展开，C 不构造')
  assert.equal(nt36.ensureExpandedKeys(def36, rootKey36).size, 1,
    '【P0】加载子房间时重复展开必须幂等')

  const full36 = nt36.buildNodeTree({ root: room36, rooms: {}, resolveChildRoomPath: resolve36 })
  assert.deepEqual(full36.children[0].children[0].children.map((n: any) => n.id), ['C'],
    '【P0】不传 expandedKeys 仍构建完整树（第 35 组契约不变）')
  const keys36 = nt36.collectNodeTreeKeys(full36)
  assert.ok(keys36.includes('kb:C') && keys36.includes(rootKey36),
    '【P0】展开全部必须基于完整树收集全部 key')
  assert.deepEqual(nt36.flattenTreeForSearch(lazy36, 'c'), [],
    '【P0】懒加载树里确实没有折叠分支')
  assert.ok(nt36.flattenTreeForSearch(full36, 'c').some((hit) => hit.id === 'C'),
    '【P0】搜索走完整树，默认折叠下仍能命中深层节点')
}

// --- 第 37 组：右侧列表统一视觉语言（2026-11-13，与左侧节点树同款） ---
{
  const read37 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const [
    panelList37, sidebar37, linked37, attachments37, relations37,
    node37, inlineEdit37, layout37, detailPanel37, tokens37,
  ] = await Promise.all([
    read37('../src/shared/ui/panelList.tsx'),
    read37('../src/features/documents/DocumentSidebar.tsx'),
    read37('../src/features/right-panel/components/DetailTab/LinkedDocumentList.tsx'),
    read37('../src/features/documents/components/Layout/AttachmentsTab.tsx'),
    read37('../src/features/right-panel/components/DetailTab/DocumentRelationPanel.tsx'),
    read37('../src/features/documents/components/DocumentNode.tsx'),
    read37('../src/features/documents/components/DocumentInlineEdit.tsx'),
    read37('../src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx'),
    read37('../src/features/right-panel/components/DetailTab/DetailPanel.tsx'),
    read37('../src/styles/tokens.css'),
  ])
  const has37 = (text: string, needle: string) => text.includes(needle)

  // 1) 唯一视觉源：常量齐全，且四个列表 + 文档树行 + 行内编辑都消费它，禁止各自漂移。
  assert.ok(has37(panelList37, 'export const PANEL_LIST')
    && has37(panelList37, 'export function PanelListAction')
    && ['header', 'body', 'row', 'rowMeta', 'badge', 'footer', 'addButton', 'icon'].every((key) => has37(panelList37, `  ${key}:`)),
  '【P0】面板列表视觉语言必须有唯一常量源')
  for (const [name, source] of [
    ['文档侧栏', sidebar37], ['关联文档列表', linked37], ['附件列表', attachments37],
    ['引用关系列表', relations37], ['文档树节点', node37], ['行内编辑', inlineEdit37],
  ] as const) {
    assert.ok(has37(source, 'PANEL_LIST'), `【P0】${name}必须复用 PANEL_LIST，禁止自带一套样式`)
  }

  // 2) 常量里引用的每个颜色变量都必须在 tokens.css 定义（--color-background-primary 曾导致透明背景）。
  const usedVars37 = [...new Set([...panelList37.matchAll(/var\(--(color-[a-z-]+)\)/g)].map((m) => m[1]))]
  assert.ok(usedVars37.length >= 8, '【P0】视觉常量应覆盖标题/行/徽章等色板')
  assert.deepEqual(usedVars37.filter((v) => !has37(tokens37, `--${v}:`)), [],
    '【P0】视觉常量只能用 tokens.css 里真实定义过的颜色变量')
  const styled37 = [panelList37, sidebar37, linked37, attachments37, relations37, node37, layout37, detailPanel37]
  assert.ok(styled37.every((s) => !has37(s, '--color-background-primary')),
    '【P0】禁回灌未定义的 --color-background-primary（背景会变透明）')
  assert.ok(has37(layout37, 'bg-[var(--color-surface)]')
    && !has37(layout37, 'bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]')
    && !has37(detailPanel37, 'bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]'),
  '【P0】侧栏 / 详情面板必须是纯 surface 背景，去掉旧渐变')

  // 3) rail 由汉字按钮换成语义图标，但原有稳定选择器与诊断属性必须保留。
  assert.ok(has37(layout37, '<FileText className="h-4 w-4" />')
    && has37(layout37, '<Paperclip className="h-4 w-4" />')
    && has37(layout37, '<Link2 className="h-4 w-4" />')
    && has37(layout37, 'data-tm-backlinks-rail=""')
    && !/>\s*文\s*<\/button>/.test(layout37)
    && !/>\s*附\s*<\/button>/.test(layout37)
    && !/>\s*引\s*<\/button>/.test(layout37),
  '【P0】rail 三个页签用语义图标而非「文/附/引」汉字，且保留 data-tm-backlinks-rail')
  assert.ok(!has37(sidebar37, '📄') && has37(sidebar37, 'title="还没有文档"'),
    '【P0】文档空态去掉 emoji，改用统一 EmptyState')

  // 4) 双行结构：来源 / 尺寸等元信息独占第二行，状态徽章不污染标题行文本匹配。
  assert.ok(has37(linked37, '来源：') && has37(linked37, 'PANEL_LIST.rowMeta')
    && has37(linked37, 'PANEL_LIST.badge') && has37(linked37, '回收站') && has37(linked37, '已删除'),
  '【P0】关联文档行必须有第二行来源与状态徽章')
  assert.ok(has37(attachments37, 'PANEL_LIST.rowMeta') && has37(attachments37, 'KB · ')
    && has37(attachments37, 'PANEL_LIST.footer'),
  '【P0】附件行必须显示大小/类型元信息与底部说明')
  assert.ok(has37(relations37, 'PANEL_LIST.badge') && has37(relations37, '处'),
  '【P0】引用关系行的引用次数徽章只在第二行')

  // 5) 旧业务契约不得因换皮丢失（GUI 阶段 E/F 与双链回归都依赖这些选择器）。
  assert.ok(has37(linked37, 'title="关联已有文档"') && has37(linked37, 'title="移除关联"')
    && has37(linked37, 'title="在所属节点打开"') && has37(linked37, 'title="从回收站恢复"'),
  '【P0】关联文档列表的添加/移除/打开/恢复按钮 title 必须保留')
  assert.ok(has37(attachments37, 'title="上传附件"') && has37(attachments37, 'title="插入到文档"')
    && has37(attachments37, 'title="删除附件"'),
  '【P0】附件列表的上传/插入/删除按钮 title 必须保留')
  assert.ok(has37(relations37, 'data-tm-backlinks-panel') && has37(relations37, 'data-tm-backlink-item')
    && has37(relations37, 'data-tm-outgoing-item'),
  '【P0】引用关系面板的 data-tm-* 诊断契约必须保留')
  assert.ok(has37(sidebar37, 'ref={scrollContainerRef}') && has37(sidebar37, 'onScroll={handleSidebarScroll}')
    && has37(sidebar37, 'role="tree" aria-label="文档列表"'),
  '【P0】文档侧栏滚动位置持久化与树语义必须保留')
  assert.ok(has37(node37, 'data-document-title') && has37(node37, 'FolderTree') && has37(node37, 'FileText')
    && !has37(node37, 'topoDocumentTypeIcon'),
  '【P0】文档树缺省图标改用语义图标，但 data-document-title 必须保留')
}

// --- 第 38 组：性能监控系统（2026-11-14，契约 / 埋点 / 统计 / 页面四层） ---
{
  const read38 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files38 = {
    contract: '../src/shared/observability/performanceContract.ts',
    metrics: '../src/shared/observability/performanceMetrics.ts',
    statistics: '../src/shared/observability/performanceStatistics.ts',
    perfLog: '../src/core/performance-log.ts',
    runtime: '../src/core/performance-runtime.ts',
    publicApi: '../src/plugins/public/api.ts',
    bootstrap: '../src/plugins/bootstrap.ts',
    main: '../src/main.tsx',
    tab: '../src/plugins/builtin/monitor/PerformanceTab.tsx',
    hook: '../src/plugins/builtin/monitor/performance/usePerformanceSamples.ts',
    toolbar: '../src/plugins/builtin/monitor/performance/PerformanceToolbar.tsx',
    overview: '../src/plugins/builtin/monitor/performance/PerformanceOverview.tsx',
    table: '../src/plugins/builtin/monitor/performance/MetricStatisticsTable.tsx',
    charts: '../src/plugins/builtin/monitor/performance/PerformanceCharts.tsx',
    slow: '../src/plugins/builtin/monitor/performance/SlowSamplesPanel.tsx',
    roomLoader: '../src/hooks/useGraph/useGraphRoomLoader.ts',
    session: '../src/features/right-panel/model/useDetailDocumentSession.ts',
    kbList: '../src/features/kb/model/useHomeKnowledgeBases.ts',
    kbImport: '../src/features/kb/model/useHomeImportKB.ts',
    nodeCrud: '../src/hooks/useGraph/nodeCrudOperations.ts',
    edgeOps: '../src/hooks/useGraph/edgeOperations.ts',
    detailDocs: '../src/features/right-panel/model/useDetailDocuments.ts',
    attachments: '../src/features/documents/components/Layout/AttachmentsTab.tsx',
    search: '../src/features/documents/unifiedTree/useUnifiedTreeSearch.ts',
    relations: '../src/features/right-panel/model/useDocumentRelations.ts',
  } as const
  const entries38 = Object.entries(files38) as Array<[keyof typeof files38, string]>
  const sources38 = Object.fromEntries(
    await Promise.all(entries38.map(async ([key, relative]) => [key, await read38(relative)] as const)),
  ) as Record<keyof typeof files38, string>
  const has38 = (key: keyof typeof files38, needle: string) => sources38[key].includes(needle)

  // 1) 唯一真源：注册表字段 + 宿主定义仍从 shared 派生，public 层同步了新增字段。
  for (const needle of [
    'export const PERFORMANCE_ACTION', 'export const PERFORMANCE_CATEGORIES',
    'export const PERFORMANCE_METRICS', 'export const PERFORMANCE_METRIC_SPECS',
    'export const PERFORMANCE_METRIC_SPEC_BY_ID', 'sampleRate: number',
    'minIntervalMs: number', 'description: string', 'thresholdMs: number',
  ]) {
    assert.ok(has38('contract', needle), `【P0】性能契约缺少 ${needle}`)
  }
  assert.ok(has38('metrics', 'PERFORMANCE_METRIC_SPECS.map')
    && has38('metrics', 'export function extractPerformanceSamples'),
  '【P0】指标定义必须从注册表派生，禁止再维护第二份 id 清单')
  assert.ok(has38('publicApi', "from '@/shared/observability/performanceContract'")
    && has38('publicApi', 'category?: PerformanceCategoryId')
    && has38('publicApi', 'sessionId?: string')
    && has38('publicApi', 'traceId?: string'),
  '【P0】插件公共 API 必须同步分类 / 会话 / 链路字段')
  assert.ok(has38('bootstrap', 'PERFORMANCE_METRIC_DEFINITIONS')
    && has38('bootstrap', 'extractPerformanceSamples'),
  '【P0】宿主仍从 shared 提供定义与反解样本，不能改成另一套读取')

  // 2) 埋点上报层：统一入口 + 采样节流 + 会话元数据 + 旧契约兼容 + 自动观测。
  for (const needle of [
    'export function recordPerformance', 'export function startPerformanceSpan',
    'export async function measurePerformance', 'export async function logPerformanceMetric',
    'export function markPerformanceMetricStart', 'export function takePerformanceMetricStart',
    'export const PERFORMANCE_SESSION_ID', 'function shouldReport',
    'sessionId: PERFORMANCE_SESSION_ID', 'params.category = spec.category',
  ]) {
    assert.ok(has38('perfLog', needle), `【P0】统一埋点层缺少 ${needle}`)
  }
  assert.ok(has38('perfLog', 'if (options.force || options.success === false) return true'),
    '【P0】失败样本必须绕过采样/节流，不能出现「越慢越看不见」')
  assert.ok(has38('runtime', 'PerformanceObserver')
    && has38('runtime', 'PERFORMANCE_METRICS.longTask')
    && has38('runtime', 'PERFORMANCE_METRICS.appStartup')
    && has38('main', 'startRuntimePerformanceObserver()')
    && has38('main', 'reportAppStartup(performance.now())'),
  '【P0】启动耗时与长任务必须在首帧前启动自动观测')

  // 3) 业务埋点真实接入：每条链路都必须走 PERFORMANCE_METRICS 常量，不是裸字符串。
  const instrumentation38: Array<[keyof typeof files38, string]> = [
    ['roomLoader', 'PERFORMANCE_METRICS.roomLoad'],
    ['session', 'PERFORMANCE_METRICS.detailSave'],
    ['session', 'PERFORMANCE_METRICS.detailRead'],
    ['session', 'PERFORMANCE_METRICS.nodeSelect'],
    ['kbList', 'PERFORMANCE_METRICS.kbListLoad'],
    ['kbImport', 'PERFORMANCE_METRICS.kbImport'],
    ['nodeCrud', 'PERFORMANCE_METRICS.nodeCreate'],
    ['nodeCrud', 'PERFORMANCE_METRICS.nodeDelete'],
    ['edgeOps', 'PERFORMANCE_METRICS.edgeCreate'],
    ['detailDocs', 'PERFORMANCE_METRICS.documentExport'],
    ['attachments', 'PERFORMANCE_METRICS.attachmentUpload'],
    ['search', 'PERFORMANCE_METRICS.documentSearch'],
    ['relations', 'PERFORMANCE_METRICS.documentRelations'],
  ]
  for (const [key, needle] of instrumentation38) {
    assert.ok(has38(key, needle), `【P0】${key} 必须接入 ${needle}`)
  }
  assert.equal(new Set(instrumentation38.map(([, n]) => n)).size, 13,
    '【P0】13 条业务链路埋点不得重复占坑')

  // 4) 页面分层与渲染契约：拆分为数据 / 工具条 / 概览 / 表格 / 图表 / 明细。
  const viewContracts38: Array<[keyof typeof files38, string]> = [
    ['hook', 'filterPerformanceSamples'],
    ['toolbar', '性能监控</h1>'],
    ['toolbar', 'TIME_RANGE_LABELS'],
    ['overview', 'overview.p95Ms'],
    ['table', 'p95Ms'],
    ['charts', 'TimeBucket'],
    ['slow', 'rankSlowSamples'],
  ]
  for (const [key, needle] of viewContracts38) {
    assert.ok(has38(key, needle), `【P0】页面组件 ${key} 缺少 ${needle}`)
  }
  for (const needle of [
    'PerformanceToolbar', 'PerformanceOverview', 'MetricStatisticsTable',
    'TimeBucketChart', 'DistributionChart', 'TrendChart', 'ActiveMetricSummary',
    'SlowSamplesPanel', 'usePerformanceSamples', 'computeMetricStatistics',
    'computeCategoryStatistics', 'bucketPerformanceSamples', 'computeTrend',
  ]) {
    assert.ok(has38('tab', needle), `【P0】性能页组装层缺少 ${needle}`)
  }
  assert.ok(!has38('tab', 'slice(-24)'), '【P0】趋势图不得回灌硬编码 24 个样本')
  const uiSources38 = ['toolbar', 'overview', 'table', 'charts', 'slow', 'tab'] as const
  assert.ok(uiSources38.every((key) => !/#[0-9a-fA-F]{6}/.test(sources38[key])),
    '【P0】性能页颜色只能引用 tokens.css 变量，禁止硬编码 hex（单色制）')
  assert.ok(uiSources38.every((key) => !has38(key, '@/core/') && !has38(key, 'window.electronAPI')),
    '【P0】性能页必须守插件边界，不得直连 core / electronAPI')

  // 5) 铁律：esbuild 打包真跑纯函数（契约、样本反解、统计聚合），不是查源码字面量。
  const { build: build38 } = await import('esbuild')
  const { fileURLToPath: fileURLToPath38 } = await import('node:url')
  const load38 = async (relative: string) => {
    const result = await build38({
      entryPoints: [fileURLToPath38(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const contract38 = await load38(files38.contract) as {
    PERFORMANCE_METRICS: Record<string, string>
    PERFORMANCE_METRIC_IDS: string[]
    PERFORMANCE_METRIC_SPECS: Array<{
      id: string; category: string; thresholdMs: number; sampleRate: number; minIntervalMs: number
    }>
    PERFORMANCE_CATEGORIES: Record<string, { color: string }>
    resolvePerformanceMetricSpec: (id: string) => { id: string } | null
  }
  const metrics38 = await load38(files38.metrics) as {
    PERFORMANCE_METRIC_DEFINITION_LIST: Array<{
      id: string; label: string; shortLabel: string; color: string
      thresholdMs: number; category: string
    }>
    extractPerformanceSamples: (entries: unknown[]) => Array<Record<string, unknown>>
  }
  const stats38 = await load38(files38.statistics) as {
    filterPerformanceSamples: (samples: unknown[], filters: Record<string, unknown>) => Array<Record<string, unknown>>
    computeMetricStatistics: (samples: unknown[], definitions: unknown[]) => Array<Record<string, any>>
    computeCategoryStatistics: (samples: unknown[]) => Array<Record<string, any>>
    computePerformanceOverview: (samples: unknown[], definitions: unknown[]) => Record<string, any>
    bucketPerformanceSamples: (samples: unknown[], count: number) => Array<Record<string, any>>
    computeTrend: (samples: unknown[]) => Record<string, any>
    rankSlowSamples: (samples: unknown[], limit: number) => Array<Record<string, any>>
    formatSampleContext: (sample: unknown) => string
    isSlowSample: (sample: unknown) => boolean
  }

  assert.equal(contract38.PERFORMANCE_METRIC_IDS.length, 21, '【P0】注册表应有 21 项指标')
  assert.equal(new Set(contract38.PERFORMANCE_METRIC_IDS).size, 21, '【P0】指标 id 不得重复')
  assert.equal(contract38.PERFORMANCE_METRIC_SPECS.length, 21, '【P0】每项指标都要有完整定义')
  for (const spec of contract38.PERFORMANCE_METRIC_SPECS) {
    assert.ok(contract38.PERFORMANCE_CATEGORIES[spec.category], `【P0】${spec.id} 的分类必须存在`)
    assert.ok(spec.thresholdMs > 0, `【P0】${spec.id} 必须有正阈值`)
    assert.ok(spec.sampleRate > 0 && spec.sampleRate <= 1, `【P0】${spec.id} 采样率必须落在 (0,1]`)
    assert.ok(spec.minIntervalMs >= 0, `【P0】${spec.id} 节流间隔不得为负`)
  }
  assert.equal(contract38.resolvePerformanceMetricSpec('not_a_metric'), null, '【P0】未知指标必须被拒绝')
  assert.equal(contract38.resolvePerformanceMetricSpec('room_load')?.id, 'room_load')
  assert.equal(metrics38.PERFORMANCE_METRIC_DEFINITION_LIST.length, 21,
    '【P0】展示定义必须与注册表一一对应')
  assert.ok(metrics38.PERFORMANCE_METRIC_DEFINITION_LIST.every((d) => d.color.startsWith('var(--')),
    '【P0】指标颜色必须是 tokens.css 变量，不能漂移成 hex')

  const base38 = Date.parse('2026-11-14T10:00:00.000Z')
  const makeSample38 = (
    id: string, metric: string, durationMs: number, success: boolean,
    offsetSec: number, params: Record<string, unknown> = {},
  ) => {
    const definition = metrics38.PERFORMANCE_METRIC_DEFINITION_LIST.find((item) => item.id === metric)!
    return {
      id, metric,
      label: definition.label, shortLabel: definition.shortLabel,
      color: definition.color, thresholdMs: definition.thresholdMs,
      category: definition.category,
      durationMs, success,
      timestamp: new Date(base38 + offsetSec * 1000).toISOString(),
      timestampMs: base38 + offsetSec * 1000,
      sessionId: 'session-38', source: 'verify:critical', params,
    }
  }
  const samples38 = [
    makeSample38('a', 'room_load', 100, true, 0, { roomPath: 'KB/房间 A' }),
    makeSample38('b', 'room_load', 200, true, 60),
    makeSample38('c', 'room_load', 900, true, 120),
    makeSample38('d', 'room_load', 50, false, 180, { error: '读取失败' }),
    makeSample38('e', 'node_select', 120, true, 240),
    makeSample38('f', 'detail_save', 400, true, 300),
    makeSample38('g', 'detail_save', 20, false, 360),
    makeSample38('h', 'kb_import', 6000, true, 420),
    makeSample38('i', 'long_task', 250, true, -1200),
  ]

  // 反解：老日志无 category 也能补齐；未来/未知指标不整批丢弃。
  const parsed38 = metrics38.extractPerformanceSamples([
    { id: 'log-38', timestamp: new Date(base38).toISOString(), action: '性能:记录', module: 'useGraph',
      params: { metric: 'room_load', durationMs: 320, success: true, sessionId: 's-38', roomPath: 'KB/房间 A' } },
    { id: 'log-39', timestamp: new Date(base38).toISOString(), action: '性能:记录',
      params: { metric: 'future_metric', durationMs: 12 } },
    { id: 'log-40', timestamp: new Date(base38).toISOString(), action: '节点:创建', params: {} },
  ])
  assert.equal(parsed38.length, 2, '【P0】只反解性能 action，且未知指标样本不能丢')
  assert.equal(parsed38[0].category, 'navigation')
  assert.equal(parsed38[0].sessionId, 's-38')
  assert.equal(parsed38[0].source, 'useGraph')
  assert.equal(parsed38[1].label, 'future_metric')

  const metricStats38 = stats38.computeMetricStatistics(samples38, metrics38.PERFORMANCE_METRIC_DEFINITION_LIST)
  const room38 = metricStats38.find((item) => item.metric === 'room_load')!
  assert.equal(room38.count, 4)
  assert.equal(room38.successRate, 75, '【P0】成功率 = 成功样本 / 全部样本')
  assert.equal(room38.slowCount, 1, '【P0】慢操作只统计成功且超阈值的样本')
  assert.equal(room38.failCount, 1)
  assert.equal(room38.p50Ms, 150)
  assert.ok(Math.abs(room38.p95Ms - 795) < 0.001, '【P0】P95 必须是线性插值分位数')
  assert.ok(Math.abs(room38.p99Ms - 879) < 0.001, '【P0】P99 必须是线性插值分位数')
  assert.equal(room38.avgMs, 312.5)
  assert.equal(stats38.isSlowSample({ success: false, durationMs: 99999, thresholdMs: 1 }), false,
    '【P0】失败样本永远不算慢操作')

  const overview38 = stats38.computePerformanceOverview(samples38, metrics38.PERFORMANCE_METRIC_DEFINITION_LIST)
  assert.equal(overview38.total, 9)
  assert.equal(overview38.failCount, 2)
  assert.equal(overview38.slowCount, 4)
  assert.equal(overview38.activeMetricCount, 5)
  assert.equal(overview38.sessionCount, 1)
  assert.equal(overview38.coveredMetricCount, 21)
  assert.equal(stats38.computeCategoryStatistics(samples38).reduce((sum, item) => sum + item.count, 0), 9,
    '【P0】分类统计不得漏样本或重复计数')

  const filtered38 = (filters: Record<string, unknown>) => stats38.filterPerformanceSamples(samples38, filters)
  assert.equal(filtered38({ status: 'failed' }).length, 2, '【P0】状态筛选：仅失败')
  assert.equal(filtered38({ status: 'slow' }).length, 4, '【P0】状态筛选：仅慢操作')
  assert.equal(filtered38({ categories: ['navigation'] }).length, 4, '【P0】分类筛选')
  assert.equal(filtered38({ metrics: ['room_load'] }).length, 4, '【P0】指标筛选')
  assert.equal(filtered38({ keyword: '房间' }).length, 4, '【P0】关键词应命中上下文与指标名')
  assert.equal(filtered38({ range: '15m', nowMs: base38 + 600_000 }).length, 8,
    '【P0】近 15 分钟必须剔除 20 分钟前的长任务样本')
  assert.equal(filtered38({}).length, 9, '【P0】默认筛选必须恒等，不裁剪样本')

  const buckets38 = stats38.bucketPerformanceSamples(samples38, 5)
  assert.equal(buckets38.length, 5, '【P0】时间分桶数量固定')
  assert.equal(buckets38.reduce((sum, bucket) => sum + bucket.count, 0), 9,
    '【P0】分桶后样本总数守恒')
  assert.ok(buckets38.some((bucket) => bucket.count === 0), '【P0】空桶必须保留以暴露操作空档')
  assert.equal(stats38.computeTrend(samples38).direction, 'up', '【P0】后半段 P95 变慢必须识别为上升')
  assert.equal(stats38.computeTrend(samples38.slice(0, 3)).direction, 'flat', '【P0】样本太少不得给趋势结论')
  assert.deepEqual(stats38.rankSlowSamples(samples38, 3).map((s) => s.durationMs), [6000, 900, 400],
    '【P0】最慢样本按耗时降序且受 limit 约束')
  assert.equal(stats38.formatSampleContext(samples38[0]), 'KB/房间 A')
  assert.equal(stats38.formatSampleContext(samples38[3]), '失败：读取失败')
}

// --- 第 39 组：画布操作性能埋点（规模上下文 / 两段后台成本 / 分桶统计 / 链路追溯） ---
{
  const read39 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files39 = {
    contract: '../src/shared/observability/performanceContract.ts',
    metrics: '../src/shared/observability/performanceMetrics.ts',
    statistics: '../src/shared/observability/performanceStatistics.ts',
    perfLog: '../src/core/performance-log.ts',
    context: '../src/hooks/useGraph/canvasPerformanceContext.ts',
    graphOps: '../src/hooks/useGraph/graphOperations.ts',
    storage: '../src/core/storage/service.ts',
    nodeCrud: '../src/hooks/useGraph/nodeCrudOperations.ts',
    edgeOps: '../src/hooks/useGraph/edgeOperations.ts',
    nodeChange: '../src/hooks/useGraph/nodeChangeOperations.ts',
    canvasModel: '../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts',
    toolbar: '../src/plugins/builtin/monitor/performance/PerformanceToolbar.tsx',
    scalePanel: '../src/plugins/builtin/monitor/performance/ScaleBucketsPanel.tsx',
    tracePanel: '../src/plugins/builtin/monitor/performance/TraceWaterfallPanel.tsx',
    slowPanel: '../src/plugins/builtin/monitor/performance/SlowSamplesPanel.tsx',
    tab: '../src/plugins/builtin/monitor/PerformanceTab.tsx',
  } as const
  const entries39 = Object.entries(files39) as Array<[keyof typeof files39, string]>
  const sources39 = Object.fromEntries(
    await Promise.all(entries39.map(async ([key, relative]) => [key, await read39(relative)] as const)),
  ) as Record<keyof typeof files39, string>
  const has39 = (key: keyof typeof files39, needle: string) => sources39[key].includes(needle)

  // 1) 契约：画布分类 + 4 个新指标 + operation 维度与阈值表。
  for (const needle of [
    "canvas: { id: 'canvas'", 'canvasEdit:', 'canvasGesture:', 'graphMetaBuild:', 'graphMetaFlush:',
    'export const CANVAS_OPERATIONS', 'export const CANVAS_OPERATION_THRESHOLDS',
    'export function canvasOperationThreshold',
  ]) {
    assert.ok(has39('contract', needle), `【P0】画布性能契约缺少 ${needle}`)
  }

  // 2) 埋点层：慢样本绕过节流、operation 阈值写回样本、链路 id；旧契约不能丢。
  for (const needle of [
    'export function newPerformanceTraceId', 'if (durationMs > thresholdMs) return true',
    'params.thresholdMs = thresholdMs', 'if (options.force || options.success === false) return true',
  ]) {
    assert.ok(has39('perfLog', needle), `【P0】埋点层缺少 ${needle}`)
  }
  assert.ok(has39('metrics', 'asNumber(params.thresholdMs)'),
    '【P0】样本反解必须采纳 operation 阈值，统计口径不能分叉')

  // 3) 规模上下文只读 O(1)，且各条链路的埋点点位真实存在（注释里的反例不算代码）。
  const contextCode39 = sources39.context
    .split('\n')
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join('\n')
  assert.ok(has39('context', 'export function readCanvasScale')
    && has39('context', 'export function formatCanvasScaleLabel')
    && has39('context', 'state.nodes.length')
    && !contextCode39.includes('.map('),
  '【P0】规模上下文必须零遍历，禁止为了埋点扫描节点')
  for (const [key, needle] of [
    ['graphOps', 'PERFORMANCE_METRICS.graphMetaBuild'],
    ['graphOps', 'buildMetaFromNodesEdges('],
    ['storage', 'PERFORMANCE_METRICS.graphMetaFlush'],
    ['storage', 'backend.writeLayout('],
    ['nodeCrud', 'CANVAS_OPERATIONS.create'],
    ['nodeCrud', 'CANVAS_OPERATIONS.delete'],
    ['edgeOps', 'CANVAS_OPERATIONS.edgeCreate'],
    ['nodeChange', 'PERFORMANCE_METRICS.canvasEdit'],
    ['nodeChange', 'CANVAS_OPERATIONS.deleteBatch'],
    ['nodeChange', 'PERFORMANCE_METRICS.canvasGesture'],
    ['nodeChange', 'beginGesture('],
    ['nodeChange', 'endGesture('],
    ['canvasModel', 'PERFORMANCE_METRICS.canvasGesture'],
    ['canvasModel', 'finishViewportGesture'],
    ['canvasModel', 'frameCount'],
  ] as Array<[keyof typeof files39, string]>) {
    assert.ok(has39(key, needle), `【P0】${key} 缺少画布埋点 ${needle}`)
  }

  // 4) 页面：规模筛选 / 分桶视图 / 链路瀑布 / 慢样本联动 / 插件边界。
  for (const [key, needle] of [
    ['toolbar', 'SCALE_BUCKET_LABELS'],
    ['toolbar', 'aria-label="节点规模"'],
    ['scalePanel', 'avgPerUnitMs'],
    ['scalePanel', '随规模劣化'],
    ['tracePanel', 'offsetMs'],
    ['tracePanel', 'shortTraceId'],
    ['slowPanel', 'onSelectTrace'],
    ['tab', 'computeScaleStatistics'],
    ['tab', 'computeOperationStatistics'],
    ['tab', 'groupByTrace'],
    ['tab', 'ScaleBucketsPanel'],
    ['tab', 'TraceWaterfallPanel'],
  ] as Array<[keyof typeof files39, string]>) {
    assert.ok(has39(key, needle), `【P0】性能页缺少 ${needle}`)
  }
  for (const key of ['scalePanel', 'tracePanel', 'slowPanel', 'tab'] as const) {
    assert.ok(!/#[0-9a-fA-F]{6}/.test(sources39[key]), `【P0】${key} 颜色不得硬编码 hex`)
    assert.ok(!has39(key, '@/core/'), `【P0】${key} 不得直连 core`)
  }

  // 5) 铁律：esbuild 打包真跑契约与统计纯函数，不只查源码字面量。
  const { build: build39 } = await import('esbuild')
  const { fileURLToPath: fileURLToPath39 } = await import('node:url')
  const load39 = async (relative: string) => {
    const result = await build39({
      entryPoints: [fileURLToPath39(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const contract39 = await load39(files39.contract) as {
    PERFORMANCE_METRIC_IDS: string[]
    CANVAS_OPERATION_THRESHOLDS: Record<string, number>
    canvasOperationThreshold: (operation: string) => number | null
  }
  const stats39 = await load39(files39.statistics) as {
    scaleBucketOf: (nodeCount: number) => string
    computeScaleStatistics: (samples: unknown[]) => Array<Record<string, any>>
    computeScaleSensitivity: (samples: unknown[], groupBy?: string) => Array<Record<string, any>>
    computeOperationStatistics: (samples: unknown[]) => Array<Record<string, any>>
    perUnitMs: (sample: unknown) => number
    groupByTrace: (samples: unknown[]) => Array<Record<string, any>>
    filterPerformanceSamples: (samples: unknown[], filters: Record<string, unknown>) => unknown[]
    formatSampleContext: (sample: unknown) => string
  }

  assert.equal(contract39.PERFORMANCE_METRIC_IDS.length, 21, '【P0】画布 6 指标必须进注册表')
  assert.equal(contract39.canvasOperationThreshold('delete_batch'), 400)
  assert.equal(contract39.canvasOperationThreshold('meta_build'), 100)
  assert.equal(contract39.canvasOperationThreshold('no_such_operation'), null)

  const base39 = Date.parse('2026-11-14T12:00:00.000Z')
  const mk39 = (
    id: string, metric: string, durationMs: number, offsetSec: number,
    params: Record<string, unknown>, traceId?: string,
  ) => ({
    id, metric, label: metric, shortLabel: metric, color: 'var(--color-accent)',
    category: 'canvas', thresholdMs: 100, durationMs, success: true,
    timestamp: new Date(base39 + offsetSec * 1000).toISOString(),
    timestampMs: base39 + offsetSec * 1000,
    source: 'verify:critical', params,
    ...(traceId ? { traceId } : {}),
  })
  const samples39 = [
    mk39('s1', 'canvas_edit', 10, 0,
      { operation: 'create', nodeCount: 100, affectedCount: 1, scaleLabel: '100 节点', contextKey: 'room/a' }, 't1'),
    mk39('s2', 'canvas_edit', 12, 10,
      { operation: 'create', nodeCount: 5000, affectedCount: 1, contextKey: 'room/c' }, 't3'),
    mk39('s3', 'graph_meta_build', 10, 0.01,
      { operation: 'meta_build', nodeCount: 100, contextKey: 'room/a' }),
    mk39('s4', 'graph_meta_build', 200, 0.02,
      { operation: 'meta_build', nodeCount: 5000, contextKey: 'room/a' }),
    mk39('s5', 'graph_meta_flush', 320, 0.4,
      { operation: 'meta_flush', nodeCount: 5000, contextKey: 'room/a' }),
    mk39('s6', 'canvas_gesture', 260, 20,
      { operation: 'drag', nodeCount: 5000, affectedCount: 20, contextKey: 'room/b' }, 't2'),
  ]

  assert.equal(stats39.scaleBucketOf(199), 'lt200')
  assert.equal(stats39.scaleBucketOf(200), '200-1k', '【P0】分桶边界必须左闭右开')
  assert.equal(stats39.scaleBucketOf(20000), '20k+')
  const bucketStats39 = stats39.computeScaleStatistics(samples39)
  assert.equal(bucketStats39.reduce((sum, item) => sum + item.count, 0), 6,
    '【P0】规模分桶后样本总数守恒')
  assert.equal(bucketStats39.find((item) => item.bucket === '5k-20k').count, 4)
  const sensitivity39 = stats39.computeScaleSensitivity(samples39, 'operation')
  assert.equal(sensitivity39.find((item) => item.key === 'meta_build').scaleSensitive, true,
    '【P0】随节点数陡升的操作必须被识别为规模敏感')
  assert.equal(sensitivity39.find((item) => item.key === 'create').scaleSensitive, false,
    '【P0】基本持平的操作不能被误标为规模敏感')
  assert.equal(stats39.perUnitMs(samples39[5]), 13, '【P0】每节点成本 = 耗时 / 受影响节点数')
  const opStats39 = stats39.computeOperationStatistics(samples39)
  assert.equal(opStats39.find((item) => item.operation === 'drag').avgPerUnitMs, 13)
  assert.equal(stats39.filterPerformanceSamples(samples39, {
    scaleBucket: 'lt200', nowMs: base39 + 60_000,
  }).length, 2, '【P0】规模筛选必须只保留该桶样本')
  const traces39 = stats39.groupByTrace(samples39)
  assert.equal(traces39.length, 3, '【P0】链路数 = 独立 traceId 数')
  const mainTrace39 = traces39.find((item) => item.traceId === 't1')
  assert.equal(mainTrace39.spans.length, 4,
    '【P0】同房间的后台构建 / 写盘必须归并进主链路')
  assert.equal(mainTrace39.slow, true)
  assert.ok(mainTrace39.totalMs >= 720, '【P0】链路总耗时必须覆盖最后一段的偏移 + 耗时')
  assert.equal(stats39.formatSampleContext({ params: { scaleLabel: '5000 节点', roomPath: 'room/a' } }),
    '5000 节点', '【P0】慢样本上下文必须优先显示规模摘要')
  assert.equal(stats39.formatSampleContext({ params: { nodeCount: 5000 } }), '5000 节点',
    '【P0】写盘侧只落数字字段时也要能生成规模摘要')
}

// --- 第 40 组：查询 / LOD / 剩余画布动作 + 动态规模阈值 + operation 筛选 ---
{
  const read40 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files40 = {
    contract: '../src/shared/observability/performanceContract.ts',
    statistics: '../src/shared/observability/performanceStatistics.ts',
    perfLog: '../src/core/performance-log.ts',
    context: '../src/hooks/useGraph/canvasPerformanceContext.ts',
    semanticLod: '../src/features/graph/GraphCanvas/model/useSemanticLod.ts',
    searchBox: '../src/features/graph/GraphCanvas/components/NodeSearchBox.tsx',
    canvasModel: '../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts',
    useNodeTree: '../src/features/graph/GraphPage/model/useNodeTree.ts',
    treePanel: '../src/features/graph/GraphPage/components/NodeTreePanel.tsx',
    edgeOps: '../src/hooks/useGraph/edgeOperations.ts',
    nodeCrud: '../src/hooks/useGraph/nodeCrudOperations.ts',
    mirror: '../src/hooks/useGraph/selectionMirrorOperations.ts',
    subtree: '../src/hooks/useGraph/selectionSubtreeOperations.ts',
    treeOrder: '../src/hooks/useGraph/nodeTreeOperations.ts',
    toolbar: '../src/plugins/builtin/monitor/performance/PerformanceToolbar.tsx',
    overview: '../src/plugins/builtin/monitor/performance/PerformanceOverview.tsx',
    tab: '../src/plugins/builtin/monitor/PerformanceTab.tsx',
  } as const
  const entries40 = Object.entries(files40) as Array<[keyof typeof files40, string]>
  const sources40 = Object.fromEntries(
    await Promise.all(entries40.map(async ([key, relative]) => [key, await read40(relative)] as const)),
  ) as Record<keyof typeof files40, string>
  const has40 = (key: keyof typeof files40, needle: string) => sources40[key].includes(needle)

  // 1) 契约：查询 / LOD 两个新指标、10 个新动作维度、动态阈值纯函数。
  for (const needle of [
    'canvasQuery:', 'canvasLod:', "lodRecompute: 'lod_recompute'", "treeExpand: 'tree_expand'",
    "search: 'search'", "locate: 'locate'", "edgeDelete: 'edge_delete'",
    'export const SCALE_ADJUSTED_OPERATIONS', 'export function thresholdForScale',
  ]) {
    assert.ok(has40('contract', needle), `【P0】性能契约缺少 ${needle}`)
  }
  assert.ok(has40('perfLog', 'thresholdForScale(baseThreshold, nodeCount, operation)'),
    '【P0】上报层必须用动态规模阈值，且同时驱动采样与 params.thresholdMs')
  assert.ok(has40('context', 'export function startCanvasSpan'),
    '【P0】画布埋点必须统一走 startCanvasSpan，禁止各处手拼规模上下文')

  // 2) 查询与 LOD 链路：只在真正重算 / 真正搜索时上报，点位真实存在。
  for (const [key, needle] of [
    ['semanticLod', 'PERFORMANCE_METRICS.canvasLod'],
    ['semanticLod', 'CANVAS_OPERATIONS.lodRecompute'],
    ['semanticLod', 'hiddenCount: visibility.hiddenNodeIds.size'],
    ['searchBox', 'CANVAS_OPERATIONS.search'],
    ['searchBox', 'resultCount: result.length'],
    ['canvasModel', 'CANVAS_OPERATIONS.locate'],
    ['treePanel', "trigger: 'node-tree'"],
    ['useNodeTree', 'CANVAS_OPERATIONS.treeExpand'],
    ['useNodeTree', 'perfSpan.fail(error)'],
    ['edgeOps', 'CANVAS_OPERATIONS.edgeDelete'],
    ['edgeOps', 'CANVAS_OPERATIONS.anchorAdjust'],
    ['nodeCrud', 'CANVAS_OPERATIONS.batchStyle'],
    ['mirror', 'CANVAS_OPERATIONS.mirror'],
    ['subtree', 'CANVAS_OPERATIONS.subtreeSelect'],
    ['treeOrder', 'CANVAS_OPERATIONS.treeOrder'],
  ] as Array<[keyof typeof files40, string]>) {
    assert.ok(has40(key, needle), `【P0】${key} 缺少画布埋点 ${needle}`)
  }

  // 3) 统计与页面：operation 维度筛选、规模敏感 Top3、插件边界。
  assert.ok(has40('statistics', 'filters.operation && filters.operation')
    && has40('statistics', "readSampleScale(sample).operation !== filters.operation"),
  '【P0】统计层必须支持按画布动作筛选')
  assert.ok(has40('statistics', 'export const CANVAS_OPERATION_OPTIONS'))
  for (const [key, needle] of [
    ['toolbar', 'aria-label="画布动作"'],
    ['toolbar', 'CANVAS_OPERATION_OPTIONS'],
    ['overview', '规模敏感动作 Top3'],
    ['tab', 'sensitiveOperations={operations}'],
  ] as Array<[keyof typeof files40, string]>) {
    assert.ok(has40(key, needle), `【P0】性能页缺少 ${needle}`)
  }
  for (const key of ['toolbar', 'overview', 'tab'] as const) {
    assert.ok(!/#[0-9a-fA-F]{6}/.test(sources40[key]), `【P0】${key} 颜色不得硬编码 hex`)
    assert.ok(!has40(key, '@/core/'), `【P0】${key} 不得直连 core`)
  }

  // 4) 铁律：esbuild 真跑契约与统计纯函数。
  const { build: build40 } = await import('esbuild')
  const { fileURLToPath: fileURLToPath40 } = await import('node:url')
  const load40 = async (relative: string) => {
    const result = await build40({
      entryPoints: [fileURLToPath40(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const contract40 = await load40(files40.contract) as {
    PERFORMANCE_METRIC_IDS: string[]
    CANVAS_OPERATION_THRESHOLDS: Record<string, number>
    CANVAS_OPERATION_LABELS: Record<string, string>
    canvasOperationThreshold: (operation: string) => number | null
    thresholdForScale: (base: number, nodeCount: number, operation?: string) => number
  }
  const stats40 = await load40(files40.statistics) as {
    CANVAS_OPERATION_OPTIONS: Array<{ value: string; label: string }>
    filterPerformanceSamples: (samples: unknown[], filters: Record<string, unknown>) => unknown[]
  }

  assert.equal(contract40.PERFORMANCE_METRIC_IDS.length, 21, '【P0】查询 / LOD 指标必须进注册表')
  assert.equal(contract40.canvasOperationThreshold('lod_recompute'), 120)
  assert.equal(contract40.canvasOperationThreshold('search'), 120)
  assert.ok(Object.keys(contract40.CANVAS_OPERATION_THRESHOLDS).every(
    (key) => typeof contract40.CANVAS_OPERATION_LABELS[key] === 'string',
  ), '【P0】每个动作都必须有中文标签')

  // 动态阈值：小图恒等、批量 O(N) 动作随规模单调放宽、交互类与无 operation 恒等、有上限。
  // 【2026-11-15】真实标定后，meta_build / meta_flush / lod_recompute 已移出放宽清单。
  assert.equal(contract40.thresholdForScale(100, 0, 'delete_batch'), 100)
  assert.equal(contract40.thresholdForScale(100, 200, 'delete_batch'), 100)
  const mid40 = contract40.thresholdForScale(100, 1000, 'delete_batch')
  const large40 = contract40.thresholdForScale(100, 20000, 'delete_batch')
  assert.ok(mid40 > 100, '【P0】万级节点的批量动作必须按规模放宽阈值，否则全部标红')
  assert.ok(large40 > mid40, '【P0】规模阈值必须单调不减')
  assert.ok(contract40.thresholdForScale(100, 1e9, 'delete_batch') <= 800,
    '【P0】规模放宽必须有上限，异常峰值仍要能判慢')
  for (const op of ['meta_build', 'meta_flush', 'lod_recompute']) {
    assert.equal(contract40.thresholdForScale(100, 20000, op), 100,
      `【P0】${op} 实测不随规模增长，必须回到静态阈值，不得再放宽漏报慢操作`)
  }
  assert.equal(contract40.thresholdForScale(100, 5000, 'create'), 100,
    '【P0】交互类动作不得按规模放宽阈值')
  assert.equal(contract40.thresholdForScale(100, 5000, ''), 100,
    '【P0】非画布指标不得被动态阈值影响')

  const base40 = Date.parse('2026-11-14T12:00:00.000Z')
  const mk40 = (id: string, operation: string) => ({
    id, metric: 'canvas_query', label: '查询', shortLabel: '查询',
    color: 'var(--color-accent)', category: 'canvas', thresholdMs: 300,
    durationMs: 20, success: true,
    timestamp: new Date(base40).toISOString(), timestampMs: base40,
    source: 'verify:critical',
    params: { operation, nodeCount: 500, contextKey: 'room/a' },
  })
  const samples40 = [mk40('q1', 'search'), mk40('q2', 'locate'), mk40('q3', 'drag')]
  assert.equal(stats40.filterPerformanceSamples(samples40, {
    operation: 'search', nowMs: base40 + 60_000,
  }).length, 1, '【P0】动作筛选必须只保留该 operation 的样本')
  assert.equal(stats40.filterPerformanceSamples(samples40, {
    operation: 'all', nowMs: base40 + 60_000,
  }).length, 3, '【P0】全部动作不得误过滤')
  assert.equal(stats40.CANVAS_OPERATION_OPTIONS.length,
    Object.keys(contract40.CANVAS_OPERATION_THRESHOLDS).length + 1,
    '【P0】下拉选项必须与契约动作一一对应')
  assert.ok(stats40.CANVAS_OPERATION_OPTIONS.some((option) => option.value === 'lod_recompute'))
}

// --- 第 41 组：规模阈值标定（纯函数 + 取样脚本 + 慢样本生效阈值） ---
{
  const read41 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files41 = {
    statistics: '../src/shared/observability/performanceStatistics.ts',
    cli: '../scripts/analyze-performance-scale.mts',
    slowPanel: '../src/plugins/builtin/monitor/performance/SlowSamplesPanel.tsx',
    pkg: '../package.json',
  } as const
  const entries41 = Object.entries(files41) as Array<[keyof typeof files41, string]>
  const sources41 = Object.fromEntries(
    await Promise.all(entries41.map(async ([key, relative]) => [key, await read41(relative)] as const)),
  ) as Record<keyof typeof files41, string>
  const has41 = (key: keyof typeof files41, needle: string) => sources41[key].includes(needle)

  // 1) 静态：标定算法、取样脚本、页面生效阈值列、npm 入口都必须真实存在。
  for (const needle of [
    'export function computeScaleCalibration', 'export function computeCalibrationSummary',
    'export type CalibrationVerdict', "too_tight: '阈值过紧'", 'successCount',
    'group.filter((sample) => sample.success)',
  ]) {
    assert.ok(has41('statistics', needle), `【P0】统计层缺少标定能力 ${needle}`)
  }
  for (const needle of [
    'analyze-performance-scale', '--input', '--out', '--strict',
    'buildSyntheticSamples', 'computeScaleCalibration', 'thresholdForScale', 'esbuildBuild',
    '合成基准，仅用于自检算法',
  ]) {
    assert.ok(has41('cli', needle), `【P0】标定脚本缺少 ${needle}`)
  }
  for (const needle of ['生效阈值', 'formatDuration(sample.thresholdMs)', '超阈 ', '失败不判慢', 'colSpan={8}']) {
    assert.ok(has41('slowPanel', needle), `【P0】慢样本面板缺少 ${needle}`)
  }
  assert.ok(has41('pkg', '"perf:calibrate"'), '【P0】必须提供 npm 标定入口')
  assert.ok(!/#[0-9a-fA-F]{6}/.test(sources41.slowPanel), '【P0】慢样本面板颜色不得硬编码 hex')

  // 2) 铁律：esbuild 真跑标定纯函数，四类判定与建议系数方向都要验。
  const { build: build41 } = await import('esbuild')
  const { fileURLToPath: toPath41 } = await import('node:url')
  const load41 = async (relative: string) => {
    const result = await build41({
      entryPoints: [toPath41(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const contract41 = await load41('../src/shared/observability/performanceContract.ts') as {
    thresholdForScale: (base: number, nodeCount: number, operation?: string) => number
  }
  const stats41 = await load41(files41.statistics) as {
    computeScaleCalibration: (samples: unknown[], minSamples?: number) => Array<Record<string, unknown>>
    computeCalibrationSummary: (rows: Array<Record<string, unknown>>) => Record<string, unknown>
    CALIBRATION_MIN_SAMPLES: number
  }

  const base41 = Date.parse('2026-11-14T12:00:00.000Z')
  let seq41 = 0
  const mk41 = (
    operation: string, nodeCount: number, durationMs: number, thresholdMs: number,
    success = true,
  ) => {
    seq41 += 1
    const timestampMs = base41 + seq41 * 1000
    return {
      id: `cal-${seq41}`, metric: 'canvas_edit', label: operation, shortLabel: operation,
      color: 'var(--color-accent)', category: 'canvas', thresholdMs, durationMs, success,
      timestamp: new Date(timestampMs).toISOString(), timestampMs, source: 'verify:critical',
      params: { operation, nodeCount, affectedCount: 1, scaleLabel: `${nodeCount} 节点` },
    }
  }
  const tightThreshold = contract41.thresholdForScale(100, 2500, 'meta_build')
  const looseThreshold = contract41.thresholdForScale(120, 25000, 'lod_recompute')
  const tight41 = Array.from({ length: 6 }, () => mk41('meta_build', 2500, 600, tightThreshold))
  const loose41 = Array.from({ length: 6 }, () => mk41('lod_recompute', 25000, 50, looseThreshold))
  const healthy41 = [80, 83, 86, 89, 92, 95].map((ms) => mk41('create', 80, ms, 120))
  const insufficient41 = [100, 110].map((ms) => mk41('search', 600, ms, 120))
  const failed41 = mk41('create', 80, 9999, 120, false)

  const rows41 = stats41.computeScaleCalibration([...tight41, ...loose41, ...healthy41, ...insufficient41])
  const row41 = (operation: string) => {
    const found = rows41.find((row) => row.operation === operation)
    assert.ok(found, `【P0】缺少 ${operation} 的标定分组`)
    return found as Record<string, unknown>
  }
  const tight41Row = row41('meta_build')
  assert.equal(tight41Row.verdict, 'too_tight', '【P0】慢率 100% 且 P95 越线必须判阈值过紧')
  assert.ok(Number(tight41Row.suggestedFactor) > Number(tight41Row.appliedFactor),
    '【P0】过紧分组的建议倍数必须高于当前放宽倍数')
  const loose41Row = row41('lod_recompute')
  assert.equal(loose41Row.verdict, 'too_loose', '【P0】零慢样本且 P95 远低于阈值必须判阈值过松')
  assert.ok(Number(loose41Row.suggestedFactor) < Number(loose41Row.appliedFactor),
    '【P0】过松分组的建议倍数必须低于当前放宽倍数')
  assert.equal(row41('create').verdict, 'healthy')
  assert.equal(row41('search').verdict, 'insufficient')
  assert.equal(stats41.CALIBRATION_MIN_SAMPLES, 5)

  // 失败样本单独计：9999ms 不得污染 P95，也不得拉高慢率。
  const rowsWithFailure41 = stats41.computeScaleCalibration([
    ...tight41, ...loose41, ...healthy41, failed41, ...insufficient41,
  ])
  const createWithFailure41 = rowsWithFailure41.find((row) => row.operation === 'create') as Record<string, unknown>
  assert.equal(createWithFailure41.count, 7, '【P0】失败样本仍要出现在分组总数里')
  assert.equal(createWithFailure41.successCount, 6)
  assert.equal(createWithFailure41.p95Ms, row41('create').p95Ms,
    '【P0】失败样本的异常耗时绝不能进入 P95')
  assert.equal(createWithFailure41.slowCount, 0, '【P0】失败样本永远不算慢操作')

  const summary41 = stats41.computeCalibrationSummary(rows41)
  assert.equal(summary41.tooTight, 1)
  assert.equal(summary41.tooLoose, 1)
  assert.equal(summary41.healthy, 1)
  assert.equal(summary41.insufficient, 1)
  assert.equal((summary41.worst as Record<string, unknown>).operation, 'meta_build',
    '【P0】汇总必须指出最该调参的动作')
}

// --- 第 42 组：真实样本闭环（日志 JSONL 反解 + 页面导出 + 标定面板） ---
{
  const read42 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files42 = {
    cli: '../scripts/analyze-performance-scale.mts',
    metrics: '../src/shared/observability/performanceMetrics.ts',
    toolbar: '../src/plugins/builtin/monitor/performance/PerformanceToolbar.tsx',
    tab: '../src/plugins/builtin/monitor/PerformanceTab.tsx',
    panel: '../src/plugins/builtin/monitor/performance/ScaleCalibrationPanel.tsx',
  } as const
  const entries42 = Object.entries(files42) as Array<[keyof typeof files42, string]>
  const sources42 = Object.fromEntries(
    await Promise.all(entries42.map(async ([key, relative]) => [key, await read42(relative)] as const)),
  ) as Record<keyof typeof files42, string>
  const has42 = (key: keyof typeof files42, needle: string) => sources42[key].includes(needle)

  // 1) 静态：CLI 复用宿主反解、工具条导出、组装层接线、标定面板都要真实存在。
  for (const needle of [
    'PERFORMANCE_ACTION', '../src/shared/observability/performanceMetrics.ts',
    'extractPerformanceSamples(logRows)', '条日志 →', '宿主导出的样本',
  ]) {
    assert.ok(has42('cli', needle), `【P0】标定脚本缺少日志样本闭环 ${needle}`)
  }
  for (const needle of ["typeof value === 'string'", 'JSON.parse(value)', '宿主反解']) {
    assert.ok(has42('metrics', needle), `【P0】宿主反解器缺少字符串 params 容错 ${needle}`)
  }
  for (const needle of ['onExport', '导出样本', 'Download', 'disabled={totalCount === 0}']) {
    assert.ok(has42('toolbar', needle), `【P0】性能工具条缺少 ${needle}`)
  }
  for (const needle of [
    'computeScaleCalibration(samples)', 'computeCalibrationSummary(calibrationRows)',
    'ScaleCalibrationPanel', 'onExport={handleExportSamples}', 'topomind-perf-samples-',
    '不受页面筛选影响',
  ]) {
    assert.ok(has42('tab', needle), `【P0】性能页缺少 ${needle}`)
  }
  for (const needle of [
    'CALIBRATION_VERDICT_LABELS', 'ScaleCalibrationRow', 'color-mix',
    '失败样本不进 P95', 'colSpan={11}',
  ]) {
    assert.ok(has42('panel', needle), `【P0】标定面板缺少 ${needle}`)
  }
  for (const key of ['toolbar', 'tab', 'panel'] as const) {
    assert.ok(!/#[0-9a-fA-F]{6}/.test(sources42[key]), `【P0】${key} 颜色不得硬编码 hex`)
    assert.ok(!has42(key, '@/core/') && !has42(key, 'window.electronAPI'),
      `【P0】${key} 不得直连 core / electronAPI`)
  }

  // 2) 铁律：esbuild 真跑宿主的日志反解器，并把反解结果直接喂给标定算法。
  const { build: build42 } = await import('esbuild')
  const { fileURLToPath: toPath42 } = await import('node:url')
  const load42 = async (relative: string) => {
    const result = await build42({
      entryPoints: [toPath42(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const contract42 = await load42('../src/shared/observability/performanceContract.ts') as {
    PERFORMANCE_ACTION: string
    thresholdForScale: (base: number, nodeCount: number, operation?: string) => number
  }
  const metrics42 = await load42('../src/shared/observability/performanceMetrics.ts') as {
    extractPerformanceSamples: (entries: unknown[]) => Array<Record<string, unknown>>
  }
  const stats42 = await load42('../src/shared/observability/performanceStatistics.ts') as {
    computeScaleCalibration: (samples: unknown[]) => Array<Record<string, unknown>>
  }
  const { PERFORMANCE_ACTION: action42, thresholdForScale: thresholdForScale42 } = contract42
  const threshold42 = thresholdForScale42(100, 2500, 'meta_build')
  const base42 = Date.parse('2026-11-15T02:00:00.000Z')
  const perfRow42 = (index: number, durationMs: number, success = true, stringParams = false) => {
    const params = {
      metric: 'graph_meta_build', durationMs, success, thresholdMs: threshold42,
      operation: 'meta_build', nodeCount: 2500, edgeCount: 3200, sessionId: 'verify-42',
    }
    return {
      id: `log-42-${index}`,
      timestamp: new Date(base42 + index * 1000).toISOString(),
      action: action42,
      module: 'useGraph',
      params: stringParams ? JSON.stringify(params) : params,
    }
  }
  const logRows42 = [
    ...Array.from({ length: 6 }, (_, i) => perfRow42(i, 600)),
    perfRow42(6, 9999, false),
    perfRow42(7, 620, true, true),
    {
      id: 'log-42-other', timestamp: new Date(base42 + 8000).toISOString(),
      action: '节点:创建', module: 'useGraph', params: { nodeId: 'node-42' },
    },
  ]
  const samples42 = metrics42.extractPerformanceSamples(logRows42)
  assert.equal(samples42.length, 8, '【P0】非性能日志行必须被反解器过滤')
  assert.ok(samples42.every((sample) => sample.metric === 'graph_meta_build'),
    '【P0】日志 metric 必须从 params 反解，不能兜底成 canvas_edit')
  assert.equal(samples42.filter((sample) => sample.success === false).length, 1,
    '【P0】失败样本标记必须原样保留')
  assert.equal(samples42[0].thresholdMs, threshold42, '【P0】生效阈值必须从 params 反解')
  assert.equal((samples42[0].params as Record<string, unknown>).nodeCount, 2500,
    '【P0】规模上下文必须随反解保留')
  assert.ok(samples42.some((sample) => sample.durationMs === 620),
    '【P0】旧日志的字符串 params 必须先还原再反解')

  const rows42 = stats42.computeScaleCalibration(samples42)
  const metaRow42 = rows42.find((row) => row.operation === 'meta_build')
  assert.ok(metaRow42, '【P0】日志反解出的样本必须能形成标定分组')
  assert.equal(metaRow42.count, 8)
  assert.equal(metaRow42.successCount, 7)
  assert.equal(metaRow42.slowCount, 7, '【P0】失败样本永远不算慢操作')
  assert.equal(metaRow42.verdict, 'too_tight')
  assert.ok(Number(metaRow42.suggestedFactor) > Number(metaRow42.appliedFactor),
    '【P0】过紧分组的建议倍数必须高于当前放宽倍数')

  // 3) 端到端：真的把日志 JSONL 交给 CLI 跑一遍，验证报告口径与样本数。
  const { writeFile: writeFile42, mkdtemp: mkdtemp42, rm: rm42 } = await import('node:fs/promises')
  const { tmpdir: tmpdir42 } = await import('node:os')
  const { join: join42 } = await import('node:path')
  const { spawnSync: spawnSync42 } = await import('node:child_process')
  const tempDir42 = await mkdtemp42(join42(tmpdir42(), 'tm-perf-42-'))
  try {
    const logPath42 = join42(tempDir42, 'logs.jsonl')
    const reportPath42 = join42(tempDir42, 'report.md')
    await writeFile42(logPath42, logRows42.map((row) => JSON.stringify(row)).join('\n'), 'utf8')
    const run42 = spawnSync42(process.execPath, [
      '--experimental-strip-types',
      toPath42(new URL(files42.cli, import.meta.url)),
      '--input', logPath42, '--out', reportPath42,
    ], { encoding: 'utf8', timeout: 60_000 })
    assert.equal(run42.status, 0, `【P0】标定脚本必须能直接吃日志 JSONL：${run42.stderr}`)
    const report42 = await readFile(reportPath42, 'utf8')
    assert.ok(report42.includes(`9 条日志 → 8 条${action42}样本`),
      '【P0】报告必须标明日志反解来源与反解条数')
    assert.ok(report42.includes('- 样本数：8'), '【P0】非性能日志不得混入标定分母')
    assert.ok(report42.includes('| 阈值过紧 | 1 |'), '【P0】日志样本必须能算出过紧分组')
  } finally {
    await rm42(tempDir42, { recursive: true, force: true }).catch(() => {})
  }
}

// --- 第 43 组：真实监控数据排查后的 P0/P1 修复（计时 TTL / 加载去重 / LOD 单次遍历 / 长任务归因） ---
{
  const read43 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files43 = {
    starts: '../src/shared/observability/performanceStarts.ts',
    perfLog: '../src/core/performance-log.ts',
    runtime: '../src/core/performance-runtime.ts',
    contract: '../src/shared/observability/performanceContract.ts',
    roomLoader: '../src/hooks/useGraph/useGraphRoomLoader.ts',
    lod: '../src/domain/graph/lod.ts',
    lodHook: '../src/features/graph/GraphCanvas/model/useSemanticLod.ts',
  } as const
  const entries43 = Object.entries(files43) as Array<[keyof typeof files43, string]>
  const sources43 = Object.fromEntries(
    await Promise.all(entries43.map(async ([key, relative]) => [key, await read43(relative)] as const)),
  ) as Record<keyof typeof files43, string>
  const has43 = (key: keyof typeof files43, needle: string) => sources43[key].includes(needle)

  // 1) 静态接线：五项改动都必须真实落在生产代码里，缺一即视为回退。
  for (const needle of ['PERFORMANCE_START_TTL_MS', 'consumeStart', 'pruneStaleStarts']) {
    assert.ok(has43('starts', needle), `【P0】计时起点纯函数层缺少 ${needle}`)
  }
  for (const needle of ['consumeStart(', 'pruneStaleStarts(', 'getRecentPerformanceContext']) {
    assert.ok(has43('perfLog', needle), `【P0】上报层未接入 ${needle}`)
  }
  for (const needle of ['getRecentPerformanceContext', 'recentMetric', 'recentContext']) {
    assert.ok(has43('runtime', needle), `【P0】长任务观测缺少归因上下文 ${needle}`)
  }
  assert.ok(has43('contract', "category: 'runtime', thresholdMs: 200"),
    '【P0】long_task 慢阈值必须与 ≥50ms 上报门槛拉开，否则慢率无判别力')
  for (const needle of ['inflightGraphRef', 'graphShared', 'supersededBy', 'layoutMs', 'readMs', 'applyMs']) {
    assert.ok(has43('roomLoader', needle), `【P0】房间加载缺少 ${needle}`)
  }
  assert.ok(!has43('roomLoader', 'discarded: true'),
    '【P0】被取代的加载请求不得再上报 success:false 的性能样本')
  for (const needle of ['resolvePolicy', 'LodGraphStats', 'skipCoverageProtection = resolved']) {
    assert.ok(has43('lod', needle), `【P0】LOD 纯函数层缺少单次遍历能力 ${needle}`)
  }
  for (const needle of ['resolvePolicy:', 'singlePass: true', 'recomputedTwice: false']) {
    assert.ok(has43('lodHook', needle), `【P0】LOD hook 未接入单次遍历 ${needle}`)
  }
  assert.equal((sources43.lodHook.match(/computeLodVisibility\(/g) ?? []).length, 1,
    '【P0】每次计划重算只能调用一次 computeLodVisibility')

  // 2) esbuild 真跑：计时起点 TTL 与 LOD resolvePolicy 都是零依赖纯函数。
  const { build: build43 } = await import('esbuild')
  const { fileURLToPath: toPath43 } = await import('node:url')
  const loadBundled43 = async (relative: string) => {
    const result = await build43({
      entryPoints: [toPath43(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const starts43 = await loadBundled43(files43.starts)
  assert.equal(starts43.PERFORMANCE_START_TTL_MS, 1000)
  const now43 = 100_000
  const pending43 = new Map<string, { startedAt: number }>([
    ['stale', { startedAt: now43 - 5000 }],
    ['fresh', { startedAt: now43 - 10 }],
  ])
  assert.equal(starts43.consumeStart(pending43, 'stale', now43), null,
    '【P0】陈旧计时起点必须被丢弃，否则会产出小时级假慢样本')
  assert.equal(starts43.consumeStart(pending43, 'fresh', now43), now43 - 10,
    '【P0】有效期内的计时起点必须原样返回')
  assert.equal(pending43.size, 0, '【P0】消费后必须删除 key')
  pending43.set('stale2', { startedAt: now43 - 5000 })
  starts43.pruneStaleStarts(pending43, now43)
  assert.equal(pending43.size, 0, '【P0】mark 时必须清理未被消费的过期起点')

  const lod43 = await loadBundled43(files43.lod)
  const nodes43 = [
    { id: 'r', position: { x: 0, y: 0 } },
    { id: 'c1', position: { x: 100, y: 0 } },
    { id: 'c2', position: { x: 200, y: 0 } },
  ]
  const edges43 = [
    { id: 'e1', source: 'r', target: 'c1', relation: 'subordinate' },
    { id: 'e2', source: 'r', target: 'c2', relation: 'subordinate' },
  ]
  let policyCalls43 = 0
  let stats43: Record<string, number> | null = null
  const planned43 = lod43.computeLodVisibility({
    nodes: nodes43, edges: edges43, zoom: 0.2,
    resolvePolicy: (stats: Record<string, number>) => {
      policyCalls43 += 1
      stats43 = stats
      return { mode: 'off', skipCoverageProtection: true }
    },
  })
  assert.equal(policyCalls43, 1, '【P0】一次可见性计算只能解析一次 policy')
  assert.equal(stats43?.subordinateEdgeCount, 2, '【P0】policy 回调必须拿到本趟遍历产出的树统计')
  assert.equal(stats43?.totalNodeCount, 3, '【P0】policy 回调必须拿到节点规模')
  assert.equal(planned43.reason, 'off', '【P0】回调返回的最终 mode 必须在同一趟计算里生效')
  const legacy43 = lod43.computeLodVisibility({ nodes: nodes43, edges: edges43, zoom: 0.2, mode: 'off' })
  assert.equal(legacy43.reason, 'off', '【P0】不带 resolvePolicy 的旧调用必须保持兼容')
}

// --- 第 44 组：真实标定后的 P2/P3 修复（手势卡顿口径 / 收紧动态阈值 / 保存降采样） ---
{
  const read44 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files44 = {
    timing: '../src/shared/observability/gestureTiming.ts',
    nodeChanges: '../src/hooks/useGraph/nodeChangeOperations.ts',
    canvasModel: '../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts',
    contract: '../src/shared/observability/performanceContract.ts',
    perfLog: '../src/core/performance-log.ts',
  } as const
  const entries44 = Object.entries(files44) as Array<[keyof typeof files44, string]>
  const sources44 = Object.fromEntries(
    await Promise.all(entries44.map(async ([key, relative]) => [key, await read44(relative)] as const)),
  ) as Record<keyof typeof files44, string>
  const has44 = (key: keyof typeof files44, needle: string) => sources44[key].includes(needle)

  // 1) 静态接线：手势口径只能有一个来源，两处埋点都不得再拿总时长当 durationMs。
  for (const needle of ['export function resolveGestureSampleTiming', 'dropSingleFrame', 'durationMs = maxFrameMs']) {
    assert.ok(has44('timing', needle), `【P0】手势口径纯函数缺少 ${needle}`)
  }
  for (const [key, needles] of [
    ['nodeChanges', ['resolveGestureSampleTiming(', 'timing.durationMs', 'timing.elapsedMs', "dropSingleFrame: kind === 'resize'"]],
    ['canvasModel', ['resolveGestureSampleTiming(', 'timing.durationMs', 'timing.elapsedMs', 'dropSingleFrame: false']],
  ] as Array<[keyof typeof files44, string[]]>) {
    for (const needle of needles) {
      assert.ok(has44(key, needle), `【P0】${key} 未接入手势口径 ${needle}`)
    }
    assert.ok(!has44(key, 'canvasGesture, performance.now() -'),
      `【P0】${key} 不得再把手势总时长直接上报为耗时`)
  }
  assert.ok(has44('contract', "'delete_batch', 'search', 'tree_expand', 'batch_style', 'subtree_select'"),
    '【P0】动态放宽清单必须只保留实测线性增长的批量动作')
  assert.ok(!has44('contract', "'meta_build', 'meta_flush', 'delete_batch', 'lod_recompute'"),
    '【P0】meta_build / meta_flush / lod_recompute 必须移出动态放宽清单')
  assert.ok(has44('contract', 'category: \'document\', thresholdMs: 300, sampleRate: 0.2'),
    '【P0】detail_save 必须降采样，避免高频短保存挤占监控页样本窗口')
  assert.ok(has44('perfLog', '实测不随规模增长'),
    '【P0】上报层注释必须同步真实标定结论，避免后人把三项加回去')

  // 2) esbuild 真跑：手势耗时换算与契约阈值都是零依赖纯函数。
  const { build: build44 } = await import('esbuild')
  const { fileURLToPath: toPath44 } = await import('node:url')
  const loadBundled44 = async (relative: string) => {
    const result = await build44({
      entryPoints: [toPath44(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const timing44 = await loadBundled44(files44.timing)
  assert.equal(timing44.resolveGestureSampleTiming({
    frameCount: 1, maxFrameMs: 0, elapsedMs: 1, dropSingleFrame: true,
  }), null, '【P0】只有一次 change 的即时 resize 不得上报噪声样本')
  const slowFrame44 = timing44.resolveGestureSampleTiming({
    frameCount: 40, maxFrameMs: 374, elapsedMs: 1563, dropSingleFrame: false,
  })
  assert.equal(slowFrame44.durationMs, 374,
    '【P0】手势 durationMs 必须取最慢一帧，不能是含静止停留的总时长')
  assert.equal(slowFrame44.elapsedMs, 1563,
    '【P0】整个手势时长必须另存 elapsedMs 供追溯')
  assert.equal(slowFrame44.maxFrameMs, 374, '【P0】maxFrameMs 必须原样保留')
  assert.deepEqual(timing44.resolveGestureSampleTiming({
    frameCount: 3, maxFrameMs: Number.NaN, elapsedMs: -5, dropSingleFrame: false,
  }), { durationMs: 0, elapsedMs: 0, maxFrameMs: 0 },
  '【P0】非法耗时必须兜底为 0，不得产出负样本')
  assert.ok(timing44.resolveGestureSampleTiming({
    frameCount: 1, maxFrameMs: 12, elapsedMs: 12, dropSingleFrame: false,
  }) !== null, '【P0】缩放 / 平移的单帧交互仍要保留样本')

  const contract44 = await loadBundled44(files44.contract)
  assert.equal(contract44.SCALE_ADJUSTED_OPERATIONS.length, 5,
    '【P0】动态放宽清单必须收敛到 5 项')
  for (const [operation, base] of [['meta_build', 100], ['meta_flush', 500], ['lod_recompute', 120]] as const) {
    assert.equal(contract44.thresholdForScale(base, 1469, operation), base,
      `【P0】${operation} 实测不随规模增长，不得再放宽阈值`)
  }
  assert.ok(contract44.thresholdForScale(100, 1469, 'delete_batch') > 100,
    '【P0】真正的批量 O(N) 动作仍须按规模放宽')
  assert.equal(contract44.resolvePerformanceMetricSpec('detail_save').sampleRate, 0.2,
    '【P0】detail_save 采样率必须是 0.2')
  assert.equal(contract44.resolvePerformanceMetricSpec('detail_save').thresholdMs, 300,
    '【P0】降采样不得改动慢判定阈值')
}

// --- 第 45 组：节点结构折叠触发按钮可上下拖动（2026-11-15） ---
{
  const read45 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files45 = {
    panel: '../src/features/graph/GraphPage/components/NodeTreePanel.tsx',
    store: '../src/stores/nodeTreePanelStore.ts',
    css: '../src/styles/base.css',
  } as const
  const entries45 = Object.entries(files45) as Array<[keyof typeof files45, string]>
  const sources45 = Object.fromEntries(
    await Promise.all(entries45.map(async ([key, relative]) => [key, await read45(relative)] as const)),
  ) as Record<keyof typeof files45, string>
  const has45 = (key: keyof typeof files45, needle: string) => sources45[key].includes(needle)

  // 1) 静态接线：固定 top-3 已被可拖动定位取代，选择器 / 展开语义不变。
  assert.ok(!has45('panel', 'absolute left-0 top-3 z-30'),
    '【P0】折叠按钮不得再固定在与状态抽屉重叠的 top-3')
  for (const needle of [
    'onPointerDown={handlePointerDown}', 'onPointerMove={handlePointerMove}',
    'setPointerCapture(event.pointerId)', 'HANDLE_DRAG_THRESHOLD',
    'suppressClickRef', 'data-tm-canvas-status-drawer',
    'if (dragRef.current) return', 'cursor-ns-resize',
    'touchAction: \'none\'', 'clamp(',
  ]) {
    assert.ok(has45('panel', needle), `【P0】折叠按钮缺少可拖动接线 ${needle}`)
  }
  for (const needle of ['data-tm-node-tree-panel=""', 'data-tm-node-tree-collapsed="true"', 'data-tm-node-tree-toggle=""']) {
    assert.ok(has45('panel', needle), `【P0】拖动改造不得破坏 GUI 选择器 ${needle}`)
  }
  assert.ok(has45('panel', "'--tm-node-tree-offset'") && has45('panel', 'NODE_TREE_PANEL_WIDTH'),
    '【P0】展开态的横向让位机制必须保持原样')
  assert.ok(has45('css', 'margin-left: calc(12px + var(--tm-node-tree-offset, 0px)) !important'),
    '【P0】折叠态不允许靠改状态抽屉横坐标来避让（GUI 要求 left < 20）')
  for (const needle of ['HANDLE_Y_KEY', 'readHandleY', 'writeHandleY', 'handleY: number | null', 'setHandleY']) {
    assert.ok(has45('store', needle), `【P0】位置偏好缺少持久化 ${needle}`)
  }

  // 2) esbuild 真跑 store：钳制与持久化状态真的生效，不是只有字符串。
  const { build: build45 } = await import('esbuild')
  const { fileURLToPath: toPath45 } = await import('node:url')
  const result45 = await build45({
    entryPoints: [toPath45(new URL(files45.store, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const store45 = await import(`data:text/javascript;base64,${Buffer.from(result45.outputFiles[0].text).toString('base64')}`)
  assert.equal(store45.MIN_HANDLE_Y, 12)
  assert.equal(store45.clampNodeTreeHandleY(-5), 12, '【P0】位置不得越过顶部边界')
  assert.equal(store45.clampNodeTreeHandleY(120.6), 121, '【P0】位置必须取整')
  assert.equal(store45.clampNodeTreeHandleY(99999), 5000, '【P0】超大位置必须钳制')
  assert.equal(store45.clampNodeTreeHandleY(Number.NaN), 12, '【P0】非法位置必须回落到默认')
  assert.equal(store45.useNodeTreePanelStore.getState().handleY, null,
    '【P0】未自定义时必须走自动避让，而不是写死一个坐标')
  store45.useNodeTreePanelStore.getState().setHandleY(240)
  assert.equal(store45.useNodeTreePanelStore.getState().handleY, 240,
    '【P0】拖动结束必须把位置写进 store')
  store45.useNodeTreePanelStore.getState().setHandleY(-100)
  assert.equal(store45.useNodeTreePanelStore.getState().handleY, 12,
    '【P0】写入非法位置也必须钳制')
}

// --- 第 46 组：多选链路埋点 + 选中态热路径优化（2026-11-15） ---
{
  const files46 = {
    contract: '../src/shared/observability/performanceContract.ts',
    statistics: '../src/shared/observability/performanceStatistics.ts',
    nodeChange: '../src/hooks/useGraph/nodeChangeOperations.ts',
  }
  const entries46 = Object.entries(files46) as Array<[keyof typeof files46, string]>
  const sources46 = Object.fromEntries(await Promise.all(
    entries46.map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), 'utf8')] as const),
  )) as Record<keyof typeof files46, string>
  const has46 = (key: keyof typeof files46, needle: string) => sources46[key].includes(needle)

  // 1) 多选基线埋点：只在 params.operation 增加两个维度，不新增指标 id。
  for (const needle of [
    "select: 'select'", "boxSelect: 'box_select'",
    'select: 30,', 'box_select: 50,',
    "select: '选中节点'", "box_select: '框选节点'",
  ]) {
    assert.ok(has46('contract', needle), `【P0】多选埋点契约缺少 ${needle}`)
  }
  assert.ok(has46('nodeChange', 'CANVAS_OPERATIONS.boxSelect')
    && has46('nodeChange', 'CANVAS_OPERATIONS.select')
    && has46('nodeChange', 'startCanvasSpan(storeApi, {'),
  '【P0】applyNodeSelectionChanges 必须按帧上报 select / box_select 样本')
  for (const needle of [
    'changedCount: changes.length', 'selectedBefore:', "selectionMode:",
    'appliedCount:', 'skipped: !result', 'span.fail(error)',
  ]) {
    assert.ok(has46('nodeChange', needle), `【P0】多选样本缺少可追溯字段 ${needle}`)
  }
  const selectionBody46 = sources46.nodeChange.slice(
    sources46.nodeChange.indexOf('const applyNodeSelectionChanges'),
  )
  assert.ok(!selectionBody46.includes('performance.now()'),
    '【P0】多选埋点必须走统一 span，禁止自算 performance.now()')
  assert.ok(!selectionBody46.includes('success: true'),
    '【P0】多选埋点禁止手工拼 success，交给 span 判定')

  // 2) esbuild 真跑：新动作进阈值表/标签表/下拉，指标数不变，交互类不放宽。
  const { build: build46 } = await import('esbuild')
  const { fileURLToPath: toPath46 } = await import('node:url')
  const loadBundled46 = async (relative: string) => {
    const result = await build46({
      entryPoints: [toPath46(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }
  const contract46 = await loadBundled46(files46.contract) as {
    PERFORMANCE_METRIC_IDS: string[]
    CANVAS_OPERATIONS: Record<string, string>
    CANVAS_OPERATION_THRESHOLDS: Record<string, number>
    CANVAS_OPERATION_LABELS: Record<string, string>
    canvasOperationThreshold: (operation: string) => number | null
    thresholdForScale: (base: number, nodeCount: number, operation?: string) => number
  }
  assert.equal(contract46.CANVAS_OPERATIONS.select, 'select')
  assert.equal(contract46.CANVAS_OPERATIONS.boxSelect, 'box_select')
  assert.equal(contract46.canvasOperationThreshold('select'), 30)
  assert.equal(contract46.canvasOperationThreshold('box_select'), 50)
  assert.equal(contract46.CANVAS_OPERATION_LABELS.box_select, '框选节点')
  assert.equal(contract46.PERFORMANCE_METRIC_IDS.length, 21,
    '【P0】多选只增 operation 维度，不得新增指标 id')
  assert.equal(contract46.thresholdForScale(30, 20000, 'select'), 30,
    '【P0】交互类选中动作不得按规模放宽阈值')
  assert.equal(contract46.thresholdForScale(50, 20000, 'box_select'), 50,
    '【P0】框选帧耗时不得因大图被放宽而漏报')
  assert.ok(Object.keys(contract46.CANVAS_OPERATION_THRESHOLDS).every(
    (key) => typeof contract46.CANVAS_OPERATION_LABELS[key] === 'string',
  ), '【P0】每个画布动作都必须有中文标签')
  const stats46 = await loadBundled46(files46.statistics) as {
    CANVAS_OPERATION_OPTIONS: Array<{ value: string }>
  }
  assert.ok(stats46.CANVAS_OPERATION_OPTIONS.some((option) => option.value === 'select')
    && stats46.CANVAS_OPERATION_OPTIONS.some((option) => option.value === 'box_select'),
  '【P0】监控页「画布动作」下拉必须能筛出多选样本')

  // 3) P0 三项接线：满缩放签名剔除选中、selection 专用通道、增量索引缓存。
  const files46b = {
    incremental: '../src/domain/graph/incrementalNodes.ts',
    signature: '../src/domain/graph/lodPlanSignature.ts',
    lod: '../src/domain/graph/lod.ts',
    semanticLod: '../src/features/graph/GraphCanvas/model/useSemanticLod.ts',
    graphStore: '../src/stores/graphStore.tsx',
    nodeChange: '../src/hooks/useGraph/nodeChangeOperations.ts',
  }
  const entries46b = Object.entries(files46b) as Array<[keyof typeof files46b, string]>
  const sources46b = Object.fromEntries(await Promise.all(
    entries46b.map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), 'utf8')] as const),
  )) as Record<keyof typeof files46b, string>
  const has46b = (key: keyof typeof files46b, needle: string) => sources46b[key].includes(needle)
  for (const [key, needle] of [
    ['graphStore', 'applySelectionChanges: (nextNodes, changedNodes)'],
    ['graphStore', 'selectionOnlyNodeArrays.has(b.nodes)'],
    ['graphStore', 'graphNodeIndexCache.indexFor(nodes)'],
    ['nodeChange', 'store.applySelectionChanges(result.nextNodes, result.changedNodes)'],
    ['incremental', 'cache.remember(nextNodes, nodeIndexById)'],
    ['lod', 'export function isLodFullZoom'],
    ['lod', 'const fullZoom = lodRatio >= LOD_FULL_RATIO'],
    ['semanticLod', 'buildLodPlanSignature('],
    ['semanticLod', 'const fullZoom = isLodFullZoom(zoom)'],
    ['signature', "parts.push(input.selectedNodeId ?? '')"],
  ] as Array<[keyof typeof files46b, string]>) {
    assert.ok(has46b(key, needle), `【P0】${key} 缺少多选热路径优化 ${needle}`)
  }
  assert.ok(!has46b('nodeChange', 'store.setNodes(result.nextNodes)'),
    '【P0】selection 路径不得再走全量 setNodes（reconcileMap + O(N) 历史比较）')
  assert.ok(has46b('semanticLod', 'const selectedKey = fullZoom'),
    '【P0】满缩放连「所有选中 id 拼串」都不该做')

  // 4) esbuild 真跑四个纯模块 / store，不是查源码字面量。
  const incr46 = await loadBundled46(files46b.incremental) as {
    createNodeIndexCache: () => {
      indexFor: (nodes: unknown[]) => Map<string, number>
      remember: (nodes: unknown[], index: Map<string, number>) => void
    }
    computeIncrementalNodes: (
      nodes: unknown[], changes: Map<string, number>,
      apply: (node: any, delta: number) => { changed: boolean; node: any },
      cache: unknown,
    ) => { nextNodes: any[]; changedIds: string[]; changedNodes: any[] } | null
  }
  const cache46 = incr46.createNodeIndexCache()
  const nodes46 = [{ id: 'a', v: 0 }, { id: 'b', v: 0 }, { id: 'c', v: 0 }]
  const apply46 = (node: { id: string; v: number }, delta: number) => ({
    changed: true, node: { ...node, v: node.v + delta },
  })
  const step46a = incr46.computeIncrementalNodes(nodes46, new Map([['a', 1]]), apply46, cache46)
  assert.ok(step46a, '【P0】有变更时必须产出增量结果')
  assert.equal(step46a!.changedNodes.length, 1)
  assert.equal(step46a!.nextNodes[1], nodes46[1], '【P0】未变更节点必须保持引用')
  const indexOfBase46 = cache46.indexFor(nodes46)
  assert.equal(cache46.indexFor(step46a!.nextNodes), indexOfBase46,
    '【P0】slice 产出的新数组必须登记同一份 id→index，下一帧零重建')
  const step46b = incr46.computeIncrementalNodes(
    step46a!.nextNodes, new Map([['b', 2]]), apply46, cache46,
  )
  assert.equal(cache46.indexFor(step46b!.nextNodes), indexOfBase46,
    '【P0】连续帧不得重建全图索引')
  const external46 = nodes46.map((node) => ({ ...node }))
  assert.notEqual(cache46.indexFor(external46), indexOfBase46,
    '【P0】换房间 / undo 的外部新数组必须重建索引，不能静默跳过变更')
  assert.equal(incr46.computeIncrementalNodes(nodes46, new Map([['missing', 1]]), apply46, cache46), null,
    '【P0】无有效变更必须返回 null，跳过整个 store 写入')

  const sig46 = await loadBundled46(files46b.signature) as {
    buildLodPlanSignature: (input: Record<string, unknown>) => string
  }
  const lod46 = await loadBundled46(files46b.lod) as {
    isLodFullZoom: (zoom?: number) => boolean
    computeLodVisibility: (input: Record<string, unknown>) => Record<string, any>
  }
  const ZOOM_REF46 = 0.65
  assert.equal(lod46.isLodFullZoom(ZOOM_REF46), true)
  assert.equal(lod46.isLodFullZoom(ZOOM_REF46 * 0.8), false)
  assert.equal(lod46.isLodFullZoom(undefined), true, '【P0】缺省 zoom 按 100% 处理')
  const sigBase46 = {
    hierarchyKey: 'a|b|c#e1>root>c1', edgeCount: 3, zoom: ZOOM_REF46, mode: 'auto',
    preservedDepth: 2, configuredProfileId: 'auto', pinnedKey: '', revealedKey: '',
  }
  assert.equal(
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: true, selectedKey: 'a|b', selectedNodeId: 'a' }),
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: true, selectedKey: '', selectedNodeId: 'a' }),
    '【P0】满缩放时选中集合变化不得让 LOD 计划缓存失效',
  )
  assert.notEqual(
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: true, selectedKey: '', selectedNodeId: 'a' }),
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: true, selectedKey: '', selectedNodeId: 'b' }),
    '【P0】选中节点变化必须让计划失效，否则左上角深度/类型诊断停在旧节点',
  )
  assert.notEqual(
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: false, selectedKey: 'a|b', selectedNodeId: 'a' }),
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: false, selectedKey: 'a', selectedNodeId: 'a' }),
    '【P0】缩小时整份选中集合变化仍必须让计划失效（选中节点强制显示）',
  )
  assert.notEqual(
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: true, zoom: ZOOM_REF46 * 0.8, selectedKey: '', selectedNodeId: null }),
    sig46.buildLodPlanSignature({ ...sigBase46, fullZoom: true, selectedKey: '', selectedNodeId: null }),
    '【P0】缩放变化仍必须让计划失效',
  )

  const lodNodes46 = [
    { id: 'root', position: { x: 0, y: 0 }, data: { label: '根' } },
    { id: 'c1', position: { x: 0, y: 120 }, data: {} },
    { id: 'g1', position: { x: 0, y: 240 }, data: {} },
  ]
  const lodEdges46 = [
    { id: 'e1', source: 'root', target: 'c1', relation: 'subordinate' },
    { id: 'e2', source: 'c1', target: 'g1', relation: 'subordinate' },
  ]
  const lodFull46 = lod46.computeLodVisibility({ nodes: lodNodes46, edges: lodEdges46, zoom: ZOOM_REF46 })
  assert.equal(lodFull46.hiddenNodeIds.size, 0, '【P0】满缩放短路不得藏任何节点')
  assert.equal(lodFull46.hiddenEdgeIds.size, 0, '【P0】满缩放短路不得藏任何边')
  assert.equal(lodFull46.collapsedTotal, 0)
  assert.equal(lodFull46.collapsedFreeCount, 0)
  assert.equal(lodFull46.maxDepth, 3, '【P0】满缩放短路必须保留层级诊断')
  assert.ok(lodFull46.depthLevels.every((level: { total: number; visible: number }) => level.visible === level.total),
    '【P0】满缩放每级可见数必须等于总数')
  assert.equal(lodFull46.pressureActive, true,
    '【P0】满缩放短路不得跳过压力曲线：100% 的诊断阈值仍要与裁剪同源')
  const lodMid46 = lod46.computeLodVisibility({ nodes: lodNodes46, edges: lodEdges46, zoom: ZOOM_REF46 * 0.5 })
  assert.ok(lodMid46.hiddenNodeIds.size > 0, '【P0】缩小仍必须正常裁剪')
  assert.ok(lodMid46.depthLevels.some((level: { total: number; visible: number }) => level.visible < level.total),
    '【P0】缩小时层级诊断仍要反映真实裁剪')

  const storeMod46 = await loadBundled46(files46b.graphStore) as {
    createGraphStore: () => {
      getState: () => Record<string, any>
      temporal: { getState: () => { pastStates: unknown[] } }
    }
  }
  const store46 = storeMod46.createGraphStore()
  const baseNodes46 = [
    { id: 'a', selected: false, position: { x: 0, y: 0 } },
    { id: 'b', selected: false, position: { x: 1, y: 1 } },
  ]
  store46.getState().replaceGraph(baseNodes46, [], undefined)
  const pastBefore46 = store46.temporal.getState().pastStates.length
  const nextNodes46 = baseNodes46.map((node) => node.id === 'a' ? { ...node, selected: true } : node)
  store46.getState().applySelectionChanges(nextNodes46, [nextNodes46[0]])
  const stateAfterSelection46 = store46.getState()
  assert.equal(stateAfterSelection46.selectedNodeCount, 1)
  assert.equal(stateAfterSelection46.selectedNodeId, 'a')
  assert.equal(stateAfterSelection46.nodesMap.get('a'), nextNodes46[0],
    '【P0】nodesMap 必须只增量刷新被改的节点')
  assert.equal(stateAfterSelection46.nodes[1], baseNodes46[1],
    '【P0】未选中的节点必须保持引用')
  assert.equal(store46.temporal.getState().pastStates.length, pastBefore46,
    '【P0】selected 是运行时字段，不得进撤销历史、不得触发 O(N) 快照比较')
  const editedNodes46 = stateAfterSelection46.nodes.map(
    (node: { id: string }) => node.id === 'b' ? { ...node, position: { x: 9, y: 9 } } : node,
  )
  store46.getState().setNodes(editedNodes46)
  assert.ok(store46.temporal.getState().pastStates.length > pastBefore46,
    '【P0】真实业务改动仍必须正常进历史，短路只针对 selection 事务')
}

// --- 第 47 组：hierarchy attach 宽树 O(N²) 收敛（2026-11-15） ---
// 只把深度重算起点从「父节点整棵已建子树」换成「新挂的 child 子树」，
// depth / roots / free / downgrades 语义必须逐字段等价，且写入次数线性。
{
  const hierarchyFile47 = '../src/domain/graph/graphHierarchy.ts'
  const hierarchySrc47 = await readFile(new URL(hierarchyFile47, import.meta.url), 'utf8')
  const attachBody47 = hierarchySrc47.slice(
    hierarchySrc47.indexOf('function attach('),
    hierarchySrc47.indexOf('/** 稳定顺序'),
  )
  assert.ok(attachBody47.includes('[edge.target, (h.depth.get(edge.source) ?? 1) + 1]'),
    '【P0】attach 必须从新挂的 child 起算深度，不得从父节点重遍历整棵已建子树')
  assert.ok(!attachBody47.includes('const stack = [edge.source]'),
    '【P0】禁止回退到从 parent 起遍历的 O(N²) 写法')
  assert.ok(attachBody47.includes('const seen = new Set<string>()'),
    '【P0】脏数据环防御必须保留')

  const { build: build47 } = await import('esbuild')
  const { fileURLToPath: toPath47 } = await import('node:url')
  const bundle47 = await build47({
    entryPoints: [toPath47(new URL(hierarchyFile47, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const hierarchyMod47 = await import(
    `data:text/javascript;base64,${Buffer.from(bundle47.outputFiles[0].text).toString('base64')}`
  ) as {
    buildHierarchy: (nodeIds: readonly string[], edges: readonly unknown[]) => {
      hierarchy: {
        nodes: string[]
        roots: string[]
        free: string[]
        depth: Map<string, number>
        parentEdge: Map<string, { id: string; source: string; target: string }>
        children: Map<string, string[]>
        subordinateEdges: Array<{ id: string; source: string; target: string }>
      }
      downgrades: Array<{ edgeId: string; reason: string }>
    }
    MAX_HIERARCHY_DEPTH: number
  }
  const E47 = (
    id: string, source: string, target: string,
    relation = 'subordinate', weight = 'minor',
  ) => ({ id, source, target, relation, weight })

  // 1) 独立 BFS oracle：只从 roots 逐层推深度，不复用被测实现的任何推导逻辑。
  //    覆盖乱序挂边（child 先带子树再挂父）、多根、游离、多父/环/深度降级。
  const verifyHierarchy47 = (nodeIds: string[], edges: ReturnType<typeof E47>[], label: string) => {
    const { hierarchy, downgrades } = hierarchyMod47.buildHierarchy(nodeIds, edges)
    const expected = new Map<string, number>()
    const queue: Array<[string, number]> = hierarchy.roots.map((id) => [id, 1])
    const seen = new Set<string>()
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [id, depth] = queue[cursor]
      if (seen.has(id)) continue
      seen.add(id)
      expected.set(id, depth)
      for (const child of hierarchy.children.get(id) ?? []) queue.push([child, depth + 1])
    }
    for (const id of hierarchy.nodes) {
      assert.equal(hierarchy.depth.get(id), expected.get(id) ?? 1,
        `【P0】${label}: ${id} 的深度必须与 BFS oracle 一致`)
    }
    for (const id of hierarchy.free) {
      assert.equal(hierarchy.depth.get(id), 1, `【P0】${label}: 游离节点深度必须为 1`)
      assert.ok(!hierarchy.parentEdge.has(id), `【P0】${label}: 游离节点不得有父边`)
    }
    assert.equal(hierarchy.subordinateEdges.length, hierarchy.parentEdge.size,
      `【P0】${label}: 生效从属边数必须等于 parentEdge 条目数`)
    for (const [child, edge] of hierarchy.parentEdge) {
      assert.equal(edge.target, child, `【P0】${label}: parentEdge 键必须是 child`)
      assert.ok((hierarchy.children.get(edge.source) ?? []).includes(child),
        `【P0】${label}: children 必须登记 ${child}`)
    }
    assert.ok(Math.max(...hierarchy.depth.values()) <= hierarchyMod47.MAX_HIERARCHY_DEPTH,
      `【P0】${label}: 深度不得超过上限`)
    return { hierarchy, downgrades, expected }
  }

  // 乱序：B→C / C→D 先挂（B 已带两层子树），A→B 最后挂，整棵子树必须整体下移。
  const outOfOrder47 = verifyHierarchy47(
    ['A', 'B', 'C', 'D', 'E', 'X'],
    [
      E47('z3', 'C', 'D'), E47('z1', 'B', 'C'), E47('z4', 'A', 'E', 'subordinate', 'main'),
      E47('z2', 'A', 'B', 'subordinate', 'main'), E47('z5', 'D', 'A', 'related'),
    ],
    '乱序挂边',
  )
  assert.equal(outOfOrder47.hierarchy.depth.get('A'), 1)
  assert.equal(outOfOrder47.hierarchy.depth.get('B'), 2)
  assert.equal(outOfOrder47.hierarchy.depth.get('C'), 3, '【P0】child 自带子树时也必须整体平移')
  assert.equal(outOfOrder47.hierarchy.depth.get('D'), 4)
  assert.equal(outOfOrder47.hierarchy.depth.get('E'), 2, '【P0】parent 的其它子树深度不得被改动')
  assert.deepEqual(outOfOrder47.hierarchy.free, ['X'])
  assert.equal(outOfOrder47.downgrades.length, 0)

  // 多根 + 游离 + 多父/环降级。
  const degraded47 = verifyHierarchy47(
    ['R1', 'R2', 'a', 'b', 'c', 'd', 'F1', 'F2'],
    [
      E47('d1', 'R1', 'a', 'subordinate', 'main'),
      E47('d2', 'R2', 'b', 'subordinate', 'main'),
      E47('d3', 'a', 'c', 'subordinate', 'main'),
      E47('d4', 'b', 'c'),                 // 多父：c 已有父
      E47('d5', 'c', 'R1'),               // 环：R1 是 c 的祖先
      E47('d6', 'R1', 'R1'),              // 自环
      E47('d7', 'a', 'd', 'related'),     // 非从属边不进树
    ],
    '降级图',
  )
  assert.deepEqual(degraded47.hierarchy.roots.slice().sort(), ['R1', 'R2'])
  assert.deepEqual(degraded47.hierarchy.free.slice().sort(), ['F1', 'F2', 'd'])
  assert.ok(degraded47.downgrades.some((item) => item.reason === 'multiple-parents'))
  assert.ok(degraded47.downgrades.some((item) => item.reason === 'cycle'))
  assert.ok(degraded47.downgrades.some((item) => item.reason === 'self-loop'))

  // 2) 复杂度：替换 globalThis.Map 统计 set 调用次数（旧实现每条边都重写
  //    已挂载的全部孩子，星形 5000 节点约 1250 万次；新实现每边 2 次）。
  const starEdges47 = (n: number) => Array.from({ length: n - 1 }, (_, i) => (
    E47(`s${String(i).padStart(5, '0')}`, 'n0', `n${i + 1}`)
  ))
  const measureSetCalls47 = (n: number): number => {
    const nodeIds = Array.from({ length: n }, (_, i) => `n${i}`)
    const edges = starEdges47(n)
    const NativeMap = globalThis.Map
    let calls = 0
    class CountingMap extends NativeMap {
      set(key: unknown, value: unknown) {
        calls += 1
        super.set(key, value)
        return this
      }
    }
    try {
      globalThis.Map = CountingMap as typeof Map
      const result = hierarchyMod47.buildHierarchy(nodeIds, edges)
      assert.equal(result.hierarchy.depth.get('n0'), 1)
      assert.equal(result.hierarchy.depth.get(`n${n - 1}`), 2,
        '【P0】星形树的每个孩子深度必须是 2')
      assert.equal(result.hierarchy.subordinateEdges.length, n - 1)
      assert.equal(result.downgrades.length, 0)
    } finally {
      globalThis.Map = NativeMap
    }
    return calls
  }
  const calls1000 = measureSetCalls47(1000)
  const calls4000 = measureSetCalls47(4000)
  assert.ok(calls1000 < 1000 * 10,
    `【P0】1000 节点星形的 Map.set 必须线性（实际 ${calls1000}）`)
  assert.ok(calls4000 < 4000 * 10,
    `【P0】4000 节点星形的 Map.set 必须线性（实际 ${calls4000}）`)
  assert.ok(calls4000 < calls1000 * 8,
    `【P0】写入次数必须随节点数线性增长（1000→4000 实际 ${calls1000}→${calls4000}，O(N²) 会是 ~16 倍）`)
}

// --- 第 48 组：房间加载轻量摘要 + 去重全量工作（2026-11-15） ---
// 真实日志：1469 节点房间 room_load P50 602.5 / P95 1464.7ms，readMs 占 100%。
// 旧 readRoomNodeSummaries 对 N 个节点逐个 existsSync + 物化目录各跑完整
// readGraphMeta(33 文件) + 文档清单对账(1813 次 statSync)，全在主进程同步执行。
{
  const files48 = {
    fileService: '../electron/file-service.js',
    summaryService: '../electron/services/room-summary-service.js',
    graphStore: '../src/stores/graphStore.tsx',
    roomLoader: '../src/hooks/useGraph/roomLoader.ts',
    graphBuilder: '../src/hooks/useGraph/graphBuilder.ts',
  }
  const entries48 = Object.entries(files48) as Array<[keyof typeof files48, string]>
  const src48 = Object.fromEntries(await Promise.all(
    entries48.map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), 'utf8')] as const),
  )) as Record<keyof typeof files48, string>

  // 1) 静态：摘要入口必须委托轻量层，函数体不得再出现三类重 IO。
  const fnStart48 = src48.fileService.indexOf('readRoomNodeSummaries: function(')
  const fnEnd48 = src48.fileService.indexOf('writeGraphMeta: function(', fnStart48)
  const summaryFn48 = src48.fileService.slice(fnStart48, fnEnd48)
  assert.ok(fnStart48 > 0 && fnEnd48 > fnStart48, '【P0】必须存在 readRoomNodeSummaries 入口')
  assert.ok(summaryFn48.includes('roomSummaryService.readRoomNodeSummaries(rootDir, roomPaths)'),
    '【P0】节点摘要必须委托 room-summary-service 轻量层')
  for (const forbidden of ['existsSync(', 'readGraphMeta(', 'listTopoDocuments(']) {
    assert.ok(!summaryFn48.includes(forbidden),
      `【P0】摘要入口不得再逐节点做 ${forbidden}（会同步阻塞主进程）`)
  }
  assert.ok(src48.fileService.includes("createRoomSummaryService({")
    && src48.fileService.includes('shardCount: GRAPH_SHARD_COUNT,'),
  '【P0】轻量层必须用 IO 注入接线、分片数取唯一真源')
  for (const needle of ['readdirNames', 'namesCache', 'nodes-${i}.json', 'documentExtensions']) {
    assert.ok(src48.summaryService.includes(needle), `【P0】轻量层缺少 ${needle}`)
  }
  assert.ok(!src48.summaryService.includes('writeJsonFile')
    && !src48.summaryService.includes('statSync')
    && !src48.summaryService.includes('edges-'),
  '【P0】只读摘要层禁止回写、禁止逐文件 stat、禁止读 edges 分片')

  // 2) 静态：加载链路的三次重复全量工作必须消失。
  const replaceBody48 = src48.graphStore.slice(
    src48.graphStore.indexOf('replaceGraph: (nodes, edges, viewport)'),
    src48.graphStore.indexOf('setNodes: (nodes)'),
  )
  assert.ok(replaceBody48.includes('...buildDerivedGraphState(nodes, edges, state)'),
    '【P1】replaceGraph 必须保留派生状态构建')
  assert.ok(!replaceBody48.includes('nodesMap: buildNodesMap(nodes)'),
    '【P1】replaceGraph 不得重复构建 nodesMap（会丢弃前一次 O(N) 结果）')
  assert.equal((src48.roomLoader.match(/graphMetaToRoomGraph\(/g) ?? []).length, 1,
    '【P1】roomLoader 只允许转换一次 GraphMeta→RoomGraph')
  assert.ok(src48.roomLoader.includes('buildNodes(dirPath, meta, summaries, kbPath, roomGraph)')
    && src48.roomLoader.includes('buildEdges(meta, dirPath, roomGraph)'),
  '【P1】buildNodes / buildEdges 必须复用同一次转换结果')
  assert.ok(src48.graphBuilder.includes('roomGraphOverride?: RoomGraph')
    && src48.graphBuilder.includes('roomGraphOverride ?? graphMetaToRoomGraph'),
  '【P1】两个构建函数必须支持复用且保留不传时的旧行为')

  // 3) esbuild 真跑：内存文件系统验证语义等价 + IO 次数随父目录而非节点数增长。
  const { build: build48 } = await import('esbuild')
  const { fileURLToPath: toPath48 } = await import('node:url')
  const bundle48 = await build48({
    entryPoints: [toPath48(new URL(files48.summaryService, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const { createRoomSummaryService } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle48.outputFiles[0].text).toString('base64')}`
  ) as {
    createRoomSummaryService: (deps: Record<string, unknown>) => {
      readRoomNodeSummaries: (root: string, paths: string[]) => Record<string, {
        childCount: number
        hasDetail: boolean
        position?: { x: number; y: number }
      }>
    }
  }

  const fileMap48 = new Map<string, unknown>()
  const dirMap48 = new Map<string, string[]>()
  const io48 = { readdir: 0, readJson: 0 }
  const readFiles48: string[] = []
  const root48 = '/kb/room'
  dirMap48.set(root48, ['c1', 'c2', 'c3', 'c4', 'c5'])
  // c1：v2，两个 nodes 分片共 3 个孩子，pan 有效，_docs 有一个真文档；
  //     故意放一个 edges 分片，验证它不会被计入 childCount、也不会被读。
  fileMap48.set(`${root48}/c1/_graph.json`, { version: 2, pan: { x: 10, y: 20 } })
  fileMap48.set(`${root48}/c1/_graph/nodes-0.json`, { a: {}, b: {} })
  fileMap48.set(`${root48}/c1/_graph/nodes-3.json`, { c: {} })
  fileMap48.set(`${root48}/c1/_graph/edges-0.json`, [{ id: 'e1' }])
  dirMap48.set(`${root48}/c1/_docs`, ['tree.json', 'doc_a.tdoc.json'])
  // c2：v2 空房间，_docs 只有清单文件 → hasDetail 必须为 false。
  fileMap48.set(`${root48}/c2/_graph.json`, { version: 2 })
  dirMap48.set(`${root48}/c2/_docs`, ['tree.json', 'manifest.json'])
  // c3：v1 单文件，children 3 个，pan 非法 → position undefined。
  fileMap48.set(`${root48}/c3/_graph.json`, { children: { x: {}, y: {}, z: {} }, edges: [], pan: { x: 'bad', y: 2 } })
  dirMap48.set(`${root48}/c3/_docs`, [])
  // c4：未知版本 → 与旧 readGraphMeta 抛错一样降级为空摘要。
  fileMap48.set(`${root48}/c4/_graph.json`, { version: 3, children: { q: {} } })
  dirMap48.set(`${root48}/c4/_docs`, ['doc_x.tdoc.json'])
  // c5：目录物化但没有 _graph.json，只有容器载荷 → childCount 0 / hasDetail true。
  // 只放 .exdraw.json，专门验证 P1 新扩展名确实被 hasDetail 识别（不是被 tmind 兜底）。
  dirMap48.set(`${root48}/c5/_docs`, ['scene_a.exdraw.json'])

  const service48 = createRoomSummaryService({
    readdirNames: (absDir: string) => {
      io48.readdir += 1
      const names = dirMap48.get(absDir)
      if (!names) throw new Error(`ENOENT: ${absDir}`)
      return names.slice()
    },
    readJson: (absFile: string) => {
      io48.readJson += 1
      readFiles48.push(absFile)
      return fileMap48.has(absFile) ? fileMap48.get(absFile) : {}
    },
    joinPath: (...parts: string[]) => parts.join('/'),
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
    resolveKbsPath: (_root: string, rel: string) => `/kb/${rel}`,
    documentExtensions: ['.tdoc.json', '.tmind.json', '.exdraw.json', '.tflow.json'],
    shardCount: 16,
  })

  // 1000 个未物化节点：旧实现每个都要一次 existsSync，新实现一次都不该有。
  const ghostPaths48 = Array.from({ length: 1000 }, (_, i) => `room/ghost-${i}`)
  const paths48 = ['room/c1', 'room/c2', 'room/c3', 'room/c4', 'room/c5', ...ghostPaths48, 'room/c1']
  const result48 = service48.readRoomNodeSummaries('/work', paths48)

  assert.equal(result48['room/c1'].childCount, 3, '【P0】v2 childCount 必须等于各 nodes 分片 key 之和')
  assert.equal(result48['room/c1'].hasDetail, true, '【P0】_docs 有 .tdoc.json 时必须 hasDetail')
  assert.deepEqual(result48['room/c1'].position, { x: 10, y: 20 }, '【P0】position 必须来自索引 pan')
  assert.equal(result48['room/c2'].childCount, 0)
  assert.equal(result48['room/c2'].hasDetail, false, '【P0】tree.json / manifest.json 不得被当成文档')
  assert.equal(result48['room/c3'].childCount, 3, '【P0】v1 旧库必须回退读索引 children')
  assert.equal(result48['room/c3'].position, undefined, '【P0】非法 pan 不得产生 position')
  assert.equal(result48['room/c3'].hasDetail, false)
  assert.equal(result48['room/c4'].childCount, 0, '【P0】未知版本必须降级为空摘要')
  assert.equal(result48['room/c4'].hasDetail, false, '【P0】未知版本不得继续探测 _docs')
  assert.equal(result48['room/c5'].childCount, 0)
  assert.equal(result48['room/c5'].hasDetail, true, '【P1】物化但无索引的目录只要有 .exdraw.json 容器载荷就必须识别为有详情')
  assert.equal(Object.keys(result48).length, 1005, '【P0】重复路径必须去重且每个路径都有摘要')
  for (const ghost of ghostPaths48) {
    assert.equal(result48[ghost].childCount, 0)
    assert.equal(result48[ghost].hasDetail, false)
  }
  // 1 次父目录 readdir + 4 次 _docs readdir（c4 提前降级不读）；与节点数无关。
  assert.ok(io48.readdir <= 8,
    `【P0】readdir 必须按父目录/物化目录计，不能随 N 增长（实际 ${io48.readdir}，N=1005）`)
  assert.ok(io48.readJson < 60,
    `【P0】禁止每个物化目录读 33 个分片（实际 ${io48.readJson} 次）`)
  assert.ok(readFiles48.some((p) => p.includes('/_graph/nodes-')),
    '夹具自检：确实读过 nodes 分片')
  assert.ok(!readFiles48.some((p) => p.includes('/_graph/edges-')),
    '【P0】摘要读取不得触碰 edges 分片（childCount 只依赖 nodes 分片）')
}

// --- 第 49 组：右栏自动显隐 + pin 固定（2026-11-16） ---
// 点击有自身文档（hasDetail）的节点展开，点击空白画布或无文档节点折叠；
// pin 开启后所有折叠入口统一在 store 短路，关系浮层的程序化 onPaneClick 不触发自动折叠。
{
  const files49 = {
    store: '../src/stores/rightPanelStore.ts',
    tabStore: '../src/stores/tabs/tabStore.ts',
    tabActions: '../src/stores/tabs/tabActions.ts',
    events: '../src/hooks/useGraph/graphEventHandlers.ts',
    canvas: '../src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts',
    layout: '../src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx',
    container: '../src/features/right-panel/RightPanelContainer.tsx',
    detail: '../src/features/right-panel/components/DetailTab/DetailPanel.tsx',
    card: '../src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx',
  }
  const entries49 = Object.entries(files49) as Array<[keyof typeof files49, string]>
  const src49 = Object.fromEntries(await Promise.all(
    entries49.map(async ([key, relative]) => [key, await readFile(new URL(relative, import.meta.url), 'utf8')] as const),
  )) as Record<keyof typeof files49, string>

  assert.ok(src49.store.includes('rightPanelPinned: boolean')
    && src49.store.includes('toggleRightPanelPinned: () => void')
    && src49.store.includes('applyRightPanelAutoVisibility: (hasDocument: boolean) => void'),
  '【右栏】store 必须同时暴露 pin 状态、切换动作与统一自动显隐动作')
  assert.ok(src49.store.includes('if (get().rightPanelPinned) return'),
    '【右栏】pin 必须在 store 层短路所有折叠入口，不能散落在各调用方')
  const clickBody49 = src49.events.slice(
    src49.events.indexOf('const onNodeClick'),
    src49.events.indexOf('const onEdgeClick'),
  )
  assert.ok(clickBody49.includes('ops.selectNode(node.id, event.shiftKey)')
    && !clickBody49.includes('applyRightPanelAutoVisibility'),
  '【右栏】单击节点只做选中，不再触发面板显隐（展开改由文档图标按钮触发）')
  assert.ok(src49.store.includes('applyRightPanelAutoVisibility: (hasDocument: boolean) => void')
    && src49.canvas.includes('if (event) useRightPanelStore.getState().applyRightPanelAutoVisibility(false)'),
  '【右栏】统一自动显隐通道与点空白折叠保持不变')
  assert.ok(src49.canvas.includes('if (event) useRightPanelStore.getState().applyRightPanelAutoVisibility(false)'),
    '【右栏】只有带事件的真实画布点击才自动折叠，程序化 onPaneClick 必须排除')
  assert.ok(src49.layout.includes('data-tm-right-panel-pin=')
    && src49.layout.includes('onClick={toggleRightPanelPinned}'),
  '【右栏】全屏按钮下必须有可定位的 pin 按钮')
  assert.ok(src49.container.includes('data-tm-right-panel-pinned='),
    '【右栏】容器必须暴露 pin 状态供端到端回归读取')
  assert.ok(src49.detail.includes('data-tm-right-panel-pin=')
    && src49.detail.includes('onClick={toggleRightPanelPinned}'),
  '【右栏】空状态也必须保留 pin 入口，否则画布点击清空选中后无法解除固定')
  assert.ok(src49.card.includes('rightPanel.applyRightPanelAutoVisibility(true)')
    && src49.card.includes("rightPanel.setRightPanelTab('detail')")
    && src49.card.includes('requestLinkedView'),
  '【右栏】关联文档图标点击必须展开右栏并切到关联视图，复用统一自动显隐通道')
  assert.ok(src49.card.includes('data-tm-doc-icon={id}')
    && src49.card.includes('setDetailViewForNode(id, \'own\')')
    && src49.card.includes('title="包含详情 · 点击在右栏查看本节点文档"'),
  '【右栏】本节点文档图标必须可点击，且点击后切回本节点文档视图')
  // 【2026-11-23】展开/折叠记忆必须每个知识库独立维护，且无选中文档时不渲染空白右栏。
  assert.ok(src49.store.includes('statesByKb') && src49.store.includes('activeKbPath')
    && src49.store.includes('setActiveKbPath') && src49.store.includes('renameKbState'),
  '【右栏】展开态必须按 kbPath 分桶，并提供作用域切换与改名迁移')
  assert.ok(src49.tabStore.includes('setActiveKbPath('),
    '【右栏】活跃知识库作用域必须由 tabStore 订阅同步，不能依赖 React effect 时序')
  assert.ok(src49.tabActions.includes('renameKbState(oldKbPath, newKbPath)'),
    '【右栏】知识库改名必须迁移对应的展开态分桶')
  assert.ok(src49.container.includes('!isActive')
    && src49.store.includes('rightPanelCollapsed: true'),
  '【右栏】未访问过的知识库默认折叠，且非活跃标签页不写当前分桶')
  assert.ok(!src49.container.includes('hasDetailTarget'),
    '【右栏】不得用「无选中节点一律隐藏」兜底：空状态里的 pin / 解锁入口与显式展开必须可达')

  const { build: build49 } = await import('esbuild')
  const { fileURLToPath: toPath49 } = await import('node:url')
  const bundle49 = await build49({
    entryPoints: [toPath49(new URL(files49.store, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  const storeModule49 = await import(
    `data:text/javascript;base64,${Buffer.from(bundle49.outputFiles[0].text).toString('base64')}`
  ) as {
    useRightPanelStore: {
      getState: () => {
        rightPanelCollapsed: boolean
        rightPanelPinned: boolean
        rightPanelWidth: number
        rightPanelTab: string
        activeKbPath: string
        statesByKb: Record<string, unknown>
        setActiveKbPath: (kbPath: string) => void
        renameKbState: (oldKbPath: string, newKbPath: string) => void
        setRightPanelWidth: (width: number) => void
        setRightPanelTab: (tab: 'detail' | 'style') => void
        resetRightPanel: () => void
        applyRightPanelAutoVisibility: (hasDocument: boolean) => void
        toggleRightPanelPinned: () => void
        collapseRightPanel: () => void
        expandRightPanel: () => void
      }
    }
  }
  const panel49 = storeModule49.useRightPanelStore
  panel49.getState().resetRightPanel()
  assert.equal(panel49.getState().rightPanelCollapsed, true,
    '【右栏】默认折叠：没有选中文档时不该自己冒出空白面板')
  assert.equal(panel49.getState().rightPanelPinned, false)

  panel49.getState().applyRightPanelAutoVisibility(false)
  assert.equal(panel49.getState().rightPanelCollapsed, true,
    '【右栏】无文档节点/画布点击必须折叠')
  panel49.getState().applyRightPanelAutoVisibility(true)
  assert.equal(panel49.getState().rightPanelCollapsed, false,
    '【右栏】有文档节点点击必须展开')

  panel49.getState().toggleRightPanelPinned()
  assert.equal(panel49.getState().rightPanelPinned, true)
  assert.equal(panel49.getState().rightPanelCollapsed, false, '【右栏】pin 时面板必须保持展开')
  panel49.getState().applyRightPanelAutoVisibility(false)
  panel49.getState().collapseRightPanel()
  assert.equal(panel49.getState().rightPanelCollapsed, false,
    '【右栏】pin 必须同时挡住自动折叠与手动折叠')

  panel49.getState().toggleRightPanelPinned()
  assert.equal(panel49.getState().rightPanelPinned, false)
  assert.equal(panel49.getState().rightPanelCollapsed, false,
    '【右栏】取消 pin 不应把面板意外折叠')
  panel49.getState().applyRightPanelAutoVisibility(false)
  assert.equal(panel49.getState().rightPanelCollapsed, true,
    '【右栏】取消 pin 后自动折叠必须恢复')

  // 【2026-11-23 切库串扰回归】A 展开 → B 默认折叠 → B 折叠不影响 A → 改名不丢状态。
  const state49 = panel49.getState()
  state49.resetRightPanel()
  state49.setActiveKbPath('kb-A')
  state49.applyRightPanelAutoVisibility(true)
  assert.equal(panel49.getState().rightPanelCollapsed, false,
    '【右栏】知识库 A 打开文档后展开')
  state49.setActiveKbPath('kb-B')
  assert.equal(panel49.getState().rightPanelCollapsed, true,
    '【右栏】切到未访问过的知识库 B 必须默认折叠，不得继承 A 的展开态')
  state49.applyRightPanelAutoVisibility(false)
  state49.setRightPanelWidth(720)
  state49.setRightPanelTab('style')
  state49.setActiveKbPath('kb-A')
  assert.equal(panel49.getState().rightPanelCollapsed, false,
    '【右栏】B 里的折叠不能影响 A，切回 A 仍保持展开')
  assert.equal(panel49.getState().rightPanelWidth, 600,
    '【右栏】宽度偏好也按知识库独立，B 的拖拽不能改掉 A 的宽度')
  assert.equal(panel49.getState().rightPanelTab, 'detail',
    '【右栏】面板分区也按知识库独立')
  state49.setActiveKbPath('kb-B')
  assert.equal(panel49.getState().rightPanelCollapsed, true,
    '【右栏】B 自己的折叠态同样要被记住')
  assert.equal(panel49.getState().rightPanelWidth, 720)
  state49.renameKbState('kb-A', 'kb-A-renamed')
  state49.setActiveKbPath('kb-A-renamed')
  assert.equal(panel49.getState().rightPanelCollapsed, false,
    '【右栏】知识库改名后仍保留原来的展开态')
  state49.setActiveKbPath('kb-A')
  assert.equal(panel49.getState().rightPanelCollapsed, true,
    '【右栏】旧知识库路径不应残留可复用的状态')

  state49.applyRightPanelAutoVisibility(true)
  state49.resetRightPanel()
  assert.equal(panel49.getState().rightPanelCollapsed, true)
  assert.equal(panel49.getState().rightPanelPinned, false)
  assert.equal(Object.keys(panel49.getState().statesByKb).length, 0,
    '【右栏】重置会话必须清空所有知识库的分桶')
}

// --- 第 50 组：块编辑菜单缩进/对齐平铺为一级按钮（2026-11-16） ---
// 缩进两个按钮、对齐三个按钮直接出现在块编辑菜单一级，点击即执行；
// 旧的「缩进和对齐」二级菜单入口不得回灌，底层仍走 nest/unnest/updateBlock。
{
  const menu50 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/components/SmartDocumentBlockMenu.tsx', import.meta.url,
  ), 'utf8')
  const css50 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url,
  ), 'utf8')

  assert.ok(menu50.includes("import { AlignCenter, AlignLeft, AlignRight, IndentDecrease, IndentIncrease } from 'lucide-react'")
    && menu50.includes('data-tm-block-menu-action="unnest"')
    && menu50.includes('data-tm-block-menu-action="nest"')
    && menu50.includes('title="减少缩进"') && menu50.includes('aria-label="减少缩进"')
    && menu50.includes('title="增加缩进"') && menu50.includes('aria-label="增加缩进"')
    && menu50.includes('<IndentDecrease size={16} strokeWidth={2} />')
    && menu50.includes('<IndentIncrease size={16} strokeWidth={2} />'),
  '【块菜单】缩进必须是一级纯图标按钮，文案只在 tooltip/aria-label')
  assert.ok(menu50.includes('data-tm-block-menu-action={`align-${value}`}')
    && menu50.includes("{ value: 'left', label: '左对齐', Icon: AlignLeft }")
    && menu50.includes("{ value: 'center', label: '居中', Icon: AlignCenter }")
    && menu50.includes("{ value: 'right', label: '右对齐', Icon: AlignRight }")
    && menu50.includes('<Icon size={16} strokeWidth={2} />'),
  '【块菜单】对齐必须由数据驱动平铺为工具栏同款 lucide 图标按钮')
  assert.ok(!menu50.includes('<span>减少缩进</span>')
    && !menu50.includes('<span>增加缩进</span>')
    && !menu50.includes('<span>{label}</span>'),
  '【块菜单】一级按钮不得回灌文字标签')
  assert.ok(!menu50.includes('缩进和对齐'),
  '【块菜单】不得回灌「缩进和对齐」二级菜单入口')
  assert.ok(menu50.includes('editor.unnestBlock()')
    && menu50.includes('editor.nestBlock()')
    && menu50.includes('editor.updateBlock(block, { props: { textAlignment } })'),
  '【块菜单】平铺按钮必须复用原 nest/unnest/updateBlock 回调，不能只改外观')
  assert.ok(menu50.includes("block.props?.textAlignment === value ? ' tm-smart-block-menu__tile--active' : ''")
    && menu50.includes('tm-smart-block-menu__tile-fill'),
  '【块菜单】当前对齐态必须复用磁贴 active 样式并由 block.props.textAlignment 派生')
  assert.ok(css50.includes('.tm-smart-block-menu__icon-actions {')
    && css50.includes('grid-template-columns: repeat(2, 32px)')
    && css50.includes('.tm-smart-block-menu__icon-actions--align {')
    && css50.includes('grid-template-columns: repeat(3, 32px)'),
  '【块菜单】缩进/对齐必须与顶部磁贴同列宽同间距，分别按 2 列、3 列平铺')
}

// --- 第 51 组：单击只选中，右栏改由卡片文档图标显式展开（2026-11-16） ---
// 撤销「单击自动展开 + 双击延迟取消」：选中链路完全不碰右栏，
// 本节点文档图标变成按钮，点击后走统一自动显隐通道并切回本节点文档视图。
{
  const events51 = await readFile(new URL(
    '../src/hooks/useGraph/graphEventHandlers.ts', import.meta.url,
  ), 'utf8')
  const card51 = await readFile(new URL(
    '../src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx', import.meta.url,
  ), 'utf8')
  const baseCss51 = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8')
  const clickBody51 = events51.slice(
    events51.indexOf('const onNodeClick'),
    events51.indexOf('const onEdgeClick'),
  )

  assert.ok(clickBody51.includes('ops.selectNode(node.id, event.shiftKey)')
    && !clickBody51.includes('applyRightPanelAutoVisibility')
    && !clickBody51.includes('setTimeout')
    && !clickBody51.includes('event.detail'),
  '【节点点击】单击只做选中，不得触发右栏显隐，也不得残留双击分流逻辑')
  assert.ok(!events51.includes('nodeHasDocument')
    && !events51.includes('useRightPanelStore')
    && !events51.includes('rightPanelVisibilityTimerRef'),
  '【节点点击】事件层不得残留右栏状态与待执行 timer')

  const docIconAt51 = card51.indexOf('data-tm-doc-icon={id}')
  assert.ok(docIconAt51 > 0, '【文档图标】必须有可定位的 data-tm-doc-icon 标记')
  const docButton51 = card51.slice(
    card51.lastIndexOf('{hasDetail && (', docIconAt51),
    docIconAt51 + 1400,
  )
  assert.ok(docButton51.includes('<button')
    && docButton51.includes('type="button"')
    && docButton51.includes('onPointerDown={(event) => event.stopPropagation()}')
    && docButton51.includes('onDoubleClick={(event) => event.stopPropagation()}'),
  '【文档图标】必须是独立按钮且不把点击冒泡成选中/重命名')
  assert.ok(docButton51.includes('title="包含详情 · 点击在右栏查看本节点文档"')
    && docButton51.includes('openOwnDocument()')
    && card51.includes('const openOwnDocument = useCallback(() => {')
    && card51.includes('selectGraphNode(id)')
    && card51.includes('rightPanel.applyRightPanelAutoVisibility(true)')
    && card51.includes("rightPanel.setRightPanelTab('detail')")
    && card51.includes("setDetailViewForNode(id, 'own')"),
  '【文档图标】点击必须选中本节点、展开右栏并切回本节点文档而非关联视图')
  assert.ok(docButton51.includes('onPointerDownCapture={(event) => {')
    && docButton51.includes('event.button !== 0 || !event.isPrimary')
    && docButton51.includes('onMouseDown={(event) => event.stopPropagation()}')
    && docButton51.includes('if (event.detail === 0) openOwnDocument()'),
  '【文档图标】真实鼠标必须在 pointerdown 即展开，click 只兜底键盘/程序化触发')
  assert.ok(baseCss51.includes('.tm-card-doc-icon {')
    && baseCss51.includes('.tm-card-doc-icon::before {')
    && baseCss51.includes('inset: -5px'),
  '【文档图标】必须用伪元素放大命中区，且不改 flex 宽度')
  assert.ok(card51.includes('requestLinkedView')
    && card51.includes('title={`${linkedDocumentCount} 篇关联文档 · 点击在右栏查看`}'),
  '【关联图标】链环按钮原有的展开关联视图语义不得回退')
}

// --- 第 52 组：节点锁定在知识库内跨房间持续有效（2026-11-16） ---
// 旧实现只存裸 nodeId，切房间后用当前房间解析 nodePath，且 hasSelectedNode=false
// 导致右栏进空状态、解锁按钮随 DocumentWorkspace 一起卸载，用户无法自救。
{
  const lock52 = await readFile(new URL(
    '../src/features/right-panel/model/detailLockStore.ts', import.meta.url,
  ), 'utf8')
  const panel52 = await readFile(new URL(
    '../src/features/right-panel/components/DetailTab/DetailPanel.tsx', import.meta.url,
  ), 'utf8')
  const layout52 = await readFile(new URL(
    '../src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx', import.meta.url,
  ), 'utf8')

  assert.ok(lock52.includes('roomPath: string')
    && lock52.includes('label: string')
    && lock52.includes('childCount: number')
    && lock52.includes('lockedByKb: Record<string, DetailLockTarget | null>'),
  '【跨房间锁定】锁定目标必须携带原房间路径，不能只存裸 nodeId')
  assert.ok(lock52.includes('version: 2')
    && lock52.includes('migrate: (persisted, version) => {')
    && lock52.includes("roomPath: '', label: '', childCount: 0"),
  '【跨房间锁定】v1 裸 nodeId 持久化数据必须迁移，旧锁不能按当前房间误解析')

  assert.ok(panel52.includes('const roomPath = lockedRoomPath || session.roomPath || session.kbPath'),
    '【跨房间锁定】文档目录必须按锁定时的房间解析，禁止用当前房间路径')
  assert.ok(panel52.includes('const lockedOutsideRoom = !!lockedTarget && !!lockedRoomPath')
    && panel52.includes('const hasSelectedNode = nodeInCurrentRoom || lockedOutsideRoom'),
  '【跨房间锁定】锁定节点不在当前 nodesMap 时不得进空状态')
  assert.ok(panel52.includes('data-tm-detail-unlock-empty="true"')
    && panel52.includes('onClick={() => unlock(kbPath)}')
    && panel52.includes('aria-label="解锁节点"'),
  '【跨房间锁定】空状态也必须保留解锁入口，避免无法自救')

  const lockCall52 = layout52.slice(layout52.indexOf('onClick={() => toggleLock('), layout52.indexOf('disabled={!isLocked'))
  assert.ok(lockCall52.includes('nodeId: selectedNodeIdRaw')
    && lockCall52.includes('roomPath: graphSession.roomPath || graphSession.kbPath')
    && lockCall52.includes('label: selectedNodeLabel')
    && lockCall52.includes('childCount: selectedNodeChildCount')
    && lockCall52.includes('isLocked ? null :'),
  '【跨房间锁定】锁定动作必须写入房间路径与节点展示信息，解锁仍走同一入口')
}

// --- 第 53 组：首块 H1 顶部留白不被光标定位滚动吃掉 ---
// Ctrl+Home / 点击把光标移回首块时，ProseMirror 把首块顶对齐滚动容器上沿，
// scrollTop 停在约 30px，恰好滚掉 .bn-editor 的 24px 顶部留白。scrollMargin 与
// CSS scroll-padding 都拦不住这段对齐，因此在选区变化后一帧内检测伪滚动并归零。
{
  const editor53 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url,
  ), 'utf8')
  const effect53 = editor53.slice(
    editor53.indexOf('const unsubscribe = editor.onSelectionChange'),
    editor53.indexOf('const padTop = getEditorTopInset(editorRoot)'),
  )

  assert.ok(effect53.includes('editor.onSelectionChange')
    && effect53.includes('requestAnimationFrame'),
  '【首块 H1 留白】必须订阅选区变化并在一帧后校正，PM 滚动发生在选区变化同一 tick')
  assert.ok(effect53.includes('const top = scrollContainer.scrollTop')
    && effect53.includes('top <= 0 || top > MIN_RESTORE_SCROLL_TOP')
    && effect53.includes('scrollContainer.scrollTop = 0'),
  '【首块 H1 留白】仅对 (0, MIN_RESTORE_SCROLL_TOP] 伪滚动归零，真实阅读位置不动')
  assert.ok(effect53.includes('editor.getTextCursorPosition().block.id')
    && effect53.includes('editor.document[0]?.id === cursorBlockId'),
  '【首块 H1 留白】仅当光标落在文档首块才归零，其它块的光标定位不受影响')
  assert.ok(effect53.includes('unsubscribe()')
    && effect53.includes('cancelAnimationFrame(frame)'),
  '【首块 H1 留白】卸载时必须退订并取消待执行帧，避免切文档后误滚')
}

// --- 第 54 组：块编辑侧栏不得压在文档层级面包屑栏上 ---
// 侧栏是 portal 到 body 的浮层，不受正文滚动容器裁剪：贴顶块的侧栏/块菜单会
// 越过正文上边界压住面包屑栏，展开后还会以更高 z-index 穿透面包屑下拉列表。
// 修复口径：越界直接隐藏且不可点；面包屑下拉展开期间整条侧栏让位。
{
  const side54 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/components/SmartDocumentSideMenu.tsx', import.meta.url,
  ), 'utf8')
  const css54 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url,
  ), 'utf8')
  const crumb54 = await readFile(new URL(
    '../src/features/right-panel/components/DetailTab/DocumentBreadcrumb.tsx', import.meta.url,
  ), 'utf8')

  assert.ok(side54.includes('function useSideMenuTopBoundGuard(')
    && side54.includes("closest<HTMLElement>('.tm-smart-editor-scroll')")
    && side54.includes("const scrollerTop = scroller.getBoundingClientRect().top")
    && side54.includes('const rect = area.getBoundingClientRect()')
    && side54.includes('rect.height > 0 && rect.top > 0 && rect.top < scrollerTop - 1')
    // 铁律：越界判据只能看侧栏手柄 area，绝不能把展开的块菜单算进来。
    // 块菜单向上 flip 越过顶部是正常弹层行为，把它当越界会让菜单一闪而过。
    && !side54.includes("document.querySelector<HTMLElement>('.tm-smart-block-menu')")
    && !side54.includes("area.querySelector<HTMLElement>('.tm-smart-block-menu')")
    && !side54.includes('menuObserver'),
  '【块侧栏越界】只按滚动区上边界判断侧栏手柄本身，绝不把展开菜单纳入越界判据')
  assert.ok(side54.includes('data-tm-side-menu-outside={outsideTopBound ? \'true\' : undefined}')
    && side54.includes('setTimeout(() => evaluate(true), 150)')
    && side54.includes('const check = () => evaluate(false)')
    && side54.includes("scroller.addEventListener('scroll', check, { passive: true })")
    && side54.includes('raf = requestAnimationFrame(tick)')
    && side54.includes('cancelAnimationFrame(raf)'),
  '【块侧栏越界】必须逐帧复算并去抖确认，避免隐藏状态粘滞')
  assert.ok(css54.includes('.tm-smart-side-menu-hit-area[data-tm-side-menu-outside="true"],')
    && css54.includes('body:has([data-tm-breadcrumb-dropdown-open="true"]) .tm-smart-side-menu-hit-area,')
    && css54.includes('body:has([data-tm-breadcrumb-dropdown-open="true"]) .tm-smart-block-menu {')
    && css54.includes('visibility: hidden !important;')
    && css54.includes('pointer-events: none !important;'),
  '【块侧栏越界】越界/面包屑下拉期间必须视觉隐藏且完全不接收鼠标')
  assert.ok(crumb54.includes("data-tm-breadcrumb-dropdown-open={openDropdownId ? 'true' : 'false'}")
    && crumb54.includes('data-tm-breadcrumb-dropdown=""'),
  '【面包屑下拉】必须暴露开关标记，供 body 级 :has 规则关掉块编辑侧栏')
}

// --- 第 55 组：斜杠菜单 / 空行 + 号菜单（SuggestionMenu）样式与边界 ---
// 两个入口共用 BlockNote 内置 SuggestionMenu，浮层 portal 到 body（不在 .bn-mantine
// 祖先下）。真实 DOM 是 .bn-suggestion-menu-item + [aria-selected="true"]；旧样式误用
// .bn-menu-item + [data-selected="true"]，高亮/配色从未命中，菜单长期是默认灰。
// 边界须取滚动容器（state 持有），size 直接给面板限高，保证顶端/底端完整显示。
{
  const editor55 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url,
  ), 'utf8')
  const css55 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url,
  ), 'utf8')

  const menuBlock55 = css55.slice(
    css55.indexOf('   斜杠菜单 / 空行 + 号菜单（BlockNote SuggestionMenu）'),
    css55.indexOf('/* 加载态 / 空结果', css55.indexOf('.bn-suggestion-menu {')),
  )
  assert.ok(menuBlock55.includes('.bn-suggestion-menu .bn-suggestion-menu-item:hover')
    && menuBlock55.includes('.bn-suggestion-menu .bn-suggestion-menu-item[aria-selected="true"]')
    && !css55.includes('.bn-suggestion-menu .bn-menu-item'),
  '【斜杠菜单】命中项必须用真实 DOM 类名 .bn-suggestion-menu-item + aria-selected，不得用 .bn-menu-item')
  assert.ok(menuBlock55.includes('.bn-suggestion-menu-label')
    && menuBlock55.includes('.bn-mt-suggestion-menu-item-section[data-position="left"]')
    && menuBlock55.includes('.bn-mt-suggestion-menu-item-title')
    && menuBlock55.includes('.bn-mt-suggestion-menu-item-subtitle'),
  '【斜杠菜单】必须自包含覆盖分组标题/图标槽/标题/副文本，不依赖 portal 外的 .bn-mantine')
  assert.ok(menuBlock55.includes('overflow-y: auto !important')
    && menuBlock55.includes('overscroll-behavior: contain !important')
    && menuBlock55.includes('max-height: min(520px, calc(100vh - 96px))'),
  '【斜杠菜单】面板须可内部滚动且有兜底限高，但不能用 !important 盖掉中间件动态高度')
  assert.ok(!menuBlock55.includes('max-height: inherit !important'),
  '【斜杠菜单】不得用 max-height:inherit!important——会压过 size 中间件、把菜单压成细缝')

  const slashCtrl55 = editor55.slice(
    editor55.indexOf('<SuggestionMenuController'),
    editor55.indexOf('<FormattingToolbarController'),
  )
  assert.ok(slashCtrl55.includes('boundary: slashMenuBoundary ?? undefined')
    && !slashCtrl55.includes('boundary: scrollContainerRef.current'),
  '【斜杠菜单】flip/shift/size 边界须取 state 边界，不得用首帧为 null 的 ref.current')
  assert.ok(slashCtrl55.includes("querySelector<HTMLElement>('.bn-suggestion-menu')")
    && slashCtrl55.includes('panel.style.maxHeight = maxHeight')
    && slashCtrl55.includes('elements.floating.style.maxHeight = maxHeight'),
  '【斜杠菜单】size 必须同时约束浮层根与面板本体，portal 包装层截断继承链时仍完整显示')
  assert.ok(editor55.includes('const attachScrollContainer = useCallback(')
    && editor55.includes('setSlashMenuBoundary(node)')
    && editor55.includes('ref={attachScrollContainer}')
    && editor55.includes('const [slashMenuBoundary, setSlashMenuBoundary] = useState<HTMLDivElement | null>(null)'),
  '【斜杠菜单】滚动容器须用 callback ref 写入 state，保证边界元素稳定可用')
}

// --- 第 56 组：附件文件名 hover tooltip ---
// 图片/附件块 hover 停稳后只展示附件文件名：附件默认都在当前节点目录内，
// 相对引用与绝对本地路径都是冗余信息，操作按钮也由「附件」Tab 承载。
// 文件名提取仍走 attachmentPath.ts 单一真源；tooltip portal 到 body、
// pointer-events:none，绝不进 ProseMirror DOM（历史踩坑：块内 widget 破坏布局），
// 也不抢鼠标/点击事件。
{
  const editor56 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx', import.meta.url,
  ), 'utf8')
  const registry56 = await readFile(new URL(
    '../src/features/documents/services/documentEditorRegistry.tsx', import.meta.url,
  ), 'utf8')
  const pathUtil56 = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/attachmentPath.ts', import.meta.url,
  ), 'utf8')

  assert.ok(pathUtil56.includes('export function normalizeAttachmentRef')
    && pathUtil56.includes('export function getAttachmentRefFromBlockProps')
    && pathUtil56.includes('export function canDeriveAttachmentRefFromUrl')
    && registry56.includes("from '../SmartDocumentEditor/attachmentPath'")
    && !registry56.includes('function normalizeAttachmentRef('),
  '【附件路径】路径归一化必须走 attachmentPath.ts 单一真源，registry 不得再本地定义')
  assert.ok(editor56.includes('.bn-block-content[data-content-type="image"]')
    && editor56.includes('.bn-block-content[data-content-type="file"]')
    && editor56.includes("editorRoot.addEventListener('mouseover', handleMouseOver)"),
  '【附件路径】hover 须同时覆盖图片块与文件块，且用 editorRoot 事件委托')
  // hover-intent：停留一会儿才弹，划过不弹；块内子元素移动不重置；真正离开撤销待打开。
  assert.ok(editor56.includes('const attachmentPathOpenTimerRef = useRef<number | null>(null)')
    && editor56.includes('const pendingAttachmentBlockRef = useRef<string | null>(null)')
    && editor56.includes('const scheduleAttachmentPathOpen = useCallback(')
    && editor56.includes('}, 400)')
    && editor56.includes('scheduleAttachmentPathOpen(container, blockId)')
    && editor56.includes('window.clearTimeout(attachmentPathOpenTimerRef.current)'),
  '【附件路径】浮层须 hover 停留 400ms 才打开，块内移动不重置，离开撤销待打开（划过不弹）')
  assert.ok(editor56.includes('getAttachmentRefFromBlockProps(props,')
    && editor56.includes('getAttachmentFileNameFromRef(attachmentRef)')
    && !editor56.includes('getAttachmentAbsoluteUrl(attachmentCardPath')
    && !editor56.includes('showAttachmentInFolder(attachmentCardPath')
    && !editor56.includes('复制引用路径')
    && !editor56.includes('在文件夹中显示'),
  '【附件文件名】只展示文件名：引用仍走 attachmentPath.ts 单一真源，不再异步补绝对路径、不再放操作按钮')
  assert.ok(editor56.includes('attachmentInsertTargetKey, attachmentCardPath, onTocActiveChange')
    && editor56.includes('prevProps.attachmentCardPath === nextProps.attachmentCardPath')
    && registry56.includes('attachmentCardPath={attachmentCardPath}'),
  '【附件路径】解析/定位附件须用节点路径 attachmentCardPath，不得误用文档路径 attachmentInsertTargetKey')
  assert.ok(editor56.includes('tm-attachment-tooltip tm-fade-enter pointer-events-none')
    && editor56.includes('role="tooltip"')
    && editor56.includes('max-w-[280px]')
    && editor56.includes('{attachmentPathMenu.fileName}')
    && !editor56.includes('onMouseEnter={cancelAttachmentPathClose}')
    && !editor56.includes('onMouseLeave={scheduleAttachmentPathClose}'),
  '【附件文件名】提示须是 portal 到 body 的纯展示 tooltip：单行小尺寸、只显示文件名、不可交互、不做移入保活')
  assert.ok(editor56.includes("if (event.key === 'Escape') closeAttachmentPathMenu()")
    && editor56.includes('const handleScroll = () => closeAttachmentPathMenu()')
    && !editor56.includes('}, 180)')
    && !editor56.includes("event.target.closest('.tm-attachment-path-menu')"),
  '【附件文件名】鼠标移开立即隐藏（无延迟保活），Escape/滚动/按下鼠标即关闭，不再设浮层内 mousedown 白名单')
  assert.ok(editor56.includes('Math.min(rect.bottom + 6, maxTop)')
    && editor56.includes("transform: 'translate(-50%, 0)'")
    && !editor56.includes('rect.top - 6')
    && !editor56.includes("translate(-50%, -100%)"),
  '【附件文件名】提示须锚定图片块下方：块上方是媒体对齐工具条区域，放上面会与之重叠')
}

// --- 第 57 组：媒体块（图片/文件/视频）对齐浮层 ---
// 根因：core 的 getSelection() 对 NodeSelection（"node" in selection）返回 undefined，
// 依赖它取当前块的对齐按钮从未渲染，只剩 BlockNote 空的工具条壳（视觉上是小圆点）。
// 修复：ImageAlignToolbar 从 data-id + editor.getBlock() 取块并 updateBlock(textAlignment)，
// 同时用 CSS 隐藏空壳工具条。颜色只用 tokens.css。
{
  const alignCmp = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/components/ImageAlignToolbar.tsx', import.meta.url,
  ), 'utf8')
  const alignCss = await readFile(new URL(
    '../src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css', import.meta.url,
  ), 'utf8')

  assert.ok(alignCmp.includes("new Set(['image', 'file', 'video'])")
    && alignCmp.includes('.bn-block[data-id]')
    && alignCmp.includes('editor.getBlock(blockId)')
    && alignCmp.includes('editor.updateBlock(block, { props: { textAlignment: value } })'),
  '【图片对齐】须覆盖 image/file/video，从 data-id + getBlock 取块，禁依赖对 NodeSelection 失效的 getSelection()')
  const alignCode57 = alignCmp.slice(alignCmp.indexOf('const MEDIA_BLOCK_TYPES'))
  assert.ok(!alignCode57.includes('editor.getSelection()')
    && alignCmp.includes('.ProseMirror-selectednode'),
  '【图片对齐】不得用 getSelection() 取当前块，须按真实 DOM 选中态判定媒体块')
  assert.ok(alignCmp.includes("const topCandidate = rect.top - TOOLBAR_HEIGHT - EDGE_GAP")
    && alignCmp.includes("placement: Placement = topCandidate >= EDGE_GAP ? 'top' : 'bottom'")
    && alignCmp.includes('content.querySelector<HTMLElement>(\'img, video, .bn-file-block-content, [data-file-block]\') ?? content')
    && alignCmp.includes('const centerX = rect.left + rect.width / 2')
    && alignCmp.includes('centerX - TOOLBAR_WIDTH / 2')
    && alignCmp.includes('window.innerWidth - TOOLBAR_WIDTH - EDGE_GAP'),
  '【图片对齐】浮层须按媒体本身矩形水平居中、顶部不足翻到下方、左右视口钳制（不得按块容器左边缘贴左）')
  assert.ok(alignCss.includes('.bn-formatting-toolbar:empty')
    && alignCss.includes('display: none !important'),
  '【图片对齐】必须隐藏选中媒体块时空的格式化工具条壳（小圆点）')
  assert.ok(alignCss.includes('.tm-image-align-toolbar')
    && alignCss.includes('background: var(--color-surface-elevated)')
    && alignCss.includes('background: var(--color-accent-soft)')
    && alignCss.includes('border-radius: var(--radius-lg)')
    && alignCss.includes('box-shadow: var(--shadow-popover)'),
  '【图片对齐】浮层样式须走 tokens.css 设计令牌，选中态用 accent-soft')
  // portal 到 body 的浮层默认 z-index:auto 会被标题栏/右栏盖住（DOM 渲染了但肉眼看不到），
  // 必须与其它浮层一样显式抬高层级，否则功能形同虚设。
  const alignRootCss57 = alignCss.slice(
    alignCss.indexOf('.tm-image-align-toolbar {'),
    alignCss.indexOf('@keyframes tm-image-align-toolbar-in'),
  )
  assert.ok(alignRootCss57.includes('z-index: 4000'),
  '【图片对齐】portal 到 body 的浮层必须显式抬高 z-index，否则被标题栏/右栏盖住导致不可见')
  assert.ok(alignCmp.includes('onMouseDown={(event) => event.preventDefault()}')
    && alignCmp.includes('aria-pressed={state.alignment === value}')
    && alignCmp.includes('data-tm-image-align-value={value}'),
  '【图片对齐】点击按钮不得让编辑器失焦，且须暴露选中态与可测试标记')
}

// ===== 第 58 组：全局导航层（App 单例浮层 / 画布宽度恒定 / 插件可扩展）2026-11-21 =====
{
  const readSrc58 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const app58 = await readSrc58('src/App.tsx')
  const rail58 = await readSrc58('src/features/layout/NavRail/NavRail.tsx')
  const slot58 = await readSrc58('src/features/layout/NavRail/NavRailSlot.tsx')
  const store58 = await readSrc58('src/stores/layoutStore.ts')
  const page58 = await readSrc58('src/features/graph/GraphPage/GraphPage.tsx')
  const canvas58 = await readSrc58('src/features/graph/GraphCanvas/GraphCanvas.tsx')
  const tokens58 = await readSrc58('src/styles/tokens.css')
  const css58 = await readSrc58('src/styles/base.css')
  const manifest58 = await readSrc58('src/plugins/host/pluginManifest.ts')
  const registry58 = await readSrc58('src/plugins/host/pluginRegistry.ts')
  const public58 = await readSrc58('src/plugins/public/manifest.ts')
  const monitor58 = await readSrc58('src/plugins/builtin/monitor/manifest.json')
  const learning58 = await readSrc58('src/plugins/builtin/learning-statistics/manifest.json')

  assert.equal(app58.match(/<NavRail \/>/g)?.length ?? 0, 1,
    '【导航层】NavRail 只能是 App 层单例，放进 GraphPage 会随每个知识库标签页重复渲染')
  assert.ok(app58.includes('data-tm-app-view="home"') && app58.includes('data-tm-app-view="secondary"'),
    '【导航层】仅非画布视图标记让位，画布容器绝不左移')
  assert.ok(rail58.includes('absolute inset-y-0 left-0 z-40') && !rail58.includes('flex-1'),
    '【导航层】导航栏自身必须是 z-40 的 absolute 浮层，不参与 flex 两栏')
  assert.ok(!page58.includes('layoutStore') && !canvas58.includes('layoutStore'),
    '【导航层】画布 / GraphCanvas 不得订阅导航状态，否则展开收起会重算画布')
  assert.ok(page58.includes('id="app-layout" className="relative w-full h-full"')
    && page58.includes('id="graph-panel" className="absolute inset-0 isolate overflow-clip'),
  '【导航层】既有画布浮层契约必须原样保留')
  assert.ok(tokens58.includes('--nav-rail-width: 48px') && tokens58.includes('--z-nav-rail: 40'),
    '【导航层】宽度与层级必须走 tokens.css 设计变量')
  assert.ok(css58.includes("html[data-tm-nav-rail-docked='true'] [data-tm-app-view]")
    && css58.includes('margin-left: calc(12px + var(--tm-node-tree-offset, 0px)) !important'),
  '【导航层】让位只能用 CSS 变量，且原有节点树让位规则不得被删除')
  assert.ok(css58.includes("html[data-tm-nav-rail-open='true']")
    && rail58.includes('root.dataset.tmNavRailOpen'),
  '【导航层】导航展开时节点树与状态抽屉必须让位，避免被 48px rail 遮住')
  // 2026-11-23 补：左下角缩略图 / 缩放控件组原本仍停在 React Flow 默认 15px 边距，
  // 被 48px 的 z-40 导航栏浮层盖住。让位必须是纯 CSS 的条件规则，导航栏隐藏时自动还原。
  assert.ok(css58.includes("html[data-tm-nav-rail-open='true'] #app-layout .react-flow__panel.bottom.left")
    && css58.includes('margin-left: calc(15px + var(--nav-rail-width)) !important'),
  '【导航层】导航展开时左下角缩略图 / 缩放控件组必须让位 48px rail，且只改 margin-left')
  assert.equal((css58.match(/#app-layout \.react-flow__panel\.bottom\.left/g) ?? []).length, 1,
    '【导航层】左下角缩略图只允许一条条件让位规则，导航栏隐藏时必须回到默认 15px 边距')
  const miniMap58 = await readSrc58('src/features/graph/GraphCanvas/components/CanvasMiniMap.tsx')
  assert.ok(!miniMap58.includes('layoutStore') && !miniMap58.includes('railVisible')
    && miniMap58.includes('getBoundingClientRect()'),
  '【导航层】缩略图让位必须纯 CSS；组件不得订阅导航状态，点击定位按实测矩形换算')
  assert.ok(!css58.includes("html[data-tm-immersive='true']") && !css58.includes('data-tm-immersive'),
    '【导航层】专注模式已移除，不得再写入沉浸态 CSS')
  assert.ok(store58.includes('railVisible') && store58.includes('toggleRailVisible')
    && !store58.includes('focusMode') && !store58.includes('secondaryPanel')
    && !store58.includes('export type NavRailMode')
    && !store58.includes('setRailMode') && !store58.includes('toggleRailMode')
    && !store58.includes('railPeeking'),
    '【导航层】显隐必须收敛为单一全局二态 railVisible；二级面板 / 沉浸态 / 三态 / peek 态不得回灌（仅允许旧版偏好的一次性迁移读取）')
  assert.ok(!store58.includes('closePanel') && !store58.includes('openPanel')
    && !rail58.includes("addEventListener('mousemove'")
    && !rail58.includes('railPeeking')
    && !rail58.includes('展开全局导航栏'),
  '【导航层】边缘触发条 / 鼠标唤出 / peek 兜底 / 二级面板 / 栏内收起按钮必须移除，标题栏是唯一开关')
  assert.ok(public58.includes('navItems?: NavItemContribution[]')
    && manifest58.includes('parseNavItems')
    && registry58.includes('listStaticNavItems')
    && slot58.includes('listStaticNavItems'),
  '【导航层】插件必须能通过 manifest 声明导航项并被宿主 slot 消费')
  assert.ok(monitor58.includes('"navItems"') && learning58.includes('"navItems"'),
    '【导航层】日志与学习记录两个内置插件必须贡献导航图标')
}

// ===== 59. 统一控件设计契约（2026-11-21）=====
// 这一组不检查具体控件长什么样，而是保证「后续设计沿用统一规范」的机制本身没被拆掉。
{
  const readSrc59 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const main59 = await readSrc59('src/main.tsx')
  const tokens59 = await readSrc59('src/styles/tokens.css')
  const controls59 = await readSrc59('src/styles/controls.css')
  const contract59 = await readSrc59('src/shared/ui/controlStyles.ts')
  const lod59 = await readSrc59('src/features/graph/GraphCanvas/components/LodControl.tsx')
  const guard59 = await readSrc59('scripts/verify-design-system.mjs')
  const baseline59 = JSON.parse(await readSrc59('scripts/design-system-baseline.json'))
  const doc59 = await readSrc59('docs/design/ui-control-system.md')
  const pkg59 = JSON.parse(await readSrc59('package.json'))

  assert.ok(main59.includes("import './styles/controls.css'"),
    '【设计契约】controls.css 必须由 main.tsx 引入，否则所有 .tm-* 控件类失效')
  assert.ok(tokens59.includes('--control-radius:') && tokens59.includes('--z-popover:'),
    '【设计契约】控件级语义 token 必须放在 tokens.css 唯一真源')
  assert.ok(controls59.includes('.tm-btn') && controls59.includes('.tm-icon-btn')
    && controls59.includes(':disabled') && controls59.includes(':hover:not(:disabled)'),
  '【设计契约】交互态必须集中在 controls.css，禁止组件各自手写 hover/disabled')
  assert.ok(!controls59.replace(/\/\*[\s\S]*?\*\//g, '').includes('!important'),
    '【设计契约】controls.css 不得用 !important 覆盖被精确断言的 className')
  assert.ok(contract59.includes('export const TM_UI') && contract59.includes('tmUI'),
    '【设计契约】TM_UI 常量是新增控件的唯一 TS 入口，不得退化成第二份 Tailwind 真源')
  assert.ok(lod59.includes('tm-btn') && lod59.includes('tm-select') && lod59.includes('tm-icon'),
    '【设计契约】画布状态抽屉已迁移到统一控件，禁止回退到手写 className')
  assert.ok(pkg59.scripts['verify:design'] && pkg59.scripts.prebuild && pkg59.scripts.verify,
    '【设计契约】verify:design 必须独立可跑，并挂到 prebuild 与 verify 总入口')
  assert.ok(!String(pkg59.scripts.verify).includes('&&'),
    '【设计契约】verify 总入口必须走 Node 顺序执行，Windows PowerShell 5.1 不支持 && 串联')
  assert.ok(guard59.includes('design-system-baseline.json') && guard59.includes('只允许减少'),
    '【设计契约】门禁必须采用「存量基线只减不增」策略，才能渐进收敛而不一次性改完')
  assert.ok(baseline59.uiFiles.length > 100,
    '【设计契约】存量基线必须登记在库，禁止删掉基线绕过门禁')
  assert.ok(doc59.includes('唯一真源') && doc59.includes('硬性禁止'),
    '【设计契约】规范文档必须随代码保留，后续开发者 / agent 才知道约束')
}

// ===== 60. 横向知识库 tab 与单条顶栏架构（2026-11-21）=====
// 核心约束：32px 顶栏是 flex-col 里唯一占文档流的兄弟。把它拆成两条横条，
// 画布净高就会永久少一档，且 #graph-panel 与 React Flow Panel 坐标全变。
// v2（同日）：修复「两个知识库也折叠成下拉」——宽度测量对象必须是稳定的
// tab zone 而非自适应宽度的 strip；tab 必须弹性压缩，压到最小宽度仍放不下才溢出。
{
  const readSrc60 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const app60 = await readSrc60('src/App.tsx')
  const tabs60 = await readSrc60('src/features/layout/TabBar/TabBar.tsx')
  const title60 = await readSrc60('src/features/layout/CustomTitleBar/CustomTitleBar.tsx')
  const tokens60 = await readSrc60('src/styles/tokens.css')
  const controls60 = await readSrc60('src/styles/controls.css')
  const contract60 = await readSrc60('src/shared/ui/controlStyles.ts')
  const gui60 = await readSrc60('scripts/verify-linked-documents-gui.mjs')

  assert.ok(app60.includes('<CustomTitleBar mode="workspace" />')
    && app60.includes('className="relative w-full flex-1 min-h-0 overflow-clip bg-[var(--color-surface)]"')
    && !app60.includes('shrink-0') && !app60.includes('<TabBar') && !app60.includes('TabStrip'),
    '【横向 tab】tab 栏必须活在 32px 标题栏内部；App.tsx 的 flex-col 里只能有一个顶栏 + 一个内容区')
  assert.ok(title60.includes('h-[var(--titlebar-height)]') && tokens60.includes('--titlebar-height: 32px'),
    '【横向 tab】顶栏高度必须由唯一 token 固定为 32px，禁止悄悄增高吃掉画布')
  assert.ok(title60.includes('data-tm-tab-zone') && title60.includes('data-tm-tab-drag-gutter')
    && tokens60.includes('--tab-drag-gutter: 88px') && !tokens60.includes('--tab-zone-max'),
    '【横向 tab】必须有稳定的 tab zone 测量基准与恒定拖拽安全带；禁止再用百分比硬限宽把两个 tab 挤进下拉')
  assert.ok(tabs60.includes("closest<HTMLElement>('[data-tm-tab-zone]')")
    && tabs60.includes('observer.observe(element)') && !tabs60.includes('observer.observe(stripRef'),
    '【横向 tab】宽度测量对象只能是中段 tab zone；测 .tm-tab-strip 自身会产生「越算越窄」的正反馈，导致两个 tab 也折叠')
  assert.ok(tabs60.includes('allAtMin <= available') && tabs60.includes('metrics.max')
    && tabs60.includes('--tab-current-width') && tabs60.includes('readTabMetrics')
    && tokens60.includes('--tab-min-width: 88px') && tokens60.includes('--tab-max-width: 180px'),
    '【横向 tab】必须 Chrome 式弹性压缩：min..max 之间按可用宽度均分，只有全压到 min 仍放不下才显示「⋯N」')
  assert.ok(tabs60.includes("tab.type === 'kb'") && !tabs60.includes('tabs.map('),
    '【横向 tab】系统页（首页/设置/学习记录/日志）不得出现在 tab 栏，只渲染 kb 类型')
  assert.ok(!tabs60.includes('aria-label="打开知识库"') && !tabs60.includes('Plus')
    && !tabs60.includes('nav.openLibrary') && !contract60.includes('tabAction:'),
    '【横向 tab】不得有「+」新建/打开按钮及其逻辑；打开知识库统一走首页知识库总览')
  assert.ok(tabs60.includes('role="tablist"') && tabs60.includes('role="tab"')
    && tabs60.includes('data-tm-tab-bar') && tabs60.includes('ResizeObserver')
    && tabs60.includes("WebkitAppRegion: 'no-drag'"),
    '【横向 tab】tab 栏必须语义化、可溢出折叠，且所有交互元素标为 no-drag（drag 区会吞点击）')
  assert.ok(tabs60.includes('Alt+') && tabs60.includes('Control+PageUp'),
    '【横向 tab】tab 快捷键不得抢占 Ctrl+Tab（右栏）与 Ctrl+1..9（左侧导航）')
  assert.ok(controls60.includes('.tm-tab--active::after') && controls60.includes('border-bottom: 0')
    && controls60.includes('box-shadow: none') && controls60.includes('--tab-active-bg')
    && controls60.includes("[data-tm-active-view='kb']") && controls60.includes('border-radius: var(--tab-radius-top)'),
    '【横向 tab】活跃 tab 必须是 Π 形连体（上圆下方、底边盖住 border-b、底色跟工作区一致），不得退回浮起卡片')
  assert.ok(controls60.includes('.tm-tab-label--fade') && controls60.includes('linear-gradient')
    && contract60.includes('tabStrip:') && contract60.includes('tabLabelFade:'),
    '【横向 tab】tab 视觉必须复用统一控件契约（渐隐截断等），不得另写一份样式')
  assert.ok(title60.includes('data-tm-active-view') && title60.includes('[role="tab"]')
    && title60.includes('data-tm-titlebar-unfocused'),
    '【横向 tab】顶栏要暴露当前视图类型供 Π 形连体换底色；双击最大化必须排除 tab，失焦要降对比')
  assert.ok(!title60.includes("'展开右侧面板'") && !title60.includes("'折叠右侧面板'")
    && !title60.includes('ariaLabel="右侧面板分区"')
    && title60.includes('data-tm-nav-rail-toggle') && title60.includes('data-tm-titlebar-widget')
    && title60.includes('nav className=') && title60.includes('aria-label="应用菜单"'),
    '【标题栏重构】右栏手动折叠 / 详情样式分段控件不得回灌；导航全局开关、汉堡菜单、学习计时 widget 必须在位')
  assert.ok(gui60.includes('阶段 AH') && gui60.includes('多个知识库横向并排不折叠')
    && gui60.includes('压到最小宽度仍放不下才出现'),
    '【横向 tab】必须有 GUI 运行时证据：多 tab 横向并排、弹性压缩、最小宽度后才溢出')
  assert.ok(tokens60.includes('顶栏底色必须比内容区深一档')
    && controls60.includes('--tab-active-bg') && gui60.includes('Π 形对比度')
    && gui60.includes('titlebarBg'),
    '【横向 tab】Π 形可辨识的前提是顶栏比工作区深一档；必须有静态约定 + GUI 实测，禁止把顶栏改回接近白色')
}

// ===== 61. 标题栏控制区重构（2026-11-21）=====
// 用户要求：删最左软件图标、保留汉堡、新增「全局导航栏显隐」唯一开关、
// 学习计时移到 tab 前、右栏删除手动折叠与详情/样式分段控件（改按需展开 + 失焦隐藏）、
// 样式设置迁入全局设置页。这一组锁住「唯一开关」与「不再有第二套显隐入口」。
{
  const readSrc61 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const store61 = await readSrc61('src/stores/layoutStore.ts')
  const rail61 = await readSrc61('src/features/layout/NavRail/NavRail.tsx')
  const title61 = await readSrc61('src/features/layout/CustomTitleBar/CustomTitleBar.tsx')
  const settings61 = await readSrc61('src/features/settings/SettingsPage.tsx')
  const shell61 = await readSrc61('src/features/right-panel/RightPanelShell.tsx')
  const container61 = await readSrc61('src/features/right-panel/RightPanelContainer.tsx')
  const docs61 = await readSrc61('src/features/right-panel/model/useDetailDocuments.ts')
  const edgeActions61 = await readSrc61('src/features/graph/GraphPage/model/useEdgeActions.ts')
  const graphCtx61 = await readSrc61('src/contexts/GraphContext.tsx')
  const graphStore61 = await readSrc61('src/stores/graphStore.tsx')
  const styleModel61 = await readSrc61('src/features/right-panel/model/useStyleSettingsModel.ts')
  const gui61 = await readSrc61('scripts/verify-linked-documents-gui.mjs')
  const containerGui61 = await readSrc61('scripts/verify-container-gui.mjs')

  assert.ok(store61.includes('railVisible: boolean') && store61.includes('toggleRailVisible')
    && !store61.includes('export type NavRailMode') && !store61.includes('railPeeking'),
    '【标题栏】导航显隐只有 railVisible 一个全局状态，三态 / peek 不得回灌')
  assert.ok(!rail61.includes('展开全局导航栏') && !rail61.includes('Control+B')
    && !rail61.includes('railPeeking') && rail61.includes('railVisible'),
    '【标题栏】NavRail 不得再自带边缘触发条 / 快捷键 / pin / 收起按钮等第二套显隐入口')
  assert.ok(!title61.includes('icon.svg') && title61.includes('data-tm-nav-rail-toggle')
    && title61.includes('aria-label="应用菜单"')
    && title61.indexOf('data-tm-titlebar-widget=""') < title61.indexOf('data-tm-tab-zone=""')
    && title61.includes('PluginWidgetSlot placement="titlebar"'),
    '【标题栏】最左软件图标必须移除；汉堡保留，全局开关与学习计时在 tab 区之前')
  assert.ok(!title61.includes('折叠右侧面板') && !title61.includes('展开右侧面板')
    && !title61.includes('右侧面板分区') && !title61.includes('SegmentedControl'),
    '【标题栏】右栏手动折叠按钮与详情/样式分段控件不得回灌')
  assert.ok(container61.includes('data-tm-right-panel-focus-auto-hide')
    && container61.includes("addEventListener('focusout'")
    && container61.includes('collapseIfFocusLost')
    && container61.includes('hadFocusRef'),
    '【右栏】失焦自动隐藏必须以「焦点确实从右栏内部移出」为条件，避免误伤 editor / portal')
  // focusout 的 relatedTarget 为 null 表示「没有明确新焦点」（编辑器 blur / 程序化失焦 /
  // 切出窗口），此时折叠会卸载编辑器并丢掉 debounce 里未落盘的正文 —— GUI 阶段 D
  // 曾因此从「编辑关联文档」起连锁失败 40+ 条。点画布空白收起由既有的
  // applyRightPanelAutoVisibility(false) 负责，不靠这条路径补位。
  assert.ok(container61.includes('event.relatedTarget === null')
    && container61.includes('active === document.body')
    && container61.includes('applyRightPanelAutoVisibility(false)'),
    '【右栏】失焦隐藏必须排除「无明确新焦点」的 blur，否则会卸载编辑器丢掉未落盘正文')
  assert.ok(docs61.includes('expandRightPanel()') && docs61.includes("setRightPanelTab('detail')"),
    '【右栏】无文档节点新建文档必须按需展开右栏，不能依赖手动按钮')
  assert.ok(settings61.includes('data-tm-settings-style') && settings61.includes('<StyleSection')
    && !settings61.includes('RAIL_MODES'),
    '【样式迁移】设置页必须承载 StyleSection，且不再出现导航三态控件')
  assert.ok(shell61.includes('data-tm-settings-style-entry') && !shell61.includes('StyleSection'),
    '【样式迁移】右栏样式分区只保留引导入口，不得再渲染第二份样式面板')
  assert.ok(graphCtx61.includes('useOptionalGraphContext')
    && styleModel61.includes('useOptionalGraphContext()')
    && !styleModel61.includes('useGraphContext()'),
    '【样式迁移】设置页不在 GraphContextProvider 内，样式 model 必须走 optional 上下文降级')
  // GraphStoreProvider 只挂在知识库标签页内部（App.tsx），设置页是独立的 secondary 视图。
  // 只降级 GraphContext 不够：model 里还有 4 处读画布选中态，直接 useGraphStore 会抛
  // Missing GraphStoreProvider 并被二级视图 ErrorBoundary 整页拦下（GUI 阶段 AI 曾连锁失败）。
  assert.ok(graphStore61.includes('useOptionalGraphStore')
    && graphStore61.includes('getDetachedGraphStore')
    && graphStore61.includes('useContext(GraphStoreContext)')
    && styleModel61.includes('useOptionalGraphStore(')
    && !styleModel61.includes('useGraphStore('),
    '【样式迁移】设置页不在 GraphStoreProvider 内，样式 model 必须用可选 store 读选中态；改回 useGraphStore 会整页崩溃')
  assert.ok(edgeActions61.includes('HOST_VIEW_IDS.settings')
    && edgeActions61.includes("setStylePanelTab('edges')"),
    '【样式迁移】画布右键「连线样式」必须跳到设置页的连线子分区')
  assert.ok(gui61.includes('阶段 AI') && gui61.includes('data-tm-nav-rail-toggle')
    && gui61.includes('12-titlebar-rail-hidden.png')
    && gui61.includes('Missing GraphStoreProvider') && gui61.includes('二级视图页面加载失败'),
    '【标题栏】必须有 GUI 运行时证据：全局开关在画布页生效、设置页无 ErrorBoundary 崩溃、截图')
  assert.ok(!containerGui61.includes('button[aria-label="折叠右侧面板"]')
    && containerGui61.includes("keyboard.press('Tab')"),
    '【右栏】容器 GUI 的折叠夹具也必须走 Ctrl+Tab，不得再点已删除的手动按钮')
}

// ===== 62) 统一表情选择器：中文词库 / 统一字形 / 防 emoji-mart 回灌 =====
{
  const read62 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const panel62 = await read62('src/shared/ui/emoji/EmojiPickerPanel.tsx')
  const glyph62 = await read62('src/shared/ui/emoji/EmojiGlyph.tsx')
  const dataModule62 = await read62('src/shared/ui/emoji/emojiData.ts')
  const data62 = JSON.parse(await read62('src/shared/ui/emoji/emojiData.zh.json'))
  const meta62 = JSON.parse(await read62('src/shared/ui/emoji/emojiMeta.json'))
  const card62 = await read62('src/features/graph/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx')
  const docPicker62 = await read62('src/features/documents/components/DocumentMetaPicker.tsx')
  const docNode62 = await read62('src/features/documents/components/DocumentNode.tsx')
  const breadcrumb62 = await read62('src/features/right-panel/components/DetailTab/DocumentBreadcrumb.tsx')
  const contextMenu62 = await read62('src/features/graph/GraphPage/components/GraphPageContextMenu.tsx')
  const pkg62 = JSON.parse(await read62('package.json'))
  const build62 = await read62('scripts/build-emoji-assets.mjs')
  const prepare62 = await read62('scripts/prepare-assets.mjs')
  const all62 = Object.values(data62.emojis).flat()

  assert.ok(panel62.includes("from 'emoji-picker-react'")
    && panel62.includes('EMOJI_DATA_ZH')
    && panel62.includes('suggestedEmojis')
    && panel62.includes('@floating-ui/react')
    && panel62.includes('data-tm-emoji-picker'),
    '【表情选择器】必须收敛为单一门面：成熟 picker 引擎 + 中文数据集 + floating-ui 定位')
  assert.ok(panel62.includes('EmojiGlyph') && glyph62.includes('emojiGlyphUrl')
    && dataModule62.includes('fluent-emoji-flat/')
    && glyph62.includes('Extended_Pictographic'),
    '【表情选择器】网格与展示都必须走统一 Fluent Emoji Flat 字形，非 emoji 文本保持原样')
  assert.ok(!panel62.includes('@emoji-mart') && !panel62.includes('em-emoji-picker')
    && !card62.includes('@emoji-mart') && !docPicker62.includes('@emoji-mart')
    && !contextMenu62.includes('em-emoji-picker')
    && contextMenu62.includes('[data-tm-emoji-picker]'),
    '【表情选择器】emoji-mart Web Component / Shadow DOM 及其白名单不得回灌')

  const grinning62 = all62.find((item) => item.u === '1f600')
  const thumb62 = all62.find((item) => item.u === '1f44d')
  assert.ok(grinning62?.n?.includes('笑脸') && grinning62?.n?.includes('xiaolian')
    && grinning62?.n?.includes('xl'),
    '【表情词库】中文名、全拼、首字母必须同时可搜（😀：笑脸 / xiaolian / xl）')
  assert.ok(thumb62?.n?.includes('点赞') && thumb62?.n?.includes('dianzan'),
    '【表情词库】国内语义别名必须可搜（👍：点赞 / dianzan），汉化不能丢英文能力')
  assert.ok(all62.some((item) => item.n.includes('book')),
    '【表情词库】必须保留英文关键词，避免相对旧版 emoji-mart 的搜索能力退化')
  assert.ok(data62.categories?.smileys_people?.name === '笑脸与人物'
    && Object.keys(data62.categories).length >= 9,
    '【表情词库】分类必须是简体中文且覆盖标准分类')
  assert.ok(meta62.popular.length >= 20 && Object.keys(meta62.assetMap).length > 3000,
    '【表情选择器】国内高频置顶与统一字形映射必须齐备')

  assert.ok(card62.includes('EmojiPickerPanel') && card62.includes('EmojiGlyph')
    && docPicker62.includes('EmojiPickerPanel')
    && docNode62.includes('EmojiGlyph') && breadcrumb62.includes('EmojiGlyph'),
    '【表情选择器】四个触发入口与三处显示位必须共用同一门面与字形组件')
  assert.ok(!pkg62.dependencies?.['@emoji-mart/react'] && !pkg62.dependencies?.['@emoji-mart/data']
    && pkg62.scripts.predev.includes('prepare-assets')
    && pkg62.scripts.prebuild.includes('prepare-assets')
    && !pkg62.scripts.prebuild.includes('&&')
    && prepare62.includes('build-emoji-assets.mjs')
    && prepare62.includes('sync-excalidraw-assets.mjs')
    && build62.includes('@lobehub/fluent-emoji-flat') && build62.includes('pinyin-pro'),
    '【表情选择器】直接依赖必须移除；词库与本地字形必须由跨平台 prepare-assets 在 predev / prebuild 生成')
}

// ===== 63) 智能参考线：吸附闭环 / 屏幕像素阈值 / 候选收敛 / 可控性 =====
{
  const read63 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const guides63 = await read63('src/features/graph/GraphCanvas/useSmartGuides.ts')
  const renderer63 = await read63('src/features/graph/GraphCanvas/SmartGuidesRenderer.tsx')
  const uiStore63 = await read63('src/stores/graphUiStore.ts')
  const settings63 = await read63('src/features/settings/SettingsPage.tsx')

  assert.ok(guides63.includes('lastSnapRef') && guides63.includes("c.dragging === false")
    && guides63.includes('snapped.x') && guides63.includes('snapped.y'),
    '【智能参考线】drag end 必须用吸附结果覆盖 XYDrag 派发的原始位置，否则松手即回弹、落盘未吸附坐标')
  assert.ok(guides63.includes("c.resizing === false") && !guides63.includes('!c.dragging'),
    '【智能参考线】结束帧必须严格 === false，不能把自动测量的 dimensions change 误判成拖动结束')
  assert.ok(guides63.includes('SNAP_ENTER_SCREEN_PX / zoom')
    && guides63.includes('SNAP_RELEASE_SCREEN_PX / zoom')
    && guides63.includes('getZoom'),
    '【智能参考线】阈值必须是屏幕像素除以 zoom，且带「进入 / 释放」迟滞，不能固定画布单位')
  assert.ok(guides63.includes('if (node.hidden) continue')
    && guides63.includes('getVisibleNodes') && guides63.includes('NEARBY_SCREEN_PX'),
    '【智能参考线】候选必须过滤 LOD 隐藏节点并收敛到可见 / 邻近范围，不得扫全图')
  assert.ok(guides63.includes('computeAxisSnap') && guides63.includes("kind: 'center'")
    && guides63.includes('dragRects.reduce') && !guides63.includes('Less chaotic snaps during move'),
    '【智能参考线】对齐必须区分中心 / 同侧边语义并按优先级打分，多选按整体包围盒吸附，不得回灌旧版贴边混合打分')
  assert.ok(guides63.includes('smartGuidesEnabled') && guides63.includes('altRef.current')
    && uiStore63.includes('smartGuidesEnabled: true')
    && settings63.includes('setSmartGuidesEnabled'),
    '【智能参考线】必须有全局开关、Alt 临时忽略吸附与设置页入口')
  assert.ok(renderer63.includes('guide.position * zoom')
    && renderer63.includes('var(--color-accent)') && !renderer63.includes('transformOrigin'),
    '【智能参考线】渲染层必须逐点换算屏幕坐标保持 1px 线宽，且颜色走设计 token')
}

// ===== 64) 选中文字工具条：点「复制」不得让右栏消失，剪贴板必须真的写入 =====
// BlockNote 格式化工具条 portal 到 body，根节点是 role="toolbar" 而非 role="menu"。
// 旧版右栏失焦白名单不认它，点复制时焦点从 contenteditable 移到 body 下的按钮，
// 被误判为「焦点移出右栏」→ 右栏折叠、工具条卸载、异步剪贴板写入被打断。
{
  const read64 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const container64 = await read64('src/features/right-panel/RightPanelContainer.tsx')
  const editor64 = await read64('src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx')
  const toolbar64 = await read64('src/features/documents/SmartDocumentEditor/components/SmartDocumentFormattingToolbar.tsx')

  assert.ok(container64.includes('RIGHT_PANEL_OVERLAY_SELECTOR')
    && container64.includes('[role="toolbar"]')
    && container64.includes('.bn-formatting-toolbar')
    && container64.includes('closest(RIGHT_PANEL_OVERLAY_SELECTOR)')
    && container64.includes('querySelector(RIGHT_PANEL_OVERLAY_SELECTOR)'),
    '【选中文字复制】右栏失焦白名单必须纳入 BlockNote 浮层（格式化工具条是 role=toolbar），且两处判定共用同一常量，否则点复制会把右栏误折叠')
  const fmtCtrl64 = editor64.slice(
    editor64.indexOf('<FormattingToolbarController'),
    editor64.indexOf('<SideMenuController'),
  )
  assert.ok(fmtCtrl64.includes('onMouseDownCapture')
    && fmtCtrl64.includes('input, textarea, [contenteditable="true"]')
    && fmtCtrl64.includes('event.preventDefault()'),
    '【选中文字复制】格式化工具条必须在浮层根拦下 mousedown 默认行为保住编辑器选区，但要放过 popover 输入框，否则改链接/颜色无法键盘输入')
  const copyBtn64 = toolbar64.slice(
    toolbar64.indexOf('function CopySelectionButton'),
    toolbar64.indexOf('function SelectionMathButton'),
  )
  assert.ok(toolbar64.includes('copyTextToClipboard')
    && toolbar64.includes("document.execCommand('copy')")
    && !copyBtn64.includes('editor.focus()'),
    '【选中文字复制】Clipboard API 被拒时必须退回同步写入，且不得在 await 后对可能已卸载的编辑器调 focus()')
  assert.ok(copyBtn64.includes('COPY_FEEDBACK_MS') && copyBtn64.includes('feedbackTimerRef')
    && toolbar64.includes('window.clearTimeout(feedbackTimerRef.current)'),
    '【选中文字复制】已复制/失败反馈必须自动复位并在卸载时清定时器，不能永久停在旧状态')
}

// ===== 65) 文档列表项 hover 快捷工具：添加子节点 / 编辑样式 / 删除 =====
// 三个动作必须复用既有命令链路（内联新建、带确认的删除、统一的 meta 写入），
// 且样式字段要有后端白名单校验，不能让任意 CSS 值写进 manifest。
// 工具显隐只跟随鼠标 hover，与选中态无关：既不能 isActive 常显，也不能用
// group-focus-within（点击行会把焦点留在行上，鼠标离开后按钮照样常显）。
{
  const read65 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const row65 = await read65('src/features/documents/components/DocumentNode.tsx')
  const sidebar65 = await read65('src/features/documents/DocumentSidebar.tsx')
  const model65 = await read65('src/features/documents/model/useDocumentSidebarModel.ts')
  const style65 = await read65('src/features/documents/components/DocumentStylePanel.tsx')
  const picker65 = await read65('src/features/documents/components/DocumentMetaPicker.tsx')
  const types65 = await read65('src/core/storage/types.ts')
  const backend65 = await read65('electron/file-service.js')
  const detail65 = await read65('src/features/right-panel/model/useDetailDocuments.ts')
  const linked65 = await read65('src/features/right-panel/components/DetailTab/LinkedDocumentList.tsx')

  const NO_RESERVED_SLOT = (src: string) =>
    src.includes('h-4 shrink-0 items-center gap-0.5')
    && src.includes('hidden group-hover:!flex')
    && !/isActive\s*\?\s*'flex'/.test(src)
    && !src.includes('group-focus-within:!flex')
    && !src.includes('opacity-0 group-hover:opacity-100')
  assert.ok(row65.includes('data-tm-document-quick-actions') && NO_RESERVED_SLOT(row65)
    && row65.includes('!sticky'),
    '【文档列表快捷工具】工具显隐只随鼠标 hover，与选中态/焦点态无关：不得 isActive 常显或 focus-within 常显；其余行默认 hidden 彻底脱离布局（不预留右侧宽度、标题用满整行），仅 hover 时作为 flex 子项插入并占空间；h-4 锁高避免整列行高跳动；sticky 路径提示行不提供操作')
  assert.ok(NO_RESERVED_SLOT(linked65),
    '【文档列表快捷工具】关联文档列表必须与文档树同一套「只随 hover 显隐」契约，不能退回选中常显或 opacity-0 常驻占位')
  assert.ok(row65.includes('title="添加子文档"') && row65.includes('title="编辑样式"')
    && row65.includes('title="删除"') && row65.includes('QUICK_ACTION_EVENTS')
    && row65.includes('onQuickCreate={onQuickCreate}'),
    '【文档列表快捷工具】三个动作齐全、事件必须与行的选中/双击/拖拽/右键隔离，并递归透传到子项')
  assert.ok(row65.includes('node.fontSize') && row65.includes('node.fontWeight')
    && row65.includes('node.fontStyle') && row65.includes('node.color'),
    '【文档列表快捷工具】统一样式面板写入的字体 / 颜色字段必须真正作用到列表标题')
  assert.ok(sidebar65.includes('onApplyPatch={handleApplyMetaPatch}')
    && model65.includes('handleQuickCreate') && model65.includes('openStylePanel')
    && model65.includes('handleQuickDelete') && model65.includes('handleApplyMetaPatch')
    && model65.includes("mode: 'createTopoDocument'") && model65.includes("mode: 'style'"),
    '【文档列表快捷工具】必须复用内联新建与带确认的删除，样式面板走统一 meta 写入链路')
  assert.ok(style65.includes('FONT_SIZE_PRESETS') && style65.includes('加粗')
    && style65.includes('斜体') && style65.includes('更换图标')
    && style65.includes('标题颜色') && style65.includes('恢复默认样式'),
    '【编辑样式面板】图标 / 颜色 / 字号 / 字重 / 斜体必须集中在同一面板，并提供恢复默认')
  assert.ok(picker65.includes("picker.mode === 'style'")
    && picker65.includes('data-tm-keep-right-panel')
    && picker65.includes("[data-tm-emoji-picker]")
    && picker65.includes('TM_UI.popover'),
    '【编辑样式面板】portal 到 body 的浮层须复用 tm-popover 统一视觉、标记保留右栏，且二级表情选择器不能误关闭主面板')
  assert.ok(style65.includes('TM_UI') && style65.includes('SegmentedControl')
    && style65.includes('PANEL_LIST.rowActive') && style65.includes('data-tm-document-style-panel')
    && style65.includes('<header') && style65.includes('<footer')
    && style65.includes('DOCUMENT_COLOR_INPUT_FALLBACK')
    && style65.includes('type="color"'),
    '【编辑样式面板】必须走项目统一控件契约（TM_UI / SegmentedControl / 真实列表行预览 / 原生取色器），采用头部-预览-扁平分区-固定底栏结构，色值字面量下沉到数据层')
  assert.ok(types65.includes('fontSize?: number') && types65.includes("fontWeight?: 'normal' | 'bold'")
    && types65.includes('fontSize?: number | null')
    && backend65.includes("hasOwnProperty.call(patch, 'fontSize')")
    && backend65.includes("hasOwnProperty.call(patch, 'fontWeight')")
    && backend65.includes("hasOwnProperty.call(patch, 'fontStyle')")
    && backend65.includes('delete found.item.fontSize'),
    '【编辑样式面板】新字段必须落在 manifest + patch 类型，并在主进程按白名单校验、非法值恢复默认')
  assert.ok(detail65.includes('fontSizeChanged') && detail65.includes('fontWeightChanged')
    && detail65.includes('fontStyleChanged'),
    '【编辑样式面板】变更检测必须覆盖字体字段，否则只改字号时会被误判为无变化而不写盘')
}

// ===== 66) 全局浮层动效统一契约 =====
// 旧状态：四套动效并存（tailwindcss-animate / floating-ui / Mantine / 手写 keyframes），
// 且面板位置在 useEffect 里二次设置 —— 动画首帧跑在上一次坐标上，绘制后才瞬移，
// 同一个窗口因此有时「从左侧飘出来」、有时原地淡入、有时干脆没有动画。
{
  const read66 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const motionCss66 = await read66('src/styles/motion.css')
  const motionTs66 = await read66('src/shared/ui/motion.ts')
  const main66 = await read66('src/main.tsx')
  const modal66 = await read66('src/shared/ui/modal.ts')
  const picker66 = await read66('src/features/documents/components/DocumentMetaPicker.tsx')
  const emoji66 = await read66('src/shared/ui/emoji/EmojiPickerPanel.tsx')
  const mantine66 = await read66('src/features/documents/SmartDocumentEditor/components/SmartBlockNoteMenu.tsx')
  const editorCss66 = await read66('src/features/documents/SmartDocumentEditor/SmartDocumentEditor.css')
  const rightPanel66 = await read66('src/features/right-panel/RightPanelContainer.tsx')

  assert.ok(motionCss66.includes('.tm-popover-anchor')
    && motionCss66.includes('.tm-popover-enter')
    && motionCss66.includes('.tm-popover-exit')
    && motionCss66.includes('.tm-fade-enter')
    && motionCss66.includes('.tm-modal-panel-enter')
    && motionCss66.includes('--tm-motion-duration')
    && motionCss66.includes('prefers-reduced-motion')
    && motionCss66.includes('.animate-in'),
    '【浮层动效统一】motion.css 必须提供定位层 / 入场 / 退出 / 纯淡入 / 模态框 / 时长变量，并含全局 reduced-motion 兜底')
  assert.ok(main66.includes("import './styles/motion.css'")
    && motionTs66.includes('durationMs') && motionTs66.includes('easing')
    && modal66.includes('TM_MOTION.modalOverlayEnter')
    && modal66.includes('TM_MOTION.modalPanelEnter'),
    '【浮层动效统一】契约须在入口引入，模态框必须引用同一契约，不能自己写 animate-in 组合')
  assert.ok(mantine66.includes('TM_MOTION.durationMs')
    && mantine66.includes('TM_MOTION.easing')
    && mantine66.includes('exitDelay: 0'),
    '【浮层动效统一】Mantine 子菜单 transitionProps 必须对齐统一时长 / 曲线，且保持 exitDelay 0 避免双重子菜单')
  assert.ok(!editorCss66.includes('@keyframes tm-image-align-toolbar-in')
    && !editorCss66.includes('@keyframes tm-image-preview-fade-in')
    && !editorCss66.includes('animation: tm-image'),
    '【浮层动效统一】编辑器不得再手写浮层 keyframes，一律走 motion.css')

  assert.ok(picker66.includes('function clampPickerPosition(')
    && picker66.includes('const position = clampPickerPosition(picker)')
    && !picker66.includes('setPickerPosition')
    && !/useEffect\([\s\S]{0,400}pickerPosition/.test(picker66),
    '【浮层首帧定位】样式 / 颜色面板坐标必须在渲染期同步钳制；禁止回退到 useEffect/setState 二次设置，否则动画首帧会落在上一次坐标并被瞬移')
  assert.ok(picker66.includes('className={TM_MOTION.anchor}')
    && picker66.includes('TM_MOTION.enter')
    && picker66.includes('data-tm-keep-right-panel'),
    '【浮层首帧定位】定位层与动画层必须分离，且保留右栏失焦白名单标记')
  assert.ok(rightPanel66.includes("'[data-tm-emoji-picker]'"),
    '【浮层首帧定位】表情面板分层后改挂 tm-popover-anchor 外壳，data 标记必须同时在右栏失焦白名单内，否则点开图标设置会折叠右栏')
  assert.ok(emoji66.includes('floatingStyles')
    && emoji66.includes('isPositioned')
    && emoji66.includes('visibility: isPositioned')
    && emoji66.includes('className={TM_MOTION.anchor}')
    && emoji66.includes('TM_MOTION.enter'),
    '【浮层首帧定位】表情面板的 floating-ui transform 定位层不得承载动画；内层须等 isPositioned 后再播入场，避免从 (0,0) 左上角滑入')

  const { readdir } = await import('node:fs/promises')
  const srcDir66 = new URL('../src/', import.meta.url)
  const all66 = (await readdir(srcDir66, { recursive: true }))
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.(tsx|ts|css)$/.test(f))
  const legacy66 = []
  for (const rel66 of all66) {
    // 契约文件自身在注释 / reduced-motion 兜底里会提到这些旧类名，属于预期。
    if (rel66 === 'styles/motion.css' || rel66 === 'shared/ui/motion.ts') continue
    const text66 = await readFile(new URL(rel66, srcDir66), 'utf-8')
    if (/animate-in\b|animate-out\b|slide-in-from-|zoom-in-\d+|fade-in /.test(text66)) {
      legacy66.push(rel66)
    }
  }
  assert.deepEqual(legacy66, [],
    `【浮层动效统一】禁止再出现 tailwindcss-animate 组合类（方向/时长/origin 会重新散落）：${legacy66.join(', ')}`)

  const popoverFiles66 = [
    'src/features/documents/components/DocumentMetaPicker.tsx',
    'src/shared/ui/emoji/EmojiPickerPanel.tsx',
    'src/features/documents/components/DocumentContextMenu.tsx',
    'src/features/graph/GraphPage/components/GraphPageContextMenu.tsx',
    'src/features/graph/GraphCanvas/nodes/KnowledgeCard/QuickNodeToolbar.tsx',
    'src/features/right-panel/RightPanelContainer.tsx',
    'src/features/right-panel/components/DetailTab/LinkedDocumentList.tsx',
    'src/features/documents/components/DocumentNode.tsx',
    'src/plugins/builtin/learning-statistics/LearningTrackerWidget.tsx',
    'src/features/documents/SmartDocumentEditor/components/EditorStylePopover.tsx',
    'src/features/documents/SmartDocumentEditor/components/DocumentLinkPicker.tsx',
    'src/features/documents/SmartDocumentEditor/components/ImageAlignToolbar.tsx',
    'src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx',
    'src/features/graph/GraphCanvas/components/EdgeRelationPicker.tsx',
    'src/features/graph/GraphCanvas/edges/QuickEdgeStylePopover.tsx',
    'src/features/documents/components/Layout/AttachmentsTab.tsx',
  ]
  const missing66 = []
  for (const file66 of popoverFiles66) {
    const text66 = await read66(file66)
    if (!/tm-popover-enter|tm-fade-enter|TM_MOTION\.enter|TM_MOTION\.fadeEnter/.test(text66)) {
      missing66.push(file66)
    }
  }
  assert.deepEqual(missing66, [],
    `【浮层动效统一】所有浮层都必须显式套用统一入场契约：${missing66.join(', ')}`)
}

// ===== 67) 全局浮层「一进一出」淡入淡出契约 =====
// 旧状态：只有入场动画，关闭时 React 直接 removeChild，弹窗 / 浮窗「啪」地消失；
// 且一批浮层（标题栏菜单、链接菜单、Toast、画布提示条、全屏编辑器等）连入场也没有。
{
  const read67 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const motionCss67 = await read67('src/styles/motion.css')
  const motionTs67 = await read67('src/shared/ui/motion.ts')
  const presence67 = await read67('src/shared/ui/overlayPresence.ts')
  const main67 = await read67('src/main.tsx')

  const enterBlock67 = motionCss67.slice(
    motionCss67.indexOf('@keyframes tm-popover-enter'),
    motionCss67.indexOf('@keyframes tm-popover-exit'),
  )
  const exitBlock67 = motionCss67.slice(
    motionCss67.indexOf('@keyframes tm-popover-exit'),
    motionCss67.indexOf('@keyframes tm-fade-enter'),
  )
  assert.ok(exitBlock67.includes('opacity: 1') && exitBlock67.includes('opacity: 0')
    && !exitBlock67.includes('transform'),
    '【浮层渐隐渐出】退出关键帧只能改 opacity：floating-ui transform / -translate-x-1/2 定位的浮层会被带 transform 的动画瞬移到左上角')
  assert.ok(enterBlock67.includes('opacity: 0') && !enterBlock67.includes('scale('),
    '【浮层渐隐渐出】入场以淡入为主、位移不超过 3px，禁止缩放弹跳')
  assert.ok(motionCss67.includes('--tm-motion-duration: 160ms')
    && motionCss67.includes('--tm-motion-exit-duration: 130ms')
    && motionCss67.includes('[data-tm-exiting]')
    && /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.tm-popover-exit/.test(motionCss67),
    '【浮层渐隐渐出】入场 / 退场时长、幽灵节点样式与 reduced-motion 兜底必须齐全')
  assert.ok(motionTs67.includes('exitDurationMs: 130')
    && motionTs67.includes('overlayAttribute')
    && motionTs67.includes('exitingAttribute')
    && motionTs67.includes('enterClassNames'),
    '【浮层渐隐渐出】TS 契约必须暴露退出时长与三个生命周期标记')

  assert.ok(presence67.includes('new MutationObserver(')
    && presence67.includes('insertBefore(')
    && presence67.includes("setAttribute('inert'")
    && presence67.includes('prefers-reduced-motion')
    && presence67.includes('TM_MOTION.exit')
    && presence67.includes('classList.remove(...TM_MOTION.enterClassNames)')
    && presence67.includes('TM_MOTION.exitDurationMs + 80')
    && presence67.includes('event.target !== node')
    && presence67.includes('isOverlayRoot'),
    '【浮层渐隐渐出】退出代理必须插回原位、标 inert、剥入场类、纯淡出并有超时兜底，避免幽灵节点永久残留')
  assert.ok(main67.includes('installOverlayExitTransition()'),
    '【浮层渐隐渐出】退出代理必须在入口早于 React 渲染安装')

  // 全部自绘弹窗 / 浮窗：显式入场契约 = 自动获得全局渐出（同一批类名被代理识别）。
  const overlayFiles67 = [
    'src/shared/ui/ConfirmModal/ConfirmModal.tsx',
    'src/shared/ui/PromptModal/PromptModal.tsx',
    'src/features/kb/components/TrashDialog.tsx',
    'src/features/kb/components/ImportKBDialog.tsx',
    'src/features/kb/components/CreateKBDialog.tsx',
    'src/features/kb/components/KBSettingsDialog/KBSettingsDialog.tsx',
    'src/features/documents/components/DocumentMoveToNodeDialog.tsx',
    'src/features/graph/GraphPage/components/NodeMoveToRoomDialog.tsx',
    'src/features/graph/components/LinkDocumentDialog.tsx',
    'src/features/documents/components/DocumentMetaPicker.tsx',
    'src/shared/ui/emoji/EmojiPickerPanel.tsx',
    'src/features/documents/components/DocumentContextMenu.tsx',
    'src/features/graph/GraphPage/components/GraphPageContextMenu.tsx',
    'src/features/graph/GraphCanvas/nodes/KnowledgeCard/QuickNodeToolbar.tsx',
    'src/features/right-panel/RightPanelContainer.tsx',
    'src/features/right-panel/components/DetailTab/LinkedDocumentList.tsx',
    'src/features/documents/components/DocumentNode.tsx',
    'src/plugins/builtin/learning-statistics/LearningTrackerWidget.tsx',
    'src/features/documents/SmartDocumentEditor/components/EditorStylePopover.tsx',
    'src/features/documents/SmartDocumentEditor/components/DocumentLinkPicker.tsx',
    'src/features/documents/SmartDocumentEditor/components/ImageAlignToolbar.tsx',
    'src/features/documents/SmartDocumentEditor/SmartDocumentEditor.tsx',
    'src/features/graph/GraphCanvas/components/EdgeRelationPicker.tsx',
    'src/features/graph/GraphCanvas/edges/QuickEdgeStylePopover.tsx',
    'src/features/documents/components/Layout/AttachmentsTab.tsx',
    'src/shared/ui/Toaster/Toaster.tsx',
    'src/features/layout/CustomTitleBar/CustomTitleBar.tsx',
    'src/features/layout/TabBar/TabBar.tsx',
    'src/features/graph/GraphCanvas/components/NodeSearchBox.tsx',
    'src/features/graph/GraphCanvas/components/SelectionMirrorMenu.tsx',
    'src/features/graph/GraphCanvas/GraphCanvas.tsx',
    'src/features/graph/GraphCanvas/edges/QuickEdgeToolbar.tsx',
    'src/features/graph/GraphCanvas/edges/EdgeToolbarAnchor.tsx',
    'src/features/graph/GraphCanvas/containers/ContainerFullscreenEditorHost.tsx',
    'src/features/right-panel/components/DetailTab/DocumentBreadcrumb.tsx',
    'src/features/kb/HomePage.tsx',
  ]
  const missing67 = []
  for (const file67 of overlayFiles67) {
    const text67 = await read67(file67)
    if (!/tm-popover-enter|tm-fade-enter|tm-popover-anchor|TM_MOTION\.enter|TM_MOTION\.fadeEnter|TM_MOTION\.anchor|modalOverlayEnterClassName/.test(text67)) {
      missing67.push(file67)
    }
  }
  assert.deepEqual(missing67, [],
    `【浮层渐隐渐出】所有弹窗 / 浮窗都必须套用统一入场契约（退出代理据此自动接管）：${missing67.join(', ')}`)

  // 淡出中的幽灵节点不能再被当成「浮层仍打开」，否则会吞掉下一次 Esc / 外部点击 / 右栏折叠。
  const activeGuards67 = [
    ['src/features/right-panel/RightPanelContainer.tsx', 'RIGHT_PANEL_OVERLAY_SELECTOR'],
    ['src/features/right-panel/RightPanelContainer.tsx', ':not([data-tm-exiting])'],
    ['src/features/documents/components/DocumentMetaPicker.tsx', '[data-tm-emoji-picker]:not([data-tm-exiting])'],
    ['src/features/graph/GraphPage/components/GraphPageContextMenu.tsx', '[data-tm-emoji-picker]:not([data-tm-exiting])'],
    ['src/shared/ui/emoji/EmojiPickerPanel.tsx', '[data-context-menu-item]:not([data-tm-exiting])'],
  ]
  for (const [file67, needle67] of activeGuards67) {
    assert.ok((await read67(file67)).includes(needle67),
      `【浮层渐隐渐出】${file67} 必须排除淡出中的幽灵节点（${needle67}）`)
  }

  // 行内 hover 工具不是浮层，必须显式退出代理，否则移开鼠标后按钮会残留 130ms。
  for (const file67 of [
    'src/features/documents/components/DocumentNode.tsx',
    'src/features/right-panel/components/DetailTab/LinkedDocumentList.tsx',
  ]) {
    assert.ok((await read67(file67)).includes('data-tm-overlay="none"'),
      `【浮层渐隐渐出】${file67} 的行内工具必须标记 data-tm-overlay="none"`)
  }
}

{
  // 【P5】CardSpec 知识卡片容器：IPC / 路径越界 / 渲染约束 / 装配接线回归红线。
  const readP5 = (rel: string) => readFile(new URL(rel, import.meta.url), 'utf-8')
  const [
    preloadP5, mainP5, fsP5, fsbP5, storeP5, typesP5, fileAdapterP5,
    registryP5, cardTypeP5, cardNodeP5, componentP5, previewP5, menuP5,
  ] = await Promise.all([
    readP5('../electron/preload.js'),
    readP5('../electron/main.js'),
    readP5('../electron/file-service.js'),
    readP5('../src/core/fs-backend.ts'),
    readP5('../src/core/storage/service.ts'),
    readP5('../src/core/storage/types.ts'),
    readP5('../src/core/storage/file.ts'),
    readP5('../src/features/graph/GraphCanvas/containers/registerContainers.tsx'),
    readP5('../src/features/graph/GraphCanvas/containers/cardSpecContainerType.ts'),
    readP5('../src/features/graph/GraphCanvas/nodes/ContainerCard/ContainerCard.tsx'),
    readP5('../src/features/graph/GraphCanvas/containers/cardspec/CardComponentView.tsx'),
    readP5('../src/features/graph/GraphCanvas/containers/cardspec/CardSpecPreview.tsx'),
    readP5('../src/features/graph/GraphPage/components/GraphPageContextMenu.tsx'),
  ])

  for (const channel of ['fs:resolveCardAssetUrl', 'fs:importCardAsset']) {
    assert.ok(preloadP5.includes(`'${channel}'`), `【P5】${channel} 必须在 preload IPC 白名单里`)
    assert.ok(mainP5.includes(`ipcMain.handle('${channel}'`), `【P5】${channel} 必须注册主进程 handler`)
    assert.ok(fsbP5.includes(`'${channel}'`), `【P5】${channel} 必须由 fs-backend 发出`)
    assert.ok(fileAdapterP5.includes(`FSB.${channel.replace('fs:', '')}(requireRootDir()`),
      `【P5】${channel} 的 file backend 必须注入 rootDir`)
  }
  assert.ok(storeP5.includes('backend.resolveCardAssetUrl(') && storeP5.includes('backend.importCardAsset('),
    '【P5】store 层必须透传媒体资源调用')
  assert.ok(typesP5.includes('resolveCardAssetUrl:') && typesP5.includes('importCardAsset:'),
    '【P5】StorageBackend 契约必须声明媒体资源方法')
  assert.ok(fsP5.includes('realpathSync') && fsP5.includes("from './services/card-asset-path.js'"),
    '【P5】资源解析必须共用纯路径规则并做 realpath 防符号链接逃逸')
  assert.ok(registryP5.includes('CARDSPEC_CONTAINER_TYPE') && registryP5.includes('CardSpecPreview')
    && registryP5.includes('CardSpecEditor') && registryP5.includes('./cardSpecContainerType'),
  '【P5】卡容器必须同时注册领域 spec、只读预览与 lazy 编辑器')
  assert.ok(cardTypeP5.includes('registerContainerType(CARDSPEC_CONTAINER_SPEC)')
    && cardTypeP5.includes("documentType: 'cardspec'"),
  '【P5】领域 spec 必须指向 cardspec 文档类型')
  assert.ok(cardNodeP5.includes('cardPath={cardPath}'),
    '【P5】节点外壳必须把 cardPath 传给预览，否则媒体资源无法解析')
  assert.ok(menuP5.includes('新建知识卡片容器'),
    '【P5】右键菜单必须提供知识卡片容器创建入口')
  assert.ok(componentP5.includes('preload="metadata"') && componentP5.includes('HTML 组件（默认关闭）')
    && componentP5.includes('whitespace-pre-wrap') && !componentP5.includes('dangerouslySetInnerHTML'),
  '【P5】媒体禁止自动播放、HTML 组件永不渲染、文本纯渲染无注入面')
  assert.ok(previewP5.includes('visible') && previewP5.includes('normalizeCardSpecContent'),
    '【P5】节点内预览必须受 LOD 闸门并再次校验载荷')

  // 路径规则真跑：主进程与门禁共用同一份纯函数，越界输入一律抛错。
  const assetPath = await import(new URL('../electron/services/card-asset-path.js', import.meta.url).href)
  assert.equal(assetPath.normalizeCardAssetRelPath('assets/a.png'), 'assets/a.png',
    '【P5】合法资源相对路径必须放行')
  for (const bad of [
    '../secret.png', 'assets/../secret.png', '/abs/secret.png', 'C:/secret.png',
    'http://x/a.png', 'data:image/png;base64,AAA', 'assets/sub/a.png', 'assets\\a.png', '',
  ]) {
    assert.throws(() => assetPath.normalizeCardAssetRelPath(bad), undefined,
      `【P5】非法资源路径必须拒绝: ${bad || '(空)'}`)
  }
  assert.equal(assetPath.cardAssetCategory('a.mp3'), 'audio', '【P5】音频扩展名必须命中规则')
  assert.equal(assetPath.cardAssetCategory('a.exe'), null, '【P5】未知扩展名必须拒绝导入')
}

// ===== 第 60 组：2026-11-23 真实日志排查（埋点口径 / 日志体积 / 长任务归因） =====
{
  const read60 = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf-8')
  const files60 = {
    edgeOps: '../src/hooks/useGraph/edgeOperations.ts',
    perfLog: '../src/core/performance-log.ts',
    runtime: '../src/core/performance-runtime.ts',
    suspension: '../src/shared/observability/performanceSuspension.ts',
    context: '../src/shared/observability/performanceContext.ts',
    metrics: '../src/shared/observability/performanceMetrics.ts',
    logContract: '../src/shared/observability/logContract.ts',
    kbModel: '../src/features/kb/model/useHomeKnowledgeBases.ts',
    kbGrid: '../src/features/kb/components/KnowledgeBaseGrid.tsx',
  } as const
  const entries60 = Object.entries(files60) as Array<[keyof typeof files60, string]>
  const sources60 = Object.fromEntries(
    await Promise.all(entries60.map(async ([key, relative]) => [key, await read60(relative)] as const)),
  ) as Record<keyof typeof files60, string>
  const has60 = (key: keyof typeof files60, needle: string) => sources60[key].includes(needle)

  // 1) edge_create：span 只能覆盖到「边写入图状态」，不得包住 SaveCoordinator 的
  //    300ms debounce（实测 312 条样本 100% 判慢、P50 318ms，与节点规模无关）。
  const create60 = sources60.edgeOps.slice(
    sources60.edgeOps.indexOf('const addEdge'),
    sources60.edgeOps.indexOf('const deleteEdge'),
  )
  const perfEnd60 = create60.indexOf('perfSpan.end(')
  const saveLater60 = create60.indexOf('await saveLater(')
  assert.ok(perfEnd60 > 0 && saveLater60 > 0 && perfEnd60 < saveLater60,
    '【P0】edge_create 的 span 必须在 await saveLater 之前结束，固定 debounce 不得算进交互耗时')
  assert.ok(create60.indexOf('store.setEdges(') < perfEnd60,
    '【P0】span 必须在边写入图状态之后才结束')
  const delete60 = sources60.edgeOps.slice(sources60.edgeOps.indexOf('const deleteEdge'))
  assert.ok(delete60.indexOf('perfSpan.end()') < delete60.indexOf('await saveLater('),
    '【P0】deleteEdge 的正确顺序不得被回退')

  // 2) 挂起 / 休眠过滤：三条计时路径都收敛到统一上报层，判定必须早于采样与归因。
  for (const needle of ['isSuspensionSample(', 'getHiddenIntervals(', 'buildSuspendedSampleParams(']) {
    assert.ok(has60('perfLog', needle), `【P0】上报层未接入挂起过滤 ${needle}`)
  }
  assert.ok(sources60.perfLog.indexOf('isSuspensionSample(') < sources60.perfLog.indexOf('if (!shouldReport('),
    '【P0】挂起判定必须早于采样，否则假慢样本仍会进入阈值统计')
  assert.ok(has60('metrics', 'params.suspended'),
    '【P0】统计反解必须二次过滤 suspended 样本')
  // 批量 IO（导入大知识库等）墙钟耗时可达数十分钟，且后台运行是正常场景，
  // 必须豁免交互类的可信上限与隐藏窗口，否则会丢掉真实的长任务数据。
  assert.ok(has60('perfLog', 'BULK_IO_METRICS') && has60('perfLog', 'isInvalidDuration(')
    && has60('perfLog', 'PERFORMANCE_METRICS.kbImport')
    && has60('perfLog', 'PERFORMANCE_METRICS.documentExport')
    && has60('perfLog', 'PERFORMANCE_METRICS.attachmentUpload'),
  '【P0】批量 IO 指标必须豁免挂起过滤')
  assert.ok(has60('runtime', 'startSuspensionObserver(')
    && has60('runtime', 'getRecentPerformanceContext(entry.startTime)'),
  '【P0】运行时必须启动挂起观察器并用长任务 startTime 反查归因')

  // 3) 长任务归因：单值 + ≥50ms 门槛的实现必须被列表 + 时间窗口判定取代。
  for (const needle of ['resolveRecentContext(', 'countExpiredOperations(', 'rememberOperation(']) {
    assert.ok(has60('perfLog', needle), `【P0】上报层未接入列表化归因 ${needle}`)
  }
  assert.ok(!has60('perfLog', 'RECENT_CONTEXT_MIN_MS') && !has60('perfLog', 'let recentOperation:'),
    '【P0】旧的单值 + 50ms 门槛归因实现必须移除')

  // 4) 日志体积：kbInfo 不得再携带封面 base64，契约层要有框架级兜底。
  assert.ok(has60('kbModel', 'export function toKBLogInfo') && has60('kbModel', 'coverBytes'),
    '【P0】开库日志必须改用轻量摘要')
  assert.ok(!has60('kbModel', '{ kbInfo: kb }') && !has60('kbGrid', '{ kbInfo: kb }'),
    '【P0】不得再把含 8MB 封面的 KBItem 直接写进日志 params')
  assert.equal((sources60.kbGrid.match(/toKBLogInfo\(kb\)/g) ?? []).length, 2,
    '【P0】点击与键盘打开两条入口都必须走摘要')
  assert.ok(has60('logContract', "value.startsWith('data:')") && has60('logContract', '[data-uri:'),
    '【P0】日志契约层必须兜底拦截 data: URI，防止其它路径回灌')

  // 5) esbuild 真跑：三个纯函数模块逐个验证边界行为。
  const { build: build60 } = await import('esbuild')
  const { fileURLToPath: toPath60 } = await import('node:url')
  const loadBundled60 = async (relative: string) => {
    const result = await build60({
      entryPoints: [toPath60(new URL(relative, import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  }

  const susp60 = await loadBundled60(files60.suspension)
  assert.equal(susp60.MAX_TRUSTED_SAMPLE_MS, 300000)
  assert.equal(susp60.isSuspensionSample(250, 100_000, []), false,
    '【P0】正常样本不得被挂起过滤误杀')
  assert.equal(susp60.isSuspensionSample(602842, 700_000, []), true,
    '【P0】10 分钟级 app_startup 伪样本必须丢弃')
  assert.equal(susp60.isSuspensionSample(1_014_915, 1_200_000, []), true,
    '【P0】17 分钟级 node_select 伪样本必须丢弃')
  assert.equal(susp60.isSuspensionSample(Number.NaN, 1000, []), true,
    '【P0】非有限耗时必须丢弃')
  assert.equal(susp60.isSuspensionSample(-1, 1000, []), true,
    '【P0】负耗时必须丢弃')
  assert.equal(susp60.isInvalidDuration(Number.NaN), true,
    '【P0】批量 IO 的非有限耗时仍必须拦截')
  assert.equal(susp60.isInvalidDuration(900_000), false,
    '【P0】15 分钟的真实导入耗时必须保留，不得被交互上限误杀')
  assert.equal(susp60.hiddenOverlapMs(100, 300, [{ start: 200, end: 250 }]), 50,
    '【P0】隐藏区间重叠时长必须精确')
  assert.equal(susp60.isSuspensionSample(200, 300, [{ start: 200, end: 250 }]), true,
    '【P0】样本窗口与隐藏区间重叠必须判为挂起')
  assert.equal(susp60.isSuspensionSample(200, 300, [{ start: 0, end: 50 }]), false,
    '【P0】无关的旧隐藏区间不得误杀正常样本')
  assert.equal(susp60.isSuspensionSample(200, 300, [{ start: 250, end: null }]), true,
    '【P0】当前仍处于隐藏态必须判为挂起')
  const dropped60 = susp60.buildSuspendedSampleParams('node_select', 602842, 'sess', 'DetailPanel')
  assert.equal(dropped60.suspended, true)
  assert.equal(dropped60.rawDurationMs, 602842)
  assert.equal('durationMs' in dropped60, false,
    '【P0】丢弃记录不得写 durationMs，否则统计侧仍会当真实样本')

  const ctx60 = await loadBundled60(files60.context)
  const ops60 = [
    { metric: 'graph_meta_build', contextKey: 'roomA', at: 1000, durationMs: 1 },
    { metric: 'drag', contextKey: 'roomA', at: 1500, durationMs: 400 },
  ]
  assert.equal(ctx60.resolveRecentContext(1200, ops60)?.metric, 'drag',
    '【P0】长任务发生在操作执行期间（样本尚未上报）也必须能归到该操作')
  assert.equal(ctx60.resolveRecentContext(1600, ops60)?.metric, 'drag',
    '【P0】长任务紧随操作结束时应归到分量最大的操作，而非 1ms 噪音指标')
  assert.equal(ctx60.resolveRecentContext(1200, [ops60[0]])?.metric, 'graph_meta_build',
    '【P0】窗口内只有短操作时归因也不能落空')
  assert.equal(ctx60.resolveRecentContext(100, ops60), null,
    '【P0】远早于任何操作的长任务不得强行归因')
  assert.equal(ctx60.countExpiredOperations(ops60, 1600), 0,
    '【P0】窗口内的归因项不得被过早清理')
  assert.equal(ctx60.countExpiredOperations(ops60, 10000), 2,
    '【P0】过期归因项必须可清理，避免数组无限增长')

  const contract60 = await loadBundled60(files60.logContract)
  const huge60 = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`
  const redacted60 = contract60.redactParams({ kbInfo: { name: 'kbA', coverUrl: huge60 } }) as {
    truncated?: boolean
    kbInfo: { coverUrl: string }
  }
  assert.equal(redacted60.truncated, undefined,
    '【P0】data URI 摘要后不得再触发整体 params 截断')
  assert.ok(JSON.stringify(redacted60).length < 500,
    '【P0】单条日志不得因封面图膨胀到 MB 级')
  assert.ok(redacted60.kbInfo.coverUrl.includes('length:'),
    '【P0】摘要必须保留长度信息以便诊断')

  // 6) 集成真跑：mock 掉 logger，验证统一上报层三条分支确实按预期落日志，
  //    而不只是「代码里出现了某个函数名」。
  const sink60: Array<{ action?: string; params?: Record<string, unknown> }> = []
  ;(globalThis as Record<string, unknown>).__perfLogSink = sink60
  const perfBundle60 = await build60({
    entryPoints: [toPath60(new URL(files60.perfLog, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [{
      name: 'mock-logger',
      setup(build) {
        build.onResolve({ filter: /^\.\/logger\.ts$/ }, () => ({ path: 'mock-logger', namespace: 'perf-mock' }))
        build.onLoad({ filter: /.*/, namespace: 'perf-mock' }, () => ({
          contents: 'const sink = (globalThis.__perfLogSink ??= []);'
            + 'export function writeEntry(entry) { sink.push(entry); return Promise.resolve(true) }',
          loader: 'js',
        }))
      },
    }],
  })
  const perfMod60 = await import(
    `data:text/javascript;base64,${Buffer.from(perfBundle60.outputFiles[0].text).toString('base64')}`
  )
  perfMod60.recordPerformance('node_select', 250, { module: 'DetailPanel', params: { nodeId: 'n1' } })
  perfMod60.recordPerformance('node_select', 602842, { module: 'DetailPanel' })
  perfMod60.recordPerformance('kb_import', 900000, { module: 'HomePage' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sink60.length, 3, '【P0】三条样本都必须走统一写入口')
  assert.equal(sink60[0].params?.durationMs, 250,
    '【P0】正常交互样本必须照常上报真实耗时')
  assert.equal(sink60[1].params?.suspended, true,
    '【P0】挂起样本必须标记 suspended')
  assert.equal('durationMs' in (sink60[1].params ?? {}), false,
    '【P0】挂起样本不得写 durationMs')
  assert.equal(sink60[2].params?.durationMs, 900000,
    '【P0】15 分钟真实导入耗时必须保留')
  assert.equal(sink60[2].params?.suspended, undefined,
    '【P0】批量 IO 不得被标记为挂起')
  delete (globalThis as Record<string, unknown>).__perfLogSink

  // 7) 统计反解真跑：挂起日志无论有没有残留 durationMs，都不得进入看板样本。
  const metrics60 = await loadBundled60(files60.metrics)
  const samples60 = metrics60.extractPerformanceSamples([
    { id: 'ok', timestamp: new Date(0).toISOString(), action: '性能:记录',
      params: { metric: 'node_select', durationMs: 250, success: true } },
    { id: 'suspended-with-duration', timestamp: new Date(1).toISOString(), action: '性能:记录',
      params: { metric: 'node_select', durationMs: 602842, suspended: true, success: true } },
    { id: 'suspended-no-duration', timestamp: new Date(2).toISOString(), action: '性能:记录',
      params: { metric: 'node_select', suspended: true, success: true } },
  ])
  assert.equal(samples60.length, 1,
    '【P0】suspended 样本必须在反解层被彻底过滤')
  assert.equal(samples60[0].durationMs, 250,
    '【P0】正常样本的耗时不得被挂起过滤连带影响')
}

// ===== 68) 应用全局主题色：单一真源 / 派生色阶 / 明暗一致 / 持久化 =====
// 旧状态：primary / hover / soft / selected / highlight / titlebar-active 在 tokens.css
// 的三套主题块里各写死一份字面值，彼此不是派生关系，只改 --color-accent 必然「花」。
// 新状态：一个用户色 → domain/theme 调和派生 --tm-brand-* → 语义 token 统一引用。
{
  const read68 = async (p: string) => readFile(new URL('../' + p, import.meta.url), 'utf-8')
  const { readdir } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { join } = await import('node:path')
  const tokens68 = await read68('src/styles/tokens.css')
  const store68 = await read68('src/stores/themeStore.ts')
  const apply68 = await read68('src/domain/theme/applyAccentColor.ts')
  const settings68 = await read68('src/features/settings/SettingsPage.tsx')
  const main68 = await read68('src/main.tsx')

  // 1) 八个语义 token 在 :root / dark / github-light 三套主题块里都必须绑定到同名
  //    运行时变量；组件侧只允许引用 --color-*，禁止直接抓 --tm-brand-*。
  const bindings68: ReadonlyArray<readonly [string, string]> = [
    ['--color-primary', '--tm-brand-primary'],
    ['--color-primary-hover', '--tm-brand-primary-hover'],
    ['--color-accent', '--tm-brand-accent'],
    ['--color-accent-hover', '--tm-brand-accent-hover'],
    ['--color-accent-soft', '--tm-brand-soft'],
    ['--color-selected-bg', '--tm-brand-selected'],
    ['--color-hover-highlight', '--tm-brand-highlight'],
    ['--titlebar-active', '--tm-brand-titlebar-active'],
  ]
  assert.equal(ACCENT_TOKEN_NAMES.length, bindings68.length,
    '【主题色】派生色阶契约必须是 8 个变量，增删要同时改 tokens.css 与注入层')
  for (const [semantic68, runtime68] of bindings68) {
    assert.ok((ACCENT_TOKEN_NAMES as readonly string[]).includes(runtime68),
      `【主题色】${runtime68} 必须登记在 ACCENT_TOKEN_NAMES，否则切换主题色时不会被注入 / 清理`)
    assert.equal(
      (tokens68.match(new RegExp(`${semantic68}:\\s*var\\(${runtime68},`, 'g')) ?? []).length, 3,
      `【主题色】${semantic68} 必须在三套主题块统一引用 ${runtime68}，不得再写死自己的一份色值`)
  }
  const srcRoot68 = fileURLToPath(new URL('../src/', import.meta.url))
  const srcFiles68 = await readdir(srcRoot68, { recursive: true })
  const directRefs68: string[] = []
  await Promise.all(srcFiles68
    .filter((f) => /\.(ts|tsx|js|jsx|css)$/.test(f))
    .map(async (f) => {
      const rel68 = f.replace(/\\/g, '/')
      if (rel68 === 'styles/tokens.css') return
      const text68 = await readFile(join(srcRoot68, f), 'utf-8')
      if (text68.includes('var(--tm-brand-')) directRefs68.push(rel68)
    }))
  assert.deepEqual(directRefs68, [],
    '【主题色】组件 / 样式只能引用 --color-* 语义 token；直接引用运行时变量会绕过统一管理层')

  // 2) 静态 fallback 必须与「默认品牌色的派生结果」逐字一致：否则用户从自定义色
  //    点「恢复默认」时，注入被清空、界面会突然跳到另一档亮度 / 色相。
  const derivedLight68 = buildAccentTokens(DEFAULT_ACCENT_COLOR, 'light')
  const derivedDark68 = buildAccentTokens(DEFAULT_ACCENT_COLOR, 'dark')
  const rootBlock68 = tokens68.slice(tokens68.indexOf(':root {'), tokens68.indexOf("html[data-theme='dark']"))
  const darkBlock68 = tokens68.slice(tokens68.indexOf("html[data-theme='dark']"), tokens68.indexOf('/* ===== GitHub Light Theme'))
  const lightBlock68 = tokens68.slice(tokens68.indexOf("html[data-theme='github-light'] {"))
  for (const [label68, block68, derived68] of [
    [':root', rootBlock68, derivedLight68],
    ['dark', darkBlock68, derivedDark68],
    ['github-light', lightBlock68, derivedLight68],
  ] as const) {
    assert.ok(block68.length > 100, `【主题色】找不到 ${label68} 主题块`)
    for (const name68 of ACCENT_TOKEN_NAMES) {
      const match68 = block68.match(new RegExp(`${name68},\\s*(.+?)\\);`))
      assert.ok(match68, `【主题色】${label68} 缺少 ${name68} 的 fallback`)
      assert.equal(match68?.[1], derived68[name68],
        `【主题色】${label68} 的 ${name68} fallback 必须等于默认色的派生值，恢复默认时才不会跳色`)
    }
  }

  // 3) 预设色板必须是调和算法的不动点：色板上看到的颜色 === 全软件实际生效的颜色。
  assert.equal(ACCENT_PRESETS[0].hex, DEFAULT_ACCENT_COLOR,
    '【主题色】第一项预设必须是默认品牌色（设置页用它作为恢复默认的落点）')
  assert.equal(normalizeAccentColor(DEFAULT_ACCENT_COLOR), DEFAULT_ACCENT_COLOR)
  for (const preset68 of ACCENT_PRESETS) {
    const h68 = harmonizeAccentColor(preset68.hex)
    assert.equal(h68.hex, preset68.hex, `【主题色】预设 ${preset68.id} 被无谓微调，取色器会来回跳`)
    assert.equal(h68.adjusted, false, `【主题色】预设 ${preset68.id} 不应触发自动微调提示`)
  }

  // 4) 任意颜色（含荧光色 / 纯白 / 纯黑 / 灰）都必须派生出完整色阶，并保持可读性：
  //    light 下主题色配白字、dark 下配深色字，两种约束都不能低于 WCAG 4.5:1。
  const luminance68 = (hex68: string) => {
    const digits68 = hex68.slice(1)
    const chan68 = (v: number) => {
      const c68 = v / 255
      return c68 <= 0.04045 ? c68 / 12.92 : ((c68 + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * chan68(parseInt(digits68.slice(0, 2), 16))
      + 0.7152 * chan68(parseInt(digits68.slice(2, 4), 16))
      + 0.0722 * chan68(parseInt(digits68.slice(4, 6), 16))
  }
  const contrast68 = (a68: string, b68: string) => {
    const la68 = luminance68(a68)
    const lb68 = luminance68(b68)
    return (Math.max(la68, lb68) + 0.05) / (Math.min(la68, lb68) + 0.05)
  }
  for (const input68 of [...ACCENT_PRESETS.map((p) => p.hex), '#ffff00', '#ff0000', '#ffffff', '#000000', '#00ff00', '#808080']) {
    for (const theme68 of ['light', 'dark'] as const) {
      const scale68 = buildAccentTokens(input68, theme68)
      for (const name68 of ACCENT_TOKEN_NAMES) {
        assert.ok(/^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/.test(scale68[name68] ?? ''),
          `【主题色】${input68} / ${theme68} 派生出的 ${name68} 不合法`)
      }
      if (theme68 === 'light') {
        assert.equal(scale68['--tm-brand-primary'], scale68['--tm-brand-accent'],
          `【主题色】${input68} 在浅色主题必须保持单色制（primary === accent）`)
        assert.ok(contrast68(scale68['--tm-brand-primary'], '#ffffff') >= 4.5,
          `【主题色】${input68} 作按钮底时白字不可读`)
      } else {
        assert.ok(contrast68(scale68['--tm-brand-accent'], '#0f141b') >= 4.5,
          `【主题色】${input68} 在深色背景下不可读`)
      }
    }
  }
  // 无彩色输入（白 / 黑 / 灰）保留中性，绝不凭空染上一个色相。
  for (const neutral68 of ['#ffffff', '#000000', '#808080', '#f5f5f5']) {
    const hex68 = harmonizeAccentColor(neutral68).hex
    const r68 = parseInt(hex68.slice(1, 3), 16)
    const g68 = parseInt(hex68.slice(3, 5), 16)
    const b68 = parseInt(hex68.slice(5, 7), 16)
    assert.ok(r68 === g68 && g68 === b68, `【主题色】${neutral68} 被错误染色为 ${hex68}`)
  }

  // 5) 输入规范化：CSS 允许的 3 / 4 / 6 / 8 位 hex 都归一成不带 alpha 的 6 位小写值。
  assert.equal(normalizeAccentColor('#ABC'), '#aabbcc')
  assert.equal(normalizeAccentColor('#abcd'), '#aabbcc')
  assert.equal(normalizeAccentColor('#0969DA80'), '#0969da')
  for (const bad68 of ['', '  ', 'not-a-color', '#12', '#ggg', '#12345', 123, null, undefined]) {
    assert.equal(normalizeAccentColor(bad68), null, `【主题色】非法输入 ${String(bad68)} 必须被拒绝`)
  }

  // 6) 全链路接线：启动应用 / 切换明暗重新派生 / 修改即持久化 / 默认色清空注入 /
  //    设置页提供真实控件且自身不含色值字面量。
  assert.ok(main68.includes('useThemeStore.getState().initializeTheme()'),
    '【主题色】必须在首帧前从存档恢复主题色，否则每次启动都会闪回品牌蓝')
  assert.ok(store68.includes('applyAccentColor(accentColor, accentThemeOf(theme))'),
    '【主题色】初始化必须同时注入派生色阶')
  assert.ok(store68.includes('applyAccentColor(get().accentColor, accentThemeOf(theme))'),
    '【主题色】切换浅色 / 深色必须用同一基色重新派生，否则亮度层级会错位')
  assert.ok(store68.includes('persistAccentColor(color)') && store68.includes('window.localStorage'),
    '【主题色】主题色必须持久化，不能只在当前会话生效')
  assert.ok(apply68.includes('color === DEFAULT_ACCENT_COLOR') && apply68.includes('clearAccentTokens()'),
    '【主题色】选回默认色必须清空运行时注入，让静态 fallback 生效')
  assert.ok(settings68.includes('ACCENT_PRESETS') && settings68.includes('state.accentColor')
    && settings68.includes('data-tm-accent-preset=') && settings68.includes('data-tm-accent-custom'),
    '【主题色】全局设置页必须提供预设色板 + 自定义取色器，且从统一管理层取数据')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(settings68),
    '【主题色】设置页不得出现色值字面量，色板只能来自 domain/theme')

  // 7) 策略数据化：默认策略必须与「不传策略」逐字一致（这次改造零行为变化），
  //    且覆盖入口真的能改变派生结果 —— 这是未来主题皮肤的唯一扩展点。
  assert.equal(ACCENT_POLICIES.light.scale.darkTiers, null,
    '【主题色】浅色策略不应带深色亮度层级')
  assert.ok(ACCENT_POLICIES.dark.scale.darkTiers,
    '【主题色】深色策略必须提供亮度层级，否则深底上文字不可读')
  assert.equal(ACCENT_POLICIES.light.harmonize.minContrast, 4.5,
    '【主题色】默认可读性下限不得被悄悄改动')
  for (const policyInput68 of [...ACCENT_PRESETS.map((p) => p.hex), '#ffff00', '#ffffff', '#808080']) {
    for (const policyTheme68 of ['light', 'dark'] as const) {
      assert.deepEqual(
        buildAccentTokens(policyInput68, policyTheme68, ACCENT_POLICIES[policyTheme68]),
        buildAccentTokens(policyInput68, policyTheme68),
        `【主题色】${policyInput68}/${policyTheme68} 显式传默认策略不得改变派生结果`)
    }
  }
  const scaleBase68 = buildAccentTokens(DEFAULT_ACCENT_COLOR, 'light')
  const scaleOverride68 = resolveAccentPolicy('light', { scale: { softAlpha: 0.42 } })
  const scaleOverridden68 = buildAccentTokens(DEFAULT_ACCENT_COLOR, 'light', scaleOverride68)
  assert.notEqual(scaleOverridden68['--tm-brand-soft'], scaleBase68['--tm-brand-soft'],
    '【主题色】策略覆盖必须能改派生色阶')
  assert.equal(scaleOverridden68['--tm-brand-selected'], scaleBase68['--tm-brand-selected'],
    '【主题色】局部覆盖不得影响未覆盖的档位')
  assert.equal(scaleOverride68.scale.selectedAlpha, ACCENT_POLICIES.light.scale.selectedAlpha,
    '【主题色】resolveAccentPolicy 必须保留未覆盖字段')
  const tierOverride68 = resolveAccentPolicy('dark', { scale: { darkTiers: { saturationBoost: 0 } } })
  assert.notEqual(
    buildAccentTokens(DEFAULT_ACCENT_COLOR, 'dark', tierOverride68)['--tm-brand-accent'],
    buildAccentTokens(DEFAULT_ACCENT_COLOR, 'dark')['--tm-brand-accent'],
    '【主题色】深色嵌套策略也必须可局部覆盖')
  const harmonizeOverride68 = resolveAccentPolicy('light', { harmonize: { maxSaturation: 0.3 } })
  assert.notEqual(
    harmonizeAccentColor('#ffff00', harmonizeOverride68.harmonize).hex,
    harmonizeAccentColor('#ffff00').hex,
    '【主题色】调和策略必须可覆盖，皮肤作者才能放宽 / 关闭自动调和')
  assert.notEqual(
    buildAccentTokens('#ffff00', 'light', harmonizeOverride68)['--tm-brand-primary'],
    buildAccentTokens('#ffff00', 'light')['--tm-brand-primary'],
    '【主题色】调和策略覆盖必须传导到派生色阶')

  // 8) 版本化外观配置入口：v0 裸 hex 与 v1 JSON 都能读，坏数据一律回落默认。
  assert.equal(THEME_CONFIG_VERSION, 1, '【主题配置】版本号变更必须同时补迁移分支')
  const cfgFallback68 = DEFAULT_ACCENT_COLOR
  assert.equal(parseThemeConfig(null, cfgFallback68).accentColor, cfgFallback68,
    '【主题配置】空存档必须回落默认')
  assert.equal(parseThemeConfig('', cfgFallback68).accentColor, cfgFallback68)
  assert.equal(parseThemeConfig('#ABC', cfgFallback68).accentColor, '#aabbcc',
    '【主题配置】v0 裸 hex 必须能升级到 v1')
  assert.equal(parseThemeConfig('#0969DA80', cfgFallback68).accentColor, DEFAULT_ACCENT_COLOR,
    '【主题配置】v0 带 alpha 的 hex 必须丢弃 alpha')
  assert.equal(parseThemeConfig('#743fc0', cfgFallback68).version, THEME_CONFIG_VERSION)
  const cfgV168 = serializeThemeConfig({ version: 1, accentColor: '#743fc0' })
  assert.equal(parseThemeConfig(cfgV168, cfgFallback68).accentColor, '#743fc0',
    '【主题配置】v1 JSON 与 serializeThemeConfig 必须 round-trip')
  for (const cfgBad68 of [
    'not-a-color',
    JSON.stringify({ version: 1, accentColor: 'oops' }),
    JSON.stringify({ version: 99, accentColor: '#743fc0' }),
    JSON.stringify({ accentColor: '#743fc0' }),
    '{"version":1,',
    JSON.stringify([1, 2, 3]),
    '{"version":1,"accentColor":null}',
    123,
    {},
    undefined,
  ]) {
    assert.equal(parseThemeConfig(cfgBad68, cfgFallback68).accentColor, cfgFallback68,
      `【主题配置】无法识别的存档 ${String(cfgBad68)} 必须回落默认`)
  }
  assert.ok(store68.includes('parseThemeConfig(raw, DEFAULT_ACCENT_COLOR)'),
    '【主题配置】store 读入口必须走版本化解析，不能自己再写一份兼容逻辑')
  assert.ok(store68.includes('window.localStorage.setItem(ACCENT_STORAGE_KEY, color)'),
    '【主题配置】v0 写盘格式保持不变，保证这次改造零行为变化')
}

// ===== 69) 标题栏学习时长等宽：变长时间字符串不得推动 tab 区（2026-11-24）=====
// 旧状态：时长直接渲染在 button 里，"0s" / "59m 59s" / "23h 59m 59s" 宽度不同，
// 导致紧随其后的 data-tm-tab-zone 左边界随秒数跳动，整排知识库 tab 左右漂移。
{
  const widget69 = await readFile(new URL('../src/plugins/builtin/learning-statistics/LearningTrackerWidget.tsx', import.meta.url), 'utf-8')
  const title69 = await readFile(new URL('../src/features/layout/CustomTitleBar/CustomTitleBar.tsx', import.meta.url), 'utf-8')
  const gui69 = await readFile(new URL('../scripts/verify-titlebar-duration-gui.mjs', import.meta.url), 'utf-8')
  const pkg69 = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))

  assert.ok(widget69.includes('const MAX_TODAY_SECONDS = 24 * 60 * 60 - 1')
    && widget69.includes('const DURATION_WIDTH_SAMPLE = formatDuration(MAX_TODAY_SECONDS)'),
    '【标题栏时长等宽】固定宽度必须由「当日最长合法字符串」推导，不能拍脑袋写死')
  assert.ok(widget69.includes('data-tm-learning-duration=""')
    && widget69.includes('tabular-nums') && widget69.includes('whitespace-nowrap')
    && widget69.includes('aria-hidden="true" className="invisible"')
    && /absolute inset-y-0 left-0/.test(widget69),
    '【标题栏时长等宽】隐形占位 + 脱离文档流的左对齐真实文本 + 等宽数字契约缺一不可')
  const durationClass69 = widget69.match(/data-tm-learning-duration=""[\s\S]{0,200}?className="([^"]+)"/)?.[1] ?? ''
  assert.ok(!/\[\d+(px|ch)\]/.test(durationClass69),
    '【标题栏时长等宽】禁止用魔法 px / ch 宽度：换字体、字号或字距后会再次溢出或留白')
  assert.ok(title69.indexOf('data-tm-titlebar-widget=""') < title69.indexOf('data-tm-tab-zone=""'),
    '【标题栏时长等宽】学习计时 widget 必须在 tab 区之前，它的宽度才会直接决定 tab 位置')
  assert.ok(gui69.includes("'0s'") && gui69.includes("'23h 59m 59s'")
    && gui69.includes('zoneX') && gui69.includes('viewportRows')
    && pkg69.scripts?.['verify:titlebar:duration:gui'],
    '【标题栏时长等宽】必须有真实 GUI 回归覆盖全部时长形态与窗口宽度变化，并挂 npm 入口')
}

console.log('Critical regression checks verified')
