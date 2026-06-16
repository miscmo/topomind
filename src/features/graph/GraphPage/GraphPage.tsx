/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情和样式配置
 */
import { memo, useEffect } from 'react'
import { GraphContextProvider } from '../../../contexts/GraphContext'
import { useSelectedNodeId } from '../../../stores/graphStore'
import Breadcrumb from '../../layout/Breadcrumb/Breadcrumb'
import { useLearningTrackerContextStore } from '../../learning-tracker/model/learningTrackerContextStore'
import RightPanelContainer from '../../right-panel/RightPanelContainer'
import GraphCanvas from '../GraphCanvas'
import GraphPageContextMenu from './components/GraphPageContextMenu'
import { useGraphPageController } from './model/useGraphPageController'
import { useGraphPageActions } from './model/useGraphPageActions'
import { useShortcut } from '../../../hooks/useShortcut'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useRightPanelStore } from '../../right-panel/model/rightPanelStore'

interface GraphPageProps {
  tabId: string
}

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  const { graphSession, graph } = useGraphPageController({ tabId })
  const { canvasProps, contextMenuProps } = useGraphPageActions({ graph })
  const selectedNodeId = useSelectedNodeId()
  const setSelectedNodeIdForTab = useLearningTrackerContextStore((s) => s.setSelectedNodeIdForTab)
  const clearTabContext = useLearningTrackerContextStore((s) => s.clearTabContext)
  const activeTabId = useTabStore((s) => s.activeTabId)

  useShortcut(['Control+Tab', 'Meta+Tab'], (event) => {
    if (activeTabId !== tabId) return
    event.preventDefault()
    const { rightPanelCollapsed, collapseRightPanel, expandRightPanel } = useRightPanelStore.getState()
    if (rightPanelCollapsed) {
      expandRightPanel()
    } else {
      collapseRightPanel()
    }
  }, { scope: 'global', preventDefault: true, enableInInput: true })

  useEffect(() => {
    setSelectedNodeIdForTab(tabId, selectedNodeId)
  }, [tabId, selectedNodeId, setSelectedNodeIdForTab])

  useEffect(() => {
    return () => {
      clearTabContext(tabId)
    }
  }, [tabId, clearTabContext])

  return (
    <GraphContextProvider graph={graph}>
      <div id="graph-page" className="w-full h-full overflow-hidden bg-[var(--color-canvas-bg)] pt-0">
        <div id="app-layout" className="flex w-full h-full relative">
          <div id="graph-panel" className="flex-1 h-full relative overflow-hidden bg-[var(--color-canvas-bg)]">
            <Breadcrumb tabId={tabId} />

            <GraphCanvas tabId={tabId} {...canvasProps} />
          </div>
          <RightPanelContainer tabId={tabId} />
        </div>
        <GraphPageContextMenu {...contextMenuProps} />
      </div>
    </GraphContextProvider>
  )
})
