// 带 .ts 后缀：回归脚本用 Node 原生 strip-types 直接加载本模块，无后缀会 ERR_MODULE_NOT_FOUND。
import { clampNumber, finiteNumber, EDITOR_STYLE_NUMBER_LIMITS } from '../../../domain/style/styleConstraints.ts'
import { STYLE_CONFIG_DEFAULTS } from '../../../domain/style/styleDefaults.ts'

/**
 * 编辑器版面（全局配置，存在 defaultEditorStyle 里）：
 * - maxWidth    内容框的【最大宽度（px）】。实际宽度 = min(编辑器可用宽度, maxWidth)：
 *               右栏很宽时铺到上限、两侧留白；右栏变窄时自动占满可用宽度、不留白。
 * - marginRatio 剩余留白分给左侧的比例（0.5 居中 / 0 贴左 / 1 贴右）
 *
 * 只影响 .bn-container 的 max-width / margin-left 两个 CSS 变量，不写进文档 JSON，
 * 也不进 BlockNote 的选区与撤销历史。
 */
export interface EditorLayout {
  maxWidth: number
  marginRatio: number
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = {
  maxWidth: STYLE_CONFIG_DEFAULTS.defaultEditorStyle.contentWidth,
  marginRatio: STYLE_CONFIG_DEFAULTS.defaultEditorStyle.contentMarginRatio,
}

/** 旧存档 / 脏值一律收敛到合法范围，避免 max-width 算出负数或 0。 */
export function normalizeEditorLayout(raw: unknown): EditorLayout {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return {
    maxWidth: Math.round(clampNumber(
      finiteNumber(value.maxWidth, DEFAULT_EDITOR_LAYOUT.maxWidth),
      EDITOR_STYLE_NUMBER_LIMITS.contentWidth.min,
      EDITOR_STYLE_NUMBER_LIMITS.contentWidth.max,
    )),
    marginRatio: clampNumber(
      finiteNumber(value.marginRatio, DEFAULT_EDITOR_LAYOUT.marginRatio),
      EDITOR_STYLE_NUMBER_LIMITS.contentMarginRatio.min,
      EDITOR_STYLE_NUMBER_LIMITS.contentMarginRatio.max,
    ),
  }
}

/** 注入到编辑器根节点的两条 CSS 变量值。 */
export function buildEditorLayoutVars(layout: EditorLayout): { maxWidth: string; marginRatio: string } {
  const normalized = normalizeEditorLayout(layout)
  return {
    maxWidth: `${normalized.maxWidth}px`,
    marginRatio: String(normalized.marginRatio),
  }
}

/**
 * 版面语义的纯函数表达（CSS 用 width:100% + max-width + calc 实现同一套规则，
 * 这里供回归脚本真跑数值，验证「窄栏不留白 / 宽栏封顶 / 留白按比例分配」）。
 */
export function computeEditorLayoutPixels(availableWidth: number, layout: EditorLayout): {
  width: number
  left: number
  right: number
} {
  const normalized = normalizeEditorLayout(layout)
  const usable = Math.max(0, finiteNumber(availableWidth, 0))
  const width = Math.min(usable, normalized.maxWidth)
  const rest = usable - width
  const left = rest * normalized.marginRatio
  return { width, left, right: rest - left }
}
