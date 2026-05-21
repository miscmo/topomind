import { memo } from 'react'
import DetailPanel from './DetailTab/DetailPanel'
import StyleSection from './StyleTab/StyleSection'
import type { RightPanelTab } from '../../stores/uiStoreTypes'

interface RightPanelShellProps {
  tabId: string
  rightPanelTab: RightPanelTab
  width: number
  onTabChange: (tab: RightPanelTab) => void
  onCollapse: () => void
}

export default memo(function RightPanelShell({ tabId, rightPanelTab, width, onTabChange, onCollapse }: RightPanelShellProps) {
  return (
    <div className="h-full bg-[var(--color-surface)] shrink-0 overflow-hidden border-none shadow-[-1px_0_10px_rgba(0,0,0,0.03)] flex flex-col" style={{ width }}>
      {rightPanelTab === 'detail' ? (
        <DetailPanel tabId={tabId} />
      ) : (
        <StyleSection />
      )}
    </div>
  )
})
