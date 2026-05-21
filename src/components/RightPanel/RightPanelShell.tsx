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
      <div className="flex items-center justify-start pt-2.5 px-3 gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        <div className="flex gap-2">
          <button
            className={`h-8 px-3.5 border-none border-b-2 bg-transparent text-[13px] cursor-pointer ${rightPanelTab === 'detail' ? 'text-[var(--color-primary)] border-b-[var(--color-primary)] font-semibold' : 'text-[var(--color-text-muted)] border-transparent'}`}
            onClick={() => onTabChange('detail')}
          >
            详情
          </button>
          <button
            className={`h-8 px-3.5 border-none border-b-2 bg-transparent text-[13px] cursor-pointer ${rightPanelTab === 'style' ? 'text-[var(--color-primary)] border-b-[var(--color-primary)] font-semibold' : 'text-[var(--color-text-muted)] border-transparent'}`}
            onClick={() => onTabChange('style')}
          >
            样式
          </button>
        </div>
      </div>
      {rightPanelTab === 'detail' ? (
        <DetailPanel tabId={tabId} />
      ) : (
        <StyleSection />
      )}
    </div>
  )
})
