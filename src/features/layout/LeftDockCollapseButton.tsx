/**
 * 左栏页面标题栏的折叠入口。
 *
 * 四个 Dock 页各自把本按钮放在「删掉外壳冗余标题行之后」的新标题栏最右边：
 * 一个面板同时只渲染一个按钮，但三页共用同一份 collapsed 状态与同一个
 * localStorage key，不出现第二套开合状态。折叠后展开仍走 NavRail 竖 tab。
 */
import { PanelLeftClose } from 'lucide-react'
import { TM_UI } from '@/shared/ui/controlStyles'
import { useNodeTreePanelStore } from '@/stores/nodeTreePanelStore'

export default function LeftDockCollapseButton() {
  const collapseLeftDock = useNodeTreePanelStore((state) => state.collapseLeftDock)
  return (
    <button
      type="button"
      data-tm-left-dock-collapse=""
      title="折叠左侧栏"
      aria-label="折叠左侧栏"
      onClick={collapseLeftDock}
      className={TM_UI.iconButton}
    >
      <PanelLeftClose className="h-4 w-4" />
    </button>
  )
}
