import { memo } from 'react'
import DetailPanel from './components/DetailTab/DetailPanel'
import StyleSection from './components/StyleTab/StyleSection'
import type { RightPanelTab } from '../../types/uiStoreTypes'

interface RightPanelShellProps {
  tabId: string
  rightPanelTab: RightPanelTab
  width: number
  onTabChange: (tab: RightPanelTab) => void
  onCollapse: () => void
}

export default memo(function RightPanelShell({ tabId, rightPanelTab, width, onTabChange, onCollapse }: RightPanelShellProps) {
  return (
    <div className="h-full bg-white/90 dark:bg-[#1b2330]/90 backdrop-blur-xl shrink-0 overflow-hidden border-l border-[var(--color-border)] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] flex flex-col" style={{ width }}>
      {rightPanelTab === 'detail' ? (
        <DetailPanel tabId={tabId} />
      ) : (
        <StyleSection />
      )}
    </div>
  )
})
