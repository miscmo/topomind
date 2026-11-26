import { tabStore } from '../stores/tabs/tabStore'
import { useMonitorStore } from '../plugins/public/monitorStore'
import { useGraphUiStore } from '../stores/graphUiStore'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useAgentSessionListStore } from '@/features/ai-agent/model/agentSessionListStore'

export function resetClientSession() {
  useMonitorStore.getState().reset()
  tabStore.getState().reset()
  tabStore.getState().initHomeTab()
  useWorkspaceStore.getState().resetWorkspace()
  useRightPanelStore.getState().resetRightPanel()
  useGraphUiStore.getState().resetGraphUi()
  // P4-S：历史会话按工作目录隔离，切换 / 退出时清空内存镜像与在途写盘。
  useAgentSessionListStore.getState().resetForWorkspace()
}
