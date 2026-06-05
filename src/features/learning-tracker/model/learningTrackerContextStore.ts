import { create } from 'zustand'
import type { Tab } from '../../../stores/tabs/tabStore'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import type { RightPanelTab } from '../../../types/uiStoreTypes'
import { topoDocumentIdFromPath } from '../../documents/types/documentTypes'
import { useDetailPanelStore } from '../../right-panel/model/detailPanelStore'
import { useRightPanelStore } from '../../right-panel/model/rightPanelStore'

export type LearningPageType =
  | 'home'
  | 'kb'
  | 'graph'
  | 'document'
  | 'monitor'
  | 'statistics'
  | 'secondary-view'
  | 'setup'

export interface LearningSessionContext {
  pageType: LearningPageType
  tabId?: string
  tabType?: Tab['type']
  kbPath?: string
  roomPath?: string
  documentId?: string
  selectedNodeId?: string
  rightPanelTab?: RightPanelTab
}

interface LearningTrackerContextState {
  selectedNodeIdByTabId: Record<string, string | null>
  setSelectedNodeIdForTab: (tabId: string, nodeId: string | null) => void
  clearTabContext: (tabId: string) => void
}

export const useLearningTrackerContextStore = create<LearningTrackerContextState>((set) => ({
  selectedNodeIdByTabId: {},
  setSelectedNodeIdForTab: (tabId, nodeId) => {
    if (!tabId) return
    set((state) => ({
      selectedNodeIdByTabId: {
        ...state.selectedNodeIdByTabId,
        [tabId]: nodeId,
      },
    }))
  },
  clearTabContext: (tabId) => {
    if (!tabId) return
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.selectedNodeIdByTabId
      return { selectedNodeIdByTabId: rest }
    })
  },
}))

const resolveKbPageType = (
  roomPath: string,
  kbPath: string,
  selectedNodeId: string | null,
  rightPanelCollapsed: boolean,
  rightPanelTab: RightPanelTab,
  documentId: string | null,
): LearningPageType => {
  if (!rightPanelCollapsed && rightPanelTab === 'detail' && selectedNodeId && documentId) {
    return 'document'
  }
  if (roomPath === kbPath) {
    return 'kb'
  }
  return 'graph'
}

export const resolveLearningSessionContext = (): LearningSessionContext => {
  const { view } = useWorkspaceStore.getState()
  if (view === 'setup') {
    return { pageType: 'setup' }
  }

  const tabState = useTabStore.getState()
  const activeTab = tabState.getActiveTab()
  if (!activeTab) {
    return { pageType: 'home' }
  }

  if (activeTab.type === 'home') {
    return {
      pageType: 'home',
      tabId: activeTab.id,
      tabType: activeTab.type,
    }
  }

  if (activeTab.type === 'secondary-view') {
    const pageType =
      activeTab.viewId === 'monitor.logs'
        ? 'monitor'
        : activeTab.viewId === 'learning.statistics'
          ? 'statistics'
          : 'secondary-view'

    return {
      pageType,
      tabId: activeTab.id,
      tabType: activeTab.type,
    }
  }

  const graphSession = tabState.getGraphSession(activeTab.id)
  const selectedNodeId = useLearningTrackerContextStore.getState().selectedNodeIdByTabId[activeTab.id] ?? null
  const { rightPanelCollapsed, rightPanelTab } = useRightPanelStore.getState()
  const activeDocumentPath = selectedNodeId
    ? (useDetailPanelStore.getState().activeDocumentPathsByNodeId[selectedNodeId] ?? '')
    : ''
  const documentId = topoDocumentIdFromPath(activeDocumentPath)
  const kbPath = graphSession.kbPath || activeTab.kbPath
  const roomPath = graphSession.roomPath || activeTab.currentRoomPath || kbPath

  return {
    pageType: resolveKbPageType(roomPath, kbPath, selectedNodeId, rightPanelCollapsed, rightPanelTab, documentId),
    tabId: activeTab.id,
    tabType: activeTab.type,
    kbPath,
    roomPath,
    documentId: documentId || undefined,
    selectedNodeId: selectedNodeId || undefined,
    rightPanelTab,
  }
}
