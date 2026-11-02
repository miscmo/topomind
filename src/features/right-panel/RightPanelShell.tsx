import { memo } from 'react'
import DetailPanel from './components/DetailTab/DetailPanel'
import StyleSection from './components/StyleTab/StyleSection'
import type { RightPanelTab } from '../../types/uiStoreTypes'

interface RightPanelShellProps {
  tabId: string
  rightPanelTab: RightPanelTab
  width: number | string
  onTabChange: (tab: RightPanelTab) => void
  onCollapse: () => void
  isActive?: boolean
}

export default memo(function RightPanelShell({ tabId, rightPanelTab, width, isActive = true }: RightPanelShellProps) {
  return (
    <div className="h-full bg-[var(--titlebar-menu-bg)] shrink-0 overflow-hidden border-l border-[var(--color-border)] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] flex flex-col transform-gpu" style={{ width }}>
      <div className={rightPanelTab === 'detail' ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={rightPanelTab !== 'detail'}>
        <DetailPanel tabId={tabId} isActive={isActive && rightPanelTab === 'detail'} />
      </div>
      <div className={rightPanelTab === 'style' ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={rightPanelTab !== 'style'}>
        {/* 两个 Tab 都用 CSS 隐藏常驻挂载（不能卸载，否则会丢面板内部状态）。
            但常驻意味着隐藏的那个也会跟着订阅重渲染，所以把可见性透传下去，
            让它在不可见时不去订阅选中态 —— 否则框选时每帧都会重渲染一整块面板。 */}
        <StyleSection active={rightPanelTab === 'style'} />
      </div>
    </div>
  )
})
