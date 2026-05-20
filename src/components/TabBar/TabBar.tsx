// src/components/TabBar/TabBar.tsx
/**
 * Tab 栏组件 — 渲染所有 Tab，仅 tabs.length > 1 时显示
 */
import { memo } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { logAction } from '../../core/log-backend'
import styles from './TabBar.module.css'

const TabItem = memo(function TabItem({ tab, isActive, onClick, onClose }: {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onClose: () => void
}) {
  return (
    <div
      className={`${styles.tab} ${isActive ? styles.active : ''} ${tab.id === 'home' ? styles.tabHome : ''}`}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ WebkitAppRegion: 'no-drag' } as any}
      role="tab"
      aria-selected={isActive}
      title={tab.label}
    >
      <span className={styles.tabLabel}>
        {tab.label}
      </span>
      {tab.id !== 'home' && (
        <button
          className={styles.closeBtn}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label={`关闭 ${tab.label}`}
        >
          ×
        </button>
      )}
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

  // 有知识库 Tab 时才渲染（主页 Tab 本身不渲染 TabBar）
  if (tabs.length <= 1) return null

  return (
    <div 
      className={styles.bar} 
      role="tablist"
      style={{ WebkitAppRegion: 'drag' } as any}
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