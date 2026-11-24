/**
 * 右侧面板的全局状态（Zustand）
 *
 * ⚠️ 历史背景：本 store 原先放在 `features/right-panel/model/`，但被 core（session-reset）、
 * application（commandRegistry）以及 documents / graph / layout / learning-tracker 等多个
 * feature 共同引用——它实质是**全局 UI 状态**，而非 right-panel 的内部实现。
 * 放在 features 下会造成 core / application 反向依赖 features 的分层倒置。
 *
 * 现统一到 `src/stores/`（与 graphStore / workspaceStore 同级），
 * 各使用方统一按 `@/stores/rightPanelStore` 引用。
 *
 * 【2026-11-23 按知识库隔离】
 * 一个知识库 = 一个常驻挂载的 KB 标签页（App.tsx 里所有 tab 同时挂载，切 tab 只改 CSS）。
 * 画布 / selectedNodeId 由每个 tab 自己的 GraphStoreProvider 隔离，但右栏展开态原先是全局
 * 单值：在 A 里点开文档后切到 B，B 的 RightPanelContainer 仍读到 collapsed=false，而 B
 * 没有选中节点，于是出现空白右栏；反向（B 里点画布折叠）也会把 A 的右栏一起收掉。
 *
 * 现在每个知识库（kbPath）独立维护一份 RightPanelUiState：
 *  - `statesByKb`：唯一的内存数据源，key = kbPath（与 detailLockStore 的 lockedByKb 同构）；
 *  - 6 个扁平字段是 `statesByKb[activeKbPath]` 的**镜像视图**。保留它们是为了让
 *    commandRegistry / KnowledgeCard / learningTracker 等 getState() 命令式调用点以及
 *    原有 selector 无需改动；所有写操作统一经 withUi() 同时更新镜像与分桶；
 *  - `activeKbPath` 由 tabStore 的订阅在标签页切换的同一个同步事务里更新
 *    （见 `stores/tabs/tabStore.ts`）。不能放到 React effect：effect 子先父后，其它常驻
 *    挂载的 tab 会抢先把状态写进上一个知识库的分桶。
 */
import { create } from 'zustand'
import { attachStateObservation } from '../core/observabilityStoreMiddleware.ts'
import type { RightPanelTab } from '../types/uiStoreTypes'

/** 右侧面板宽度下限兜底（像素），防止出现极小值/损坏值。真正可拖拽范围按窗口比例在容器层计算。 */
const RIGHT_PANEL_WIDTH_FLOOR = 280

/** 样式面板内部的小 Tab（节点 / 连线 / 连线关系） */
export type StylePanelTab = 'nodes' | 'edges' | 'relations'

/** 单个知识库独立维护的右栏 UI 状态。 */
export interface RightPanelUiState {
  rightPanelCollapsed: boolean
  rightPanelMaximized: boolean
  /** 固定展开：开启后所有折叠入口（节点/画布自动、标题栏、拖拽、双击）都不生效。 */
  rightPanelPinned: boolean
  rightPanelWidth: number
  rightPanelTab: RightPanelTab
  stylePanelTab: StylePanelTab
}

interface RightPanelStore extends RightPanelUiState {
  /** 当前活跃知识库；'' = 首页 / 二级视图，此时不写入任何分桶。 */
  activeKbPath: string
  statesByKb: Record<string, RightPanelUiState>
  /** 切换活跃知识库时恢复该库自己的右栏状态；未访问过的库回落到默认折叠。 */
  setActiveKbPath: (kbPath: string) => void
  /** 知识库改名时迁移分桶 key，避免丢掉该库已记住的展开态。 */
  renameKbState: (oldKbPath: string, newKbPath: string) => void
  collapseRightPanel: () => void
  expandRightPanel: () => void
  toggleRightPanelMaximized: () => void
  toggleRightPanelPinned: () => void
  /** 点击节点/画布后的自动显隐；pin 开启时整段逻辑短路。 */
  applyRightPanelAutoVisibility: (hasDocument: boolean) => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  setStylePanelTab: (tab: StylePanelTab) => void
  resetRightPanel: () => void
}

/**
 * 默认折叠：进入一个没访问过的知识库时，右栏不该自己冒出空白页面。
 * 展开统一由文档图标 / 新建文档 / Ctrl+Tab / rightPanel.reveal 等显式路径触发；
 * 显式展开后的空状态是刻意保留的（里面有 pin / 解锁入口），不额外做「无选中即隐藏」。
 */
