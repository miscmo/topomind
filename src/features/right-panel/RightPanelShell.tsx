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

export default memo(function RightPanelShell({ tabId, rightPanelTab, width, onTabChange, onCollapse, isActive = true }: RightPanelShellProps) {
  return (
    <div className="h-full bg-[var(--titlebar-menu-bg)] backdrop-blur-xl shrink-0 overflow-hidden border-l border-[var(--color-border)] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] flex flex-col" style={{ width }}>
      <div className={rightPanelTab === 'detail' ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={rightPanelTab !== 'detail'}>
        <DetailPanel tabId={tabId} isActive={isActive && rightPanelTab === 'detail'} />
      </div>
      {rightPanelTab === 'style' && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <StyleSection />
        </div>
      )}
    </div>
  )
})
