import { memo } from 'react'
import DetailPanel from './components/DetailTab/DetailPanel'
import StyleSection from './components/StyleTab/StyleSection'
import type { RightPanelTab } from '../../types/uiStoreTypes'

interface RightPanelShellProps {
  tabId: string
  readOnly?: boolean
  rightPanelTab: RightPanelTab
  width: number
  onTabChange: (tab: RightPanelTab) => void
  onCollapse: () => void
}

export default memo(function RightPanelShell({ tabId, readOnly = false, rightPanelTab, width, onTabChange, onCollapse }: RightPanelShellProps) {
  const effectiveTab: RightPanelTab = readOnly ? 'detail' : rightPanelTab

  return (
    <div className="h-full bg-[var(--titlebar-menu-bg)] backdrop-blur-xl shrink-0 overflow-hidden border-l border-[var(--color-border)] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] flex flex-col" style={{ width }}>
      <div className={effectiveTab === 'detail' ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={effectiveTab !== 'detail'}>
        <DetailPanel tabId={tabId} />
      </div>
      <div className={!readOnly && effectiveTab === 'style' ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={effectiveTab !== 'style'}>
        <StyleSection />
      </div>
    </div>
  )
})
