/**
 * 图谱节点 HTML 标签生成器
 * 从 useGraph.js 中提取的节点标签渲染逻辑
 * 使用 cytoscape-node-html-label 插件渲染
 */

import { GraphConstants } from './graph-constants.js'

/**
 * HTML 转义，防止 XSS
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 文档图标 SVG（14x14px，固定尺寸不随父元素 font-size 缩放）
 */
const DOC_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="9" height="12" rx="1.5" stroke="#fff" stroke-width="1.2" fill="none"/><rect x="4" y="1" width="6" height="5" rx="1" fill="#fff" opacity="0.9"/><line x1="3" y1="8" x2="9" y2="8" stroke="#fff" stroke-width="1" stroke-linecap="round"/><line x1="3" y1="10" x2="9" y2="10" stroke="#fff" stroke-width="1" stroke-linecap="round"/><line x1="3" y1="12" x2="7" y2="12" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>`

const DOC_ICON_SPAN = `<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;font-size:0;line-height:0;vertical-align:text-bottom">${DOC_ICON_SVG}</span>`

/**
 * 生成节点 HTML 标签字符串
 * 供 cytoscape-node-html-label 调用
 *
 * @param {object} data - Cytoscape 节点数据
 * @param {string} data.label - 节点显示文字
 * @param {boolean} [data.hasDoc] - 是否有文档
 * @param {number} [data.childCount] - 子节点数量
 * @param {number} [data.fontSize] - 字体大小
 * @param {string} [data.fontColor] - 字体颜色
 * @param {string} [data.fontStyle] - 字体样式（bold/italic）
 * @param {string} [data.textAlign] - 文字对齐
 * @param {boolean} [data.textWrap] - 是否换行
 * @returns {string} HTML 字符串
 */
export function generateNodeLabelHtml(data) {
  const label = escapeHtml(data.label || '')
  const hasDoc = !!data.hasDoc
  const childCount = data.childCount || 0

  const fontSize = Number(data.fontSize) || GraphConstants.DEFAULT_FONT_SIZE
  const fontColor = data.fontColor || GraphConstants.DEFAULT_FONT_COLOR
  const fontStyle = data.fontStyle || ''
  const textAlign = data.textAlign || GraphConstants.DEFAULT_TEXT_ALIGN
  const textWrap = data.textWrap !== false
  const fontWeight = fontStyle.includes('bold') ? 'bold' : ''
  const fontStyleAttr = fontStyle.includes('italic') ? 'italic' : ''

  // 文档图标：14x14px 固定尺寸，不随父元素 font-size 缩放
  const docIcon = hasDoc ? DOC_ICON_SPAN : ''

  // 子节点计数：固定 10px，不随节点文字大小变化
  const childIcon = childCount > 0
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:14px;padding:0 3px;flex-shrink:0;font-size:10px;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif;color:#fff;line-height:1;vertical-align:text-bottom;box-sizing:border-box;background:rgba(255,255,255,0.25);border-radius:7px">${childCount}↓</span>`
    : ''

  const badgeGroup = (docIcon || childIcon)
    ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:5px;flex-shrink:0;vertical-align:text-bottom">${docIcon}${childIcon}</span>`
    : ''

  // 文字样式
  const textStyles = [
    'display:inline',
    'vertical-align:text-bottom',
    `font-size:${fontSize}px`,
    `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`,
    `color:${fontColor}`,
    fontWeight ? `font-weight:${fontWeight}` : '',
    fontStyleAttr ? `font-style:${fontStyleAttr}` : '',
    `text-align:${textAlign}`,
    `white-space:${textWrap ? 'normal' : 'nowrap'}`,
  ].filter(Boolean).join(';')

  return `<span style="${textStyles}">${badgeGroup}${label}</span>`
}

/**
 * 返回 cytoscape-node-html-label 配置对象
 * @returns {Array<{query: string, html: Function, valmap?: Function}>}
 */
export function getNodeHtmlLabelConfig() {
  return [{
    query: 'node.card',
    html: generateNodeLabelHtml,
    // 禁用自动内容映射，避免覆盖节点 data 对象中的原始值
    // valmap 仅用于标签内容映射，不改变 data 对象
    valmap: (data) => ({ ...data }),
  }]
}
