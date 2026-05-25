/**
 * 工具栏组件
 * 缩放和视图控制
 */
import { memo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { logAction } from '../../core/log-backend'

interface ToolbarProps {
  zoomLevel: number
}

export default memo(function Toolbar({ zoomLevel }: ToolbarProps) {
  const { zoomIn, zoomOut } = useReactFlow()

  return (
    <div id="toolbar" className="absolute bottom-3 left-3 z-10 flex items-center gap-1 bg-white/90 dark:bg-[#1b2330]/90 border border-[var(--color-border)] rounded-xl p-1.5 backdrop-blur-xl shadow-[var(--shadow-md)]">
      <button className="h-8 w-8 flex items-center justify-center border-none rounded-md bg-transparent cursor-pointer text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-hover-bg)]" title="放大" onClick={() => { logAction('视图:放大', 'Toolbar', {}); zoomIn({ duration: 200 }) }}><ZoomIn className="w-4 h-4 text-[var(--color-text-muted)]" /></button>
      <button className="h-8 w-8 flex items-center justify-center border-none rounded-md bg-transparent cursor-pointer text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-hover-bg)]" title="缩小" onClick={() => { logAction('视图:缩小', 'Toolbar', {}); zoomOut({ duration: 200 }) }}><ZoomOut className="w-4 h-4 text-[var(--color-text-muted)]" /></button>
      <div className="min-w-[52px] h-8 flex items-center justify-center px-2 border-none rounded-md bg-transparent text-[var(--color-text-primary)] text-[13px] font-medium" aria-label="缩放比例">{`${Math.round(zoomLevel * 100)}%`}</div>
    </div>
  )
})
