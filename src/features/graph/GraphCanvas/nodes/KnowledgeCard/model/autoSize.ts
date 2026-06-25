import type { KnowledgeNodeData, KnowledgeNodeStyle } from '../../../../../../types'

const MIN_NODE_WIDTH = 80
const MIN_NODE_HEIGHT = 36
const MAX_AUTO_CHINESE_CHARS = 20
const MAX_AUTO_LINES = 4
const TITLE_HORIZONTAL_PADDING = 8
const RIGHT_SLOT_BASE_WIDTH = 8
const RIGHT_SLOT_ICON_WIDTH = 16
const RIGHT_SLOT_BADGE_WIDTH = 22
const HEADER_VERTICAL_PADDING = 6
const HEADER_MIN_HEIGHT = 24
const EMOJI_GAP = 2
const EMOJI_TEXT_GAP = 3

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

export function getKnowledgeCardAccessoryWidth(data: KnowledgeNodeData): number {
  let width = RIGHT_SLOT_BASE_WIDTH
  if (data.hasDetail) width += RIGHT_SLOT_ICON_WIDTH
  if ((data.childCount ?? 0) > 0) width += RIGHT_SLOT_BADGE_WIDTH
  return width
}

export function calculateKnowledgeCardAutoSize(
  label: string,
  nodeStyle: KnowledgeNodeStyle,
  data: KnowledgeNodeData,
): { width: number; height: number; maxTextWidth: number } {
  const safeLabel = (label || '').trim() || '未命名节点'
  const fontSize = nodeStyle.headerFontSize ?? 11
  const lineHeightPx = Math.round(fontSize * 1.3)
  const maxTextWidth = Math.max(
    60,
    measureTextWidth('汉'.repeat(MAX_AUTO_CHINESE_CHARS), nodeStyle),
  )
  const linesArr = safeLabel.split('\n')
  const textWidthArr = linesArr.map(line => measureTextWidth(line, nodeStyle))
  const maxLineWidth = Math.max(...textWidthArr, measureTextWidth('字', nodeStyle) * 2)
  const accessoryWidth = getKnowledgeCardAccessoryWidth(data)
  
  // 左右内边距，减少无谓的空白
  const emojiCount = data.emojis?.length || 0
  // Emoji in Segoe UI / Apple Color Emoji tends to render wider than plain text measurement.
  const emojiWidth = emojiCount > 0
    ? (
      emojiCount * Math.ceil(fontSize * 1.78) +
      Math.max(0, emojiCount - 1) * EMOJI_GAP +
      EMOJI_TEXT_GAP
    )
    : 0
  const leftPadding = TITLE_HORIZONTAL_PADDING + emojiWidth
  const rightPadding = Math.max(TITLE_HORIZONTAL_PADDING, accessoryWidth)
  
  // 准确计算所需的额外宽度
  // 增加 6px 缓冲：用于补偿节点可能存在的 border 宽度 (2px) 以及 Canvas 测量与 DOM 渲染之间的微小像素差异
  const totalExtraWidth = leftPadding + rightPadding + 6
  
  const maxAutoWidth = Math.max(MIN_NODE_WIDTH, Math.ceil(totalExtraWidth + maxTextWidth))
  const width = Math.max(
    MIN_NODE_WIDTH,
    Math.min(maxAutoWidth, Math.ceil(maxLineWidth + totalExtraWidth)),
  )
  // 可用文本宽度在计算行数时，需要扣除我们刚刚加的缓冲，以保证行数计算的严谨性
  const availableTextWidth = Math.max(40, width - totalExtraWidth + 6)
  let totalLines = 0
  for (const line of linesArr) {
    const lw = measureTextWidth(line, nodeStyle)
    totalLines += Math.max(1, Math.ceil(lw / availableTextWidth))
  }
  const lines = Math.max(1, Math.min(MAX_AUTO_LINES, totalLines))
  const height = Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(Math.max(HEADER_MIN_HEIGHT, lines * lineHeightPx) + HEADER_VERTICAL_PADDING * 2),
  )

  return {
    width,
    height,
    maxTextWidth,
  }
}
