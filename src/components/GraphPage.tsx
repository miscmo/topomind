/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情+样式配置+Git面板
 */
import { memo } from 'react'
import { useAppStore } from '../stores/appStore'
import { useGraphPageController } from '../hooks/useGraphPageController'
import { useNodeActions } from '../hooks/useNodeActions'
import { useContextMenu } from '../hooks/useContextMenu'
import { useResizePanel } from '../hooks/useResizePanel'
import { useKeyboard } from '../hooks/useKeyboard'
import { GraphContextProvider } from '../contexts/GraphContext'
import Breadcrumb from './Breadcrumb/Breadcrumb'
import SearchBar from './SearchBar/SearchBar'
import GitPanel from './GitPanel/GitPanel'
import GraphRightPanel from './GraphRightPanel'
import GraphCanvas from './GraphCanvas'
import ContextMenu from './ContextMenu/ContextMenu'
import styles from './GraphPage.module.css'

interface GraphPageProps {
  tabId?: string
}

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  const { nav, graph, view } = useGraphPageController({ tabId })
  const rightPanelCollapsed = useAppStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth)
  const rightPanelTab = useAppStore((s) => s.rightPanelTab)
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth)
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)
  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: rightPanelWidth,
    onWidthChange: setRightPanelWidth,
    minWidth: 200,
    maxWidth: 800,
  })
  const { contextMenu, hideCM } = useContextMenu()
  const { deleteSelectedNode, addChildNode, handleNewChild, handleRename, handleDelete, handleEdgeDelete, handleEdgeStyle, handleFocus, handleProperties } = useNodeActions({ graph, tabId })

  useKeyboard({
    tabId,
    onDelete: () => {
      if (!nav.selectedNodeId) return
      deleteSelectedNode(nav.selectedNodeId)
    },
    onAddChild: (parentId: string) => {
      addChildNode(parentId)
    },
  })

  if (view !== 'graph') return null

  return (
    <GraphContextProvider graph={graph}>
      <div id="graph-page" className={styles.page}>
        <div id="app-layout" className={styles.layout}>
          <div id="graph-panel" className={styles.graphPanel}>
            <div id="header" className={styles.header}>TopoMind</div>
            <Breadcrumb tabId={tabId} />
            <SearchBar searchQuery={nav.searchQuery} onSearchChange={nav.setSearchQuery} />
            <GraphCanvas
              onEdgeContextMenu={(edgeId) => {
                if (rightPanelTab !== 'style') setRightPanelTab('style')
                useAppStore.getState().setSelectedEdgeId(edgeId)
              }}
            />
            <GitPanel />
          </div>
          {!rightPanelCollapsed && (
            <div
              className={`${styles.resizeHandle} ${isResizing ? styles.resizing : ''}`}
              onMouseDown={handleResizeMouseDown}
              title="拖拽调整宽度"
            />
          )}
          {!rightPanelCollapsed && (
            <GraphRightPanel
              selectedNodeId={nav.selectedNodeId}
              tabId={tabId}
              rightPanelTab={rightPanelTab}
              onTabChange={setRightPanelTab}
            />
          )}
        </div>
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          targetId={contextMenu.targetId}
          onNewChild={handleNewChild}
          onRename={handleRename}
          onDelete={handleDelete}
          onEdgeDelete={handleEdgeDelete}
          onEdgeStyle={handleEdgeStyle}
          onFocus={handleFocus}
          onProperties={handleProperties}
          onClose={hideCM}
        />
      </div>
    </GraphContextProvider>
  )
})
