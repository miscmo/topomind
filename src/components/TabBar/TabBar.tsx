// src/components/TabBar/TabBar.tsx
/**
 * Tab 栏组件 — 渲染所有 Tab，仅 tabs.length > 1 时显示
 */
import { memo } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { logAction } from '../../core/log-backend'

const TabItem = memo(function TabItem({ tab, isActive, onClick, onClose }: {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onClose: () => void
}) {
  return (
    <div
      className={`group flex items-center justify-center gap-0 h-[28px] px-1.5 cursor-pointer text-[12px] transition-all relative select-none w-[110px] shrink-0 mt-auto ${
        isActive 
          ? 'bg-[var(--color-surface)] text-[var(--color-primary)] font-medium rounded-t-lg border-t border-x border-[var(--color-border-subtle)] z-10 translate-y-[1px]' 
          : 'text-[var(--titlebar-muted)] bg-transparent border-t border-x border-transparent hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)] rounded-t-lg'
      }`}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ WebkitAppRegion: 'no-drag' } as any}
      role="tab"
      aria-selected={isActive}
      title={tab.label}
    >
      {/* 底部遮盖线，用于掩盖父级的底边框，实现无缝融合 */}
      {isActive && (
        <div className="absolute -bottom-[2px] left-0 right-0 h-[3px] bg-[var(--color-surface)] pointer-events-none" />
      )}
      <div className={`flex-1 min-w-0 flex items-center justify-center relative z-10 h-full pl-[4px] ${tab.id !== 'home' ? 'pr-[20px]' : 'pr-[4px]'} transition-opacity duration-150 pointer-events-none`}>
        <span className="truncate tracking-wide text-center max-w-full">
          {tab.label}
        </span>
      </div>
      {tab.id !== 'home' ? (
        <div className="absolute right-[4px] top-1/2 -translate-y-1/2 z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <button
            className="w-[18px] h-[18px] rounded-[4px] border-none bg-transparent cursor-pointer flex items-center justify-center text-[var(--color-text-muted)] p-0 leading-none shrink-0 pointer-events-auto hover:bg-[#e81123] hover:text-white transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label={`关闭 ${tab.label}`}
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  )
})

export default memo(function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)

  const handleCloseTab = (tabId: string) => {
    const tab = useTabStore.getState().closeTab(tabId)
    if (!tab) return
    logAction('Tab:关闭', 'TabBar', { tab })
  }

  // 处理 Tab 切换：纯恢复已保存状态，不重放 enterRoom 导航动作
  const handleTabClick = async (tab: Tab) => {
    if (tab.id === activeTabId) return
    activateTab(tab.id)
    logAction('切换Tab', 'TabBar', { tabId: tab.id, tabLabel: tab.label })
  }

  // 无论有多少个 Tab，都渲染 TabBar 占位，保持顶部视觉平衡
  // if (tabs.length <= 1) return null

  return (
    <div 
      className="flex items-end h-full px-1 gap-1 shrink-0 w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-[var(--titlebar-bg-unfocused)] relative -bottom-[1px] z-10 border-x border-[var(--color-border-subtle)] shadow-[inset_0_0_2px_rgba(0,0,0,0.02)]" 
      role="tablist"
      style={{ WebkitAppRegion: 'no-drag' } as any}
      onWheel={(e) => {
        // Convert vertical scroll to horizontal scroll
        if (e.deltaY !== 0) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => handleTabClick(tab)}
          onClose={() => handleCloseTab(tab.id)}
        />
      ))}
    </div>
  )
})