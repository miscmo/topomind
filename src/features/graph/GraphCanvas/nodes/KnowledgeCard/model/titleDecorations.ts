import type { KnowledgeNodeData, KnowledgeNodeStyle } from '../../../../../../types'

/**
 * 标题栏「装饰」的唯一事实来源（single source of truth）。
 *
 * 历史 bug：KnowledgeCard.tsx 在标题前新增了关联文档链环（flex item，真实占位），
 * 但 autoSize.ts 的 getKnowledgeCardAccessoryWidth / leftPadding 都没算它，
 * useKnowledgeCardModel 的 useMemo 依赖也没列 linkedDocuments —— 四处同时漏，
 * 表现为「加了关联文档后节点宽度不再自适应、标题被挤成多行又被裁掉」。
 *
 * 根因不是某一行漏写，而是「DOM 渲染」与「Canvas 影子测量」本来是两套事实来源，
 * 靠人工同步：JSX 渲染、宽度常量、计算公式、useMemo 依赖数组。漏一处就失配，
 * 以后加任何图标/徽章都会重现同一类 bug。
 *
 * 本模块把装饰收敛成一份 descriptor：
 *   - 渲染侧（KnowledgeCard.tsx）消费 descriptor 的字段，决定显示什么；
 *   - 测量侧（autoSize.ts）消费 descriptor 的 leading/trailing 宽度；
 *   - signature 由「渲染输入」整体序列化得来，新增装饰字段自动进入签名，
 *     上游 useMemo 因此自动失效，不再需要手工维护依赖数组。
 *
 * 以后新增装饰：只需在 renderInputs 加一个字段、在 JSX 里消费它，
 * 宽度测量与缓存失效同时生效，不可能再出现「只改渲染、忘了测量」。
 */

/** KnowledgeCard.tsx: paddingLeft 8px / paddingRight 下限 8px */
const TITLE_HORIZONTAL_PADDING = 8
/** 标题 flex 容器 gap-[3px]：每个相邻装饰与标题之间各占一份 */
const TITLE_ITEM_GAP = 3
/** 链环 button px-[2px] × 2 */
const LINK_CHIP_PADDING = 4
/** 链环 button fontSize 0.92em，图标 width/height 1em */
const LINK_ICON_EM = 0.92
/** 链环数量数字 0.82em，数字字形宽度约 0.62em/字符 */
const LINK_COUNT_EM = 0.82
const DIGIT_WIDTH_EM = 0.62
/** 链环 button 内部 gap-[1px] */
const LINK_INNER_GAP = 1
/** emoji 容器 gap-[2px] */
const EMOJI_GAP = 2
/** 单个 emoji 估算宽度（沿用历史值，Segoe UI / Apple Color Emoji 偏宽） */
const EMOJI_ITEM_EM = 1.78
/** 右槽位 right-[6px] + 余量 */
const RIGHT_SLOT_BASE_WIDTH = 8
/** 历史常量，作为下限保留：默认 badgeSize=14 时结果不变，避免存量节点宽度跳动 */
const RIGHT_SLOT_ICON_MIN_WIDTH = 16
const RIGHT_SLOT_BADGE_MIN_WIDTH = 22
/** 右槽位 gap-[2px] */
const RIGHT_SLOT_ITEM_GAP = 2

/** 一切会影响标题栏宽度/显示的输入。签名直接序列化它，勿手工枚举字段子集。 */
export interface KnowledgeCardTitleDecorationInputs {
  linkedDocumentCount: number
  emojis: string[]
  hasDetail: boolean
  childCount: number
  badgeSize: number
  fontSize: number
}

export interface KnowledgeCardTitleDecorations extends KnowledgeCardTitleDecorationInputs {
  /** 标题左侧装饰（链环 + emoji）占位宽度，不含基础 padding */
  leadingWidth: number
  /** 标题右侧槽位（文档图标 + 子节点徽章）需预留的宽度，含基础 padding 下限 */
  trailingWidth: number
  /** 基础左右内边距 */
  horizontalPadding: number
  /** 由 renderInputs 整体序列化，任何装饰/字号/徽章尺寸变化都会改变它 */
  signature: string
}

function computeLeadingWidth(inputs: KnowledgeCardTitleDecorationInputs): number {
  let width = 0

  if (inputs.linkedDocumentCount > 0) {
    width += LINK_CHIP_PADDING + Math.ceil(inputs.fontSize * LINK_ICON_EM)
    if (inputs.linkedDocumentCount > 1) {
      const digits = String(inputs.linkedDocumentCount).length
      width += LINK_INNER_GAP + Math.ceil(inputs.fontSize * LINK_COUNT_EM * DIGIT_WIDTH_EM * digits)
    }
    width += TITLE_ITEM_GAP
  }

  if (inputs.emojis.length > 0) {
    width += inputs.emojis.length * Math.ceil(inputs.fontSize * EMOJI_ITEM_EM)
      + Math.max(0, inputs.emojis.length - 1) * EMOJI_GAP
      + TITLE_ITEM_GAP
  }

  return width
}

function computeTrailingWidth(inputs: KnowledgeCardTitleDecorationInputs): number {
  let width = RIGHT_SLOT_BASE_WIDTH
  // 真实尺寸由 nodeBadgeSize 派生（styles.ts 的 compactDocIconSize）；用历史常量兜下限，
  // 既让 badgeSize 变大时自动跟着长，又保证默认配置下与旧结果逐像素一致。
  const docIconSize = Math.max(8, Math.round(inputs.badgeSize * 0.72))
  if (inputs.hasDetail) {
    width += Math.max(RIGHT_SLOT_ICON_MIN_WIDTH, docIconSize + RIGHT_SLOT_ITEM_GAP)
  }
  if (inputs.childCount > 0) {
    width += Math.max(RIGHT_SLOT_BADGE_MIN_WIDTH, inputs.badgeSize + RIGHT_SLOT_ITEM_GAP)
  }
  return width
}

export function describeKnowledgeCardTitle(
  data: KnowledgeNodeData,
  nodeStyle: KnowledgeNodeStyle,
  badgeSize: number,
): KnowledgeCardTitleDecorations {
  const renderInputs: KnowledgeCardTitleDecorationInputs = {
    linkedDocumentCount: data.linkedDocuments?.length ?? 0,
    emojis: data.emojis ?? [],
    hasDetail: data.hasDetail === true,
    childCount: data.childCount ?? 0,
    badgeSize,
    fontSize: nodeStyle.headerFontSize ?? 11,
  }

  return {
    ...renderInputs,
    leadingWidth: computeLeadingWidth(renderInputs),
    trailingWidth: computeTrailingWidth(renderInputs),
    horizontalPadding: TITLE_HORIZONTAL_PADDING,
    // 直接序列化「渲染输入」而不是手工拼字段：以后往 renderInputs 加装饰，
    // 签名自动覆盖，上游 autoSize 的 useMemo 自动失效，无需再改依赖数组。
    signature: JSON.stringify(renderInputs),
  }
}
