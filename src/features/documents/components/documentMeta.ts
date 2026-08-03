/**
 * 文档自定义图标/颜色相关纯函数（独立 .ts 便于 Node 回归直接导入）。
 */

/** 内置主题色板（"修改字体颜色"面板预设） */
export const DOCUMENT_COLOR_PRESETS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db',
  '#9b59b6', '#e84393', '#fd79a8', '#a29bfe', '#636e72', '#2d3436',
  '#d63031', '#fdcb6e', '#00cec9', '#0984e3', '#6c5ce7', '#00b894',
]

/** 校验 CSS hex 颜色（#rgb / #rgba / #rrggbb / #rrggbbaa），合法才允许应用 */
export function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}

/** 文档显示图标：优先自定义，其次类型默认 emoji */
export function resolveDocumentIcon(customIcon: string | undefined, typeIcon: string): string {
  return customIcon && customIcon.trim() ? customIcon.trim().slice(0, 32) : typeIcon
}
