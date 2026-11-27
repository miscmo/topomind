/**
 * AI 设置窗口的开关状态（纯 UI 瞬态，不落盘）。
 *
 * 背景：AI 助手 / AI 智能体配置原先挂在全局设置页（独立 view tab），改一次就要
 * 切回画布才能试对话。现在两块设置整体迁入「画布页覆盖式 AI 设置窗口」：窗口
 * 从左栏对话页右缘铺到应用右边界，左侧对话保持可交互，因此可以边调边聊。
 *
 * 状态刻意不持久化：它是当前画布的临时工作面板，重启后不应自己弹出来挡住画布。
 * 窗口只挂在活跃知识库标签页的 #app-layout 内（见 GraphPage），所以多标签页
 * 常驻挂载时全局仍只有一份 DOM；切到全局设置页时随该标签页一起隐藏。
 *
 * 跨页入口（全局设置页的「打开 AI 设置」按钮）走 openAgentSettingsWindow()：
 * 它负责切回知识库 tab、确保左栏 AI Agent 页展开，再打开窗口，不在这里复制
 * tabStore / nodeTreePanelStore 的任何偏好真源。
 */
import { create } from 'zustand'
import { useNodeTreePanelStore } from '@/stores/nodeTreePanelStore'
import { useTabStore } from '@/stores/tabs/tabStore'

export type AiSettingsTabId = 'assistant' | 'agents'

export const AI_SETTINGS_TABS: ReadonlyArray<{ id: AiSettingsTabId; label: string }> = [
  { id: 'assistant', label: 'AI 助手' },
  { id: 'agents', label: 'AI 智能体' },
]

interface AgentSettingsWindowState {
  open: boolean
  activeTab: AiSettingsTabId
  openWindow: (tab?: AiSettingsTabId) => void
  closeWindow: () => void
  toggleWindow: (tab?: AiSettingsTabId) => void
  setActiveTab: (tab: AiSettingsTabId) => void
}

export const useAgentSettingsWindowStore = create<AgentSettingsWindowState>((set, get) => ({
  open: false,
  activeTab: 'assistant',

  openWindow: (tab) => set((state) => ({ open: true, activeTab: tab ?? state.activeTab })),
  closeWindow: () => set({ open: false }),
  toggleWindow: (tab) => {
    const state = get()
    if (state.open) {
      // 已打开时再次点击设置按钮：直接收起，不悄悄换 tab。
      set({ open: false })
      return
    }
    set({ open: true, activeTab: tab ?? state.activeTab })
  },
  setActiveTab: (tab) => set({ activeTab: tab }),
}))

/**
 * 全局入口：从任意页面（含全局设置页）回到画布并打开 AI 设置窗口。
 * setActivePanel 是 toggle 语义：只有「当前页不是 agent」或「左栏已折叠」时才调用，
 * 否则会把已经展开的对话页点收起。
 */
export function openAgentSettingsWindow(tab: AiSettingsTabId = 'assistant'): boolean {
  const tabState = useTabStore.getState()
  const kbTab = tabState.tabs.find((item) => item.type === 'kb' && item.id === tabState.activeTabId)
    ?? tabState.tabs.find((item) => item.type === 'kb')
  if (!kbTab) return false
  if (tabState.activeTabId !== kbTab.id) tabState.activateTab(kbTab.id)

  const dock = useNodeTreePanelStore.getState()
  if (dock.collapsed || dock.activePanelId !== 'agent') dock.setActivePanel('agent')

  useAgentSettingsWindowStore.getState().openWindow(tab)
  return true
}
