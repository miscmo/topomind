import type { KnowledgeNodeStyle } from '../../../../../../types'
import { MAX_TITLE_LINES, MAX_TITLE_WIDTH_CHARS } from './cardSizeLimits'
import type { KnowledgeCardTitleDecorations } from './titleDecorations'

const MIN_NODE_WIDTH = 80
const MIN_NODE_HEIGHT = 36
const HEADER_VERTICAL_PADDING = 6
const HEADER_MIN_HEIGHT = 24
/**
 * 补偿节点 border 宽度 + Canvas 测量与 DOM 排版之间的像素差。
 * 注意：availableTextWidth 会把这 6px 加回去参与行数计算，因此它只影响节点外框宽度，
 * 不会挤压标题可用文本宽度。
 */
const DOM_BORDER_BUFFER = 6

let measureCanvas: HTMLCanvasElement | null = null

function getCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
  }
  return measureCanvas.getContext('2d')
}

function buildFont(style: KnowledgeNodeStyle): string {
  const fontStyle = style.headerFontStyle === 'italic' ? 'italic' : 'normal'
  const fontWeight = style.headerFontWeight === 'bold' ? '700' : '400'
  const fontSize = style.headerFontSize ?? 11
  return `${fontStyle} ${fontWeight} ${fontSize}px "Inter", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`
}

function measureTextWidth(text: string, style: KnowledgeNodeStyle): number {
  const ctx = getCanvasContext()
  if (!ctx) {
    return text.length * ((style.headerFontSize ?? 11) * 0.9)
  }
  ctx.font = buildFont(style)
  return ctx.measureText(text).width
}

/**
 * 两个"基准宽度"（20 个汉字的块宽、单个字宽）只由字体决定，与节点文案无关，
 * 但每次算尺寸都要测量一遍。ctx.measureText 会同步触发字体解析，节点多时是可观开销，
 * 按字体特征做模块级缓存即可省掉这两次测量。
 * 字体组合（normal/italic × 400/700 × 字号）数量有限，缓存不会无界膨胀。
 */
const baselineWidthCache = new Map<string, { chineseBlock: number; singleChar: number }>()

function getBaselineWidths(style: KnowledgeNodeStyle): { chineseBlock: number; singleChar: number } {
  const fontStyle = style.headerFontStyle === 'italic' ? 'italic' : 'normal'
  const fontWeight = style.headerFontWeight === 'bold' ? '700' : '400'
  const fontSize = style.headerFontSize ?? 11
  const key = `${fontStyle}|${fontWeight}|${fontSize}`
  const cached = baselineWidthCache.get(key)
  if (cached) return cached

  if (baselineWidthCache.size > 128) baselineWidthCache.clear()
  const value = {
    chineseBlock: Math.max(60, measureTextWidth('汉'.repeat(MAX_TITLE_WIDTH_CHARS), style)),
    singleChar: measureTextWidth('字', style),
  }
  baselineWidthCache.set(key, value)
  return value
}

/**
 * 计算自适应尺寸。
 *
 * decorations 来自 titleDecorations.ts，是标题栏装饰的唯一事实来源：
 * 链环、emoji、文档图标、子节点徽章的占位都在里面算好，本函数不再自己读 data，
 * 也就不会再出现「渲染里加了图标，测量里忘了加宽度」。
 */
export function calculateKnowledgeCardAutoSize(
  label: string,
  nodeStyle: KnowledgeNodeStyle,
  decorations: KnowledgeCardTitleDecorations,
): {
  width: number
  height: number
  maxTextWidth: number
  maxAutoWidth: number
  lines: number
  clamped: boolean
} {
  const safeLabel = (label || '').trim() || '未命名节点'
  const fontSize = nodeStyle.headerFontSize ?? 11
  const lineHeightPx = Math.round(fontSize * 1.3)
  const baseline = getBaselineWidths(nodeStyle)
  const maxTextWidth = baseline.chineseBlock
  const linesArr = safeLabel.split('\n')
  const textWidthArr = linesArr.map(line => measureTextWidth(line, nodeStyle))
  const maxLineWidth = Math.max(...textWidthArr, baseline.singleChar * 2)

  // 左右基础内边距 + 左侧装饰（链环/emoji）+ 右侧槽位（文档图标/徽章）+ 边框补偿。
  const totalExtraWidth = decorations.horizontalPadding * 2
    + decorations.leadingWidth
    + decorations.trailingWidth
    + DOM_BORDER_BUFFER

  // 「节点最大长度」：自动宽度天花板，长标题只会折行、截断，不会把节点无限撑宽。
  const maxAutoWidth = Math.max(MIN_NODE_WIDTH, Math.ceil(totalExtraWidth + maxTextWidth))
  const width = Math.max(
    MIN_NODE_WIDTH,
    Math.min(maxAutoWidth, Math.ceil(maxLineWidth + totalExtraWidth)),
  )
  const availableTextWidth = Math.max(40, width - totalExtraWidth + DOM_BORDER_BUFFER)

  let totalLines = 0
  for (const line of linesArr) {
    const lw = measureTextWidth(line, nodeStyle)
    totalLines += Math.max(1, Math.ceil(lw / availableTextWidth))
  }
  // 行数与 DOM 的 -webkit-line-clamp 共用 MAX_TITLE_LINES：
  // DOM 真实截断并显示省略号，这里同步封顶高度，两边永远不会出现
  // 「算出的高度 < 实际渲染高度」（裁切）或「算出的高度 > 实际高度」（底部留白）。
  const unboundedLines = Math.max(1, totalLines)
  const lines = Math.min(MAX_TITLE_LINES, unboundedLines)
  const height = Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(Math.max(HEADER_MIN_HEIGHT, lines * lineHeightPx) + HEADER_VERTICAL_PADDING * 2),
  )

  return {
    width,
    height,
    maxTextWidth,
    maxAutoWidth,
    lines,
    clamped: unboundedLines > MAX_TITLE_LINES,
  }
}
