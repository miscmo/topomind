/**
 * 工具栏组件
 * 缩放和视图控制
 */
import { memo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { logAction } from '../../core/log-backend'

interface ToolbarProps {
  zoomLevel: number
}

export default memo(function Toolbar({ zoomLevel }: ToolbarProps) {
  const { zoomIn, zoomOut } = useReactFlow()

  return (
    <div id="toolbar" className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] border border-[var(--color-border)] rounded-lg py-1 px-2 backdrop-blur-[6px] shadow-[var(--shadow-md)]">
      <button className="h-7 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] cursor-pointer text-[11px] text-[var(--color-text-secondary)] px-2.5 transition-colors whitespace-nowrap hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)]" title="放大" onClick={() => { logAction('视图:放大', 'Toolbar', {}); zoomIn({ duration: 200 }) }}>+</button>
      <button className="h-7 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] cursor-pointer text-[11px] text-[var(--color-text-secondary)] px-2.5 transition-colors whitespace-nowrap hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-primary)]" title="缩小" onClick={() => { logAction('视图:缩小', 'Toolbar', {}); zoomOut({ duration: 200 }) }}>−</button>
      <div className="min-w-[52px] h-7 flex items-center justify-center px-2.5 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-secondary)] text-xs font-semibold" aria-label="缩放比例">{`${Math.round(zoomLevel * 100)}%`}</div>
    </div>
  )
})
