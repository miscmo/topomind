import { tabStore } from '../stores/tabStore'
import { useMonitorStore } from '../stores/monitorStore'
import { useGraphUiStore } from '../stores/graphUiStore'
import { useRightPanelStore } from '../stores/rightPanelStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

export function resetClientSession() {
  useMonitorStore.getState().reset()
  tabStore.getState().reset()
  tabStore.getState().initHomeTab()
  useWorkspaceStore.getState().resetWorkspace()
  useRightPanelStore.getState().resetRightPanel()
  useGraphUiStore.getState().resetGraphUi()
}
