import { create } from 'zustand'
import type { Tab } from '../../../stores/tabs/tabStore'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import type { RightPanelTab } from '../../../types/uiStoreTypes'
import { topoDocumentIdFromKey } from '../../documents/types/documentTypes'
import { useDetailPanelStore } from '../../right-panel/model/detailPanelStore'
import { useRightPanelStore } from '../../right-panel/model/rightPanelStore'

export type LearningPageType =
  | 'home'
  | 'kb'
  | 'graph'
  | 'document'
  | 'monitor'
  | 'statistics'
  | 'setup'

export interface LearningSessionContext {
  pageType: LearningPageType
  tabId?: string
  tabType?: Tab['type']
  kbId?: string
  roomId?: string
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
  roomId: string,
  kbId: string,
  selectedNodeId: string | null,
  rightPanelCollapsed: boolean,
  rightPanelTab: RightPanelTab,
  documentId: string | null,
): LearningPageType => {
  if (!rightPanelCollapsed && rightPanelTab === 'detail' && selectedNodeId && documentId) {
    return 'document'
  }
  if (roomId && kbId && roomId === kbId) {
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

  if (activeTab.type === 'monitor') {
    return {
      pageType: 'monitor',
      tabId: activeTab.id,
      tabType: activeTab.type,
    }
  }

  if (activeTab.type === 'statistics') {
    return {
      pageType: 'statistics',
      tabId: activeTab.id,
      tabType: activeTab.type,
    }
  }

  const graphSession = tabState.getGraphSession(activeTab.id)
  const selectedNodeId = useLearningTrackerContextStore.getState().selectedNodeIdByTabId[activeTab.id] ?? null
  const { rightPanelCollapsed, rightPanelTab } = useRightPanelStore.getState()
  const activeDocumentKey = selectedNodeId
    ? (useDetailPanelStore.getState().activeDocumentKeysByNodeId[selectedNodeId] ?? '')
    : ''
  const documentId = topoDocumentIdFromKey(activeDocumentKey)
  const kbId = graphSession.kbId || activeTab.kbId
  const roomId = graphSession.roomId || activeTab.currentRoomId || kbId

  return {
    pageType: resolveKbPageType(roomId, kbId, selectedNodeId, rightPanelCollapsed, rightPanelTab, documentId),
    tabId: activeTab.id,
    tabType: activeTab.type,
    kbId,
    roomId,
    documentId: documentId || undefined,
    selectedNodeId: selectedNodeId || undefined,
    rightPanelTab,
  }
}
