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
 * 创建一个带有项目默认配置的 Cytoscape 实例。
 * 默认禁用 Cytoscape 自带的缩放和平移，统一由上层 DOM 交互逻辑接管。
 *
 * @param {HTMLElement|null} container 挂载容器
 * @param {object} options 用于覆盖默认配置的附加选项
 * @returns {import('cytoscape').Core} Cytoscape 实例
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
 * 为 Cytoscape 实例启用 HTML Label 插件配置。
 * 当实例来自缓存且已存在节点时，可通过 `forceInit` 主动触发一次渲染事件。
 *
 * @param {import('cytoscape').Core} cyInst Cytoscape 实例
 * @param {boolean} [forceInit=false] 是否强制触发初始化渲染
 * @returns {void}
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