export const RIGHT_PANEL_INITIAL_STATE: RightPanelUiState = {
  rightPanelCollapsed: true,
  rightPanelMaximized: false,
  rightPanelPinned: false,
  rightPanelWidth: 600,
  rightPanelTab: 'detail',
  stylePanelTab: 'nodes',
}

function pickUi(state: RightPanelUiState): RightPanelUiState {
  return {
    rightPanelCollapsed: state.rightPanelCollapsed,
    rightPanelMaximized: state.rightPanelMaximized,
    rightPanelPinned: state.rightPanelPinned,
    rightPanelWidth: state.rightPanelWidth,
    rightPanelTab: state.rightPanelTab,
    stylePanelTab: state.stylePanelTab,
  }
}

/** 唯一的写入通道：镜像视图 + 当前知识库分桶一起更新，两者永不漂移。 */
function withUi(state: RightPanelStore, patch: Partial<RightPanelUiState>): Partial<RightPanelStore> {
  const nextUi: RightPanelUiState = { ...pickUi(state), ...patch }
  if (!state.activeKbPath) return nextUi
  return {
    ...nextUi,
    statesByKb: { ...state.statesByKb, [state.activeKbPath]: nextUi },
  }
}

export const useRightPanelStore = create<RightPanelStore>((set, get) => ({
  ...RIGHT_PANEL_INITIAL_STATE,
  activeKbPath: '',
  statesByKb: {},

  setActiveKbPath: (kbPath) => set((state) => {
    if (state.activeKbPath === kbPath) return state
    const nextUi = (kbPath && state.statesByKb[kbPath]) || RIGHT_PANEL_INITIAL_STATE
    return { ...nextUi, activeKbPath: kbPath }
  }),

  renameKbState: (oldKbPath, newKbPath) => {
    if (!oldKbPath || !newKbPath || oldKbPath === newKbPath) return
    set((state) => {
      const renamed = state.statesByKb[oldKbPath]
      if (!renamed) {
        return state.activeKbPath === oldKbPath ? { activeKbPath: newKbPath } : state
      }
      const { [oldKbPath]: _removed, ...rest } = state.statesByKb
      const next: Partial<RightPanelStore> = {
        statesByKb: { ...rest, [newKbPath]: renamed },
        activeKbPath: state.activeKbPath === oldKbPath ? newKbPath : state.activeKbPath,
      }
      // tabStore 的订阅可能已经先把作用域切到新路径：此时连镜像视图一起刷新，
      // 否则改名后当前帧会短暂显示成默认折叠态。
      if (state.activeKbPath === newKbPath) Object.assign(next, renamed)
      return next
    })
  },

  collapseRightPanel: () => {
    // pin 的语义是「始终展开」：标题栏 / 拖拽 / 双击 / 自动折叠统一在这里挡住。
    if (get().rightPanelPinned) return
    set((state) => withUi(state, { rightPanelCollapsed: true }))
  },
  expandRightPanel: () => set((state) => withUi(state, { rightPanelCollapsed: false })),
  toggleRightPanelMaximized: () => set((state) => withUi(state, {
    rightPanelMaximized: !state.rightPanelMaximized,
  })),
  // 固定即展开：按钮只在面板可见时可达，这里仍显式展开，避免样式面板等路径留下半折叠态。
  toggleRightPanelPinned: () => set((state) => withUi(state, {
    rightPanelPinned: !state.rightPanelPinned,
    rightPanelCollapsed: state.rightPanelPinned ? state.rightPanelCollapsed : false,
  })),
  applyRightPanelAutoVisibility: (hasDocument) => {
    if (get().rightPanelPinned) return
    set((state) => withUi(state, { rightPanelCollapsed: !hasDocument }))
  },
  setRightPanelWidth: (width) => set((state) => withUi(state, {
    rightPanelWidth: Math.max(RIGHT_PANEL_WIDTH_FLOOR, Math.round(width)),
  })),
  setRightPanelTab: (rightPanelTab) => set((state) => withUi(state, { rightPanelTab })),
  setStylePanelTab: (stylePanelTab) => set((state) => withUi(state, { stylePanelTab })),
  resetRightPanel: () => set({ ...RIGHT_PANEL_INITIAL_STATE, statesByKb: {}, activeKbPath: '' }),
}))

// P7 M3：右栏持久化状态变更自动补一条内存步骤（不落盘）。
attachStateObservation(useRightPanelStore, { name: 'rightPanel' })
