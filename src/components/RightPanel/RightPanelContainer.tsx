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
    return (
      <button
        className="absolute top-3 right-3 z-30 w-7 h-7 inline-flex items-center justify-center p-0 border border-[var(--color-border)] rounded-md bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] text-[var(--color-text-muted)] text-lg leading-none cursor-pointer transition-colors shadow-[var(--shadow-md)] hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-primary)]"
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
