/**
 * 房间导航状态 store
 * 替代原 app.js 中的：currentKBPath, currentRoomPath, roomHistory, _pathNameMap
 * 以及原 tabs.js 中的 TabManager
 */
import { defineStore } from 'pinia'

export const useRoomStore = defineStore('room', {
  state: () => ({
    /** 当前打开的知识库路径 */
    currentKBPath: null,
    /** 当前房间路径（null = 知识库根级） */
    currentRoomPath: null,
    /** 房间历史栈，用于 Backspace 返回 */
    roomHistory: [],
    /** 路径 → 显示名称的缓存 */
    pathNameMap: {},
    /** pathNameMap 版本号（递增触发 DetailPanel 标题更新） */
    _pathNameMapVersion: 0,
    /** 标签页列表 [{ id, kbPath, label, roomPath, roomHistory, ui }] */
    tabs: [],
    /** 当前激活的标签页 ID */
    activeTabId: null,
    /** 当前图谱的 Cytoscape 实例引用（非响应式，用 shallowRef） */
    _cyRef: null,
    /** 布局保存请求时间戳，变更时触发 useGraph watch */
    _saveRequestTs: 0,
  }),

  getters: {
    /** 是否可以返回上一层 */
    canGoBack: (state) => state.roomHistory.length > 0,

    /** 面包屑路径数组 [{ label, path }] */
    breadcrumbs: (state) => {
      if (!state.currentKBPath) return []
      const crumbs = []
      const kbName = state.pathNameMap[state.currentKBPath] ||
        state.currentKBPath.split('/').pop() || state.currentKBPath
      crumbs.push({ label: kbName, path: state.currentKBPath })
      if (state.currentRoomPath && state.currentRoomPath !== state.currentKBPath) {
        const relative = state.currentRoomPath.replace(state.currentKBPath + '/', '')
        const segments = relative.split('/')
        let builtPath = state.currentKBPath
        for (const seg of segments) {
          builtPath += '/' + seg
          crumbs.push({
            label: state.pathNameMap[builtPath] || seg,
            path: builtPath,
          })
        }
      }
      return crumbs
    },

    /** 当前激活标签页对象 */
    activeTab: (state) => state.tabs.find(t => t.id === state.activeTabId) || null,
  },

  actions: {
    // ─── 房间导航 ────────────────────────────────────────────

    /** 打开一个知识库（重置房间状态） */
    openKB(kbPath) {
      this.currentKBPath = kbPath
      this.currentRoomPath = kbPath
      this.roomHistory = []
    },

    /** 钻入子房间 */
    drillInto(path) {
      this.roomHistory = [...this.roomHistory, this.currentRoomPath]
      this.currentRoomPath = path
    },

    /** 返回上一层 */
    goBack() {
      if (this.roomHistory.length > 0) {
        const last = this.roomHistory[this.roomHistory.length - 1]
        this.roomHistory = this.roomHistory.slice(0, -1)
        this.currentRoomPath = last
      }
    },

    /** 跳转到指定房间（面包屑点击） */
    jumpTo(path) {
      // 从历史中截断到 path 之前
      const idx = this.roomHistory.indexOf(path)
      if (idx !== -1) {
        this.roomHistory = this.roomHistory.slice(0, idx)
      } else {
        this.roomHistory = []
      }
      this.currentRoomPath = path
    },

    /** 缓存路径的显示名称 */
    setPathName(path, name) {
      this.pathNameMap[path] = name
      this._pathNameMapVersion++
    },

    /** 移除路径的显示名称缓存 */
    removePathName(path) {
      delete this.pathNameMap[path]
      this._pathNameMapVersion++
    },

    // ─── 标签页管理 ──────────────────────────────────────────

    /** 打开或切换到一个知识库标签页 */
    openTab(kbPath, label) {
      const existing = this.tabs.find(t => t.kbPath === kbPath)
      if (existing) {
        this.switchTab(existing.id)
        return existing.id
      }
      const id = `tab-${Date.now()}`
      const newTab = {
        id,
        kbPath,
        label: label || kbPath.split('/').pop(),
        roomPath: kbPath,
        roomHistory: [],
        ui: {
          selectedNodeId: null,
          edgeMode: false,
          edgeModeSourceId: null,
          leftPanelOpen: true,
          detailPanelOpen: true,
          detailPanelWidth: 420,
          searchQuery: '',
        },
      })
      this.tabs = [...this.tabs, newTab]
      this.switchTab(id)
      return id
    },

    /** 切换标签页 */
    switchTab(tabId) {
      // 保存当前标签页状态
      const current = this.tabs.find(t => t.id === this.activeTabId)
      if (current) {
        current.roomPath = this.currentRoomPath
        current.roomHistory = [...this.roomHistory]
      }
      // 恢复目标标签页状态
      const target = this.tabs.find(t => t.id === tabId)
      if (target) {
        this.activeTabId = tabId
        this.currentKBPath = target.kbPath
        this.currentRoomPath = target.roomPath
        this.roomHistory = [...target.roomHistory]
      }
    },

    /** 关闭标签页 */
    closeTab(tabId) {
      const idx = this.tabs.findIndex(t => t.id === tabId)
      if (idx === -1) return
      this.tabs = this.tabs.filter((_, i) => i !== idx)
      if (this.activeTabId === tabId) {
        if (this.tabs.length > 0) {
          const next = this.tabs[Math.max(0, idx - 1)]
          this.switchTab(next.id)
        } else {
          this.activeTabId = null
          this.currentKBPath = null
          this.currentRoomPath = null
          this.roomHistory = []
        }
      }
    },

    // ─── 布局保存 ──────────────────────────────────────────
    /**
     * 保存当前布局（实际由 useGraph composable 处理）
     * 此方法仅供 App.vue 的 save:before-quit 事件触发，
     * 通过 Pinia action 触发响应式更新，实际保存逻辑见 useGraph.saveCurrentLayout
     */
    saveCurrentLayout() {
      // 触发响应式更新，useGraph watch 会执行实际保存
      this._saveRequestTs = Date.now()
    },
  },
})
