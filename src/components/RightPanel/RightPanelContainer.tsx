import { memo } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useResizePanel } from '../../hooks/useResizePanel'
import RightPanelShell from './RightPanelShell'
import styles from './RightPanel.module.css'

interface RightPanelContainerProps {
  selectedNodeId: string | null
  tabId: string
}

export default memo(function RightPanelContainer({ selectedNodeId, tabId }: RightPanelContainerProps) {
  const collapsed = useAppStore((s) => s.rightPanelCollapsed)
  const width = useAppStore((s) => s.rightPanelWidth)
  const activeTab = useAppStore((s) => s.rightPanelTab)
  const setWidth = useAppStore((s) => s.setRightPanelWidth)
  const setActiveTab = useAppStore((s) => s.setRightPanelTab)
  const collapse = useAppStore((s) => s.collapseRightPanel)
  const expand = useAppStore((s) => s.expandRightPanel)

  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: width,
    onWidthChange: setWidth,
    minWidth: 400,
    maxWidth: 800,
  })

  if (collapsed) {
    return (
      <button
        className={styles.panelExpandBtn}
        onClick={expand}
        title="展开右侧面板"
      >
        ‹
      </button>
    )
  }

  return (
    <>
      <div
        className={`${styles.resizeHandle} ${isResizing ? styles.resizing : ''}`}
        onMouseDown={handleResizeMouseDown}
        title="拖拽调整宽度"
      />
      <RightPanelShell
        selectedNodeId={selectedNodeId}
        tabId={tabId}
        rightPanelTab={activeTab}
        width={width}
        onTabChange={setActiveTab}
        onCollapse={collapse}
      />
    </>
  )
})
