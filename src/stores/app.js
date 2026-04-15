/**
 * 全局应用状态 store
 * 替代原 app.js 中的全局变量：
 *   selectedNode, edgeMode, edgeModeSource, autoIdCounter, _pendingConfirmAction
 */
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    /** 当前视图：'home' | 'graph' */
    view: 'home',
    /** 当前选中的节点 ID（不存 Cytoscape 对象，避免响应式污染） */
    selectedNodeId: null,
    /** 是否处于连线模式 */
    edgeMode: false,
    /** 连线模式的源节点 ID */
    edgeModeSourceId: null,
    /** 自动 ID 计数器 */
    autoIdCounter: 0,
  }),

  actions: {
    /** 生成唯一节点 ID */
    autoId() {
      return `n-${Date.now()}-${this.autoIdCounter++}`
    },

    /** 进入图谱视图 */
    showGraph() {
      this.view = 'graph'
    },

    /** 返回首页 */
    showHome() {
      this.view = 'home'
      this.selectedNodeId = null
      this.edgeMode = false
      this.edgeModeSourceId = null
    },

    /** 选中节点 */
    selectNode(nodeId) {
      this.selectedNodeId = nodeId
    },

    /** 取消选中 */
    clearSelection() {
      this.selectedNodeId = null
    },

    /** 进入连线模式 */
    enterEdgeMode(sourceId) {
      this.edgeMode = true
      this.edgeModeSourceId = sourceId
    },

    /** 退出连线模式 */
    exitEdgeMode() {
      this.edgeMode = false
      this.edgeModeSourceId = null
    },
  },
})
