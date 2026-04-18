/**
 * Cytoscape 初始化工具
 * 封装实例创建和 HTML 标签设置，不依赖 composable 内部状态。
 */
import cytoscape from 'cytoscape'
import elk from 'cytoscape-elk'
import htmlLabel from 'cytoscape-node-html-label'
import { GraphConstants } from '@/core/graph-constants.js'
import { cloneGraphStyle } from '@/core/graph-style.js'
import { getNodeHtmlLabelConfig } from '@/core/graph-labels.js'

// 注册插件（模块级标志防止重复注册）
const _pluginsRegistered = /** @type {boolean} */ (globalThis.__cytoscapePluginsRegistered__)
if (!_pluginsRegistered) {
  cytoscape.use(elk)
  cytoscape.use(htmlLabel)
  globalThis.__cytoscapePluginsRegistered__ = true
}

/**
 * 创建 Cytoscape 实例
 * @param {HTMLElement|null} container
 * @param {object} options - 覆盖默认选项
 */
export function createCyInstance(container = null, options = {}) {
  return cytoscape({
    container: container || undefined,
    elements: [],
    minZoom: GraphConstants.ZOOM_MIN,
    maxZoom: GraphConstants.ZOOM_MAX,
    userZoomingEnabled: false,
    userPanningEnabled: false,
    boxSelectionEnabled: true,
    selectionType: 'additive',
    style: cloneGraphStyle(),
    ...options,
  })
}

/**
 * 设置 HTML 标签（在 cy.mount() 之后调用）
 * cytoscape-node-html-label 内部会清理旧容器，故可安全重复调用
 * @param {object} cyInst - Cytoscape 实例
 * @param {boolean} forceInit - 强制触发初始化（已有节点时）
 */
export function setupHtmlLabels(cyInst, forceInit = false) {
  if (!cyInst) return
  cyInst.nodeHtmlLabel(getNodeHtmlLabelConfig(), { enablePointerEvents: false })

  // 如果 graph 已经有节点了（从缓存激活的旧实例），
  // 'render' 事件已过，手动触发一次 label 创建
  if (forceInit || (cyInst.nodes && cyInst.nodes().length > 0)) {
    try {
      cyInst.emit('render')
    } catch (e) {
      // 静默忽略：logger 在上层处理
    }
  }
}