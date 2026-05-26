import { memo, useCallback, useState } from 'react'
import { useRightPanelStore } from '../../stores/rightPanelStore'
import { useResizePanel } from '../../hooks/useResizePanel'
import RightPanelShell from './RightPanelShell'

interface RightPanelContainerProps {
  tabId: string
}

const RIGHT_PANEL_MIN_WIDTH = 600
const RIGHT_PANEL_MAX_WIDTH = 1200

export default memo(function RightPanelContainer({ tabId }: RightPanelContainerProps) {
  const collapsed = useRightPanelStore((s) => s.rightPanelCollapsed)
  const width = useRightPanelStore((s) => s.rightPanelWidth)
  const activeTab = useRightPanelStore((s) => s.rightPanelTab)
  const setWidth = useRightPanelStore((s) => s.setRightPanelWidth)
  const setActiveTab = useRightPanelStore((s) => s.setRightPanelTab)
  const collapse = useRightPanelStore((s) => s.collapseRightPanel)
  const [willAutoCollapse, setWillAutoCollapse] = useState(false)
  const autoCollapseThreshold = Math.floor(width / 2)

  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: width,
    onWidthChange: setWidth,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    onResizeChange: ({ rawWidth }) => {
      setWillAutoCollapse(rawWidth <= autoCollapseThreshold)
    },
    onResizeEnd: ({ rawWidth, width: nextWidth }) => {
      setWillAutoCollapse(false)
      if (rawWidth <= autoCollapseThreshold) {
        collapse()
        return
      }
      setWidth(nextWidth)
    },
  })

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setWillAutoCollapse(false)
    handleResizeMouseDown(event)
  }, [handleResizeMouseDown])

  const handleResizeDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setWillAutoCollapse(false)
    collapse()
  }, [collapse])

  if (collapsed) {
    return null
  }

  return (
    <div className="relative flex h-full shrink-0 right-panel-container">
      {willAutoCollapse && isResizing && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-[22] w-[3px] bg-[var(--color-accent)] shadow-[-10px_0_20px_rgba(59,130,246,0.22)]" />
          <div className="pointer-events-none absolute right-3 top-3 z-[23] rounded-full border border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--color-surface))] px-2.5 py-1 text-[11px] font-medium text-[var(--color-accent)] shadow-[var(--shadow-sm)]">
            松开折叠
          </div>
        </>
      )}
      <div
        className="group w-1 h-full cursor-col-resize shrink-0 bg-transparent z-[20] relative select-none transition-colors"
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResizeDoubleClick}
        title="拖拽调整宽度，拖到当前宽度一半或双击可折叠"
      >
        <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px transition-colors group-hover:bg-[var(--color-accent)] group-active:bg-[var(--color-accent)] ${isResizing ? 'bg-[var(--color-accent)]' : 'bg-transparent'} ${willAutoCollapse ? 'bg-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent-soft)]' : ''}`} />
      </div>
      <RightPanelShell
        tabId={tabId}
        rightPanelTab={activeTab}
        width={width}
        onTabChange={setActiveTab}
        onCollapse={collapse}
      />
    </div>
  )
})
