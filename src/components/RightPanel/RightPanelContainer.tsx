import { memo } from 'react'
import { useRightPanelStore } from '../../stores/rightPanelStore'
import { useResizePanel } from '../../hooks/useResizePanel'
import RightPanelShell from './RightPanelShell'

interface RightPanelContainerProps {
  tabId: string
}

export default memo(function RightPanelContainer({ tabId }: RightPanelContainerProps) {
  const collapsed = useRightPanelStore((s) => s.rightPanelCollapsed)
  const width = useRightPanelStore((s) => s.rightPanelWidth)
  const activeTab = useRightPanelStore((s) => s.rightPanelTab)
  const setWidth = useRightPanelStore((s) => s.setRightPanelWidth)
  const setActiveTab = useRightPanelStore((s) => s.setRightPanelTab)
  const collapse = useRightPanelStore((s) => s.collapseRightPanel)
  const expand = useRightPanelStore((s) => s.expandRightPanel)

  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: width,
    onWidthChange: setWidth,
    minWidth: 600,
    maxWidth: 1200,
  })

  if (collapsed) {
    return null
  }

  return (
    <>
      <div
        className="group w-1 h-full cursor-col-resize shrink-0 bg-transparent z-[20] relative select-none transition-colors"
        onMouseDown={handleResizeMouseDown}
        title="拖拽调整宽度"
      >
        <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px transition-colors group-hover:bg-[var(--color-accent)] group-active:bg-[var(--color-accent)] ${isResizing ? 'bg-[var(--color-accent)]' : 'bg-transparent'}`} />
      </div>
      <RightPanelShell
        tabId={tabId}
        rightPanelTab={activeTab}
        width={width}
        onTabChange={setActiveTab}
        onCollapse={collapse}
      />
    </>
  )
})
