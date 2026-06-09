import { tabStore } from '../stores/tabs/tabStore'
import { useMonitorStore } from '../features/monitor/model/monitorStore'
import { useGraphUiStore } from '../stores/graphUiStore'
import { useRightPanelStore } from '../features/right-panel/model/rightPanelStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useCloudSyncEngineDebugStore } from '../application/cloud/syncEngineDebugStore'

export function resetClientSession() {
  useMonitorStore.getState().reset()
  useCloudSyncEngineDebugStore.getState().reset()
  tabStore.getState().reset()
  tabStore.getState().initHomeTab()
  useWorkspaceStore.getState().resetWorkspace()
  useRightPanelStore.getState().resetRightPanel()
  useGraphUiStore.getState().resetGraphUi()
}
