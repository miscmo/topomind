// src/components/TabBar/TabBar.tsx
/**
 * Tab 栏组件 — 渲染所有 Tab，仅 tabs.length > 1 时显示
 */
import { memo } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { activateTab } from '../../core/tab-flow'
import styles from './TabBar.module.css'

interface TabBarProps {
  onCloseTab: (tabId: string) => void
}

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

export default memo(function TabBar({ onCloseTab }: TabBarProps) {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)

  // 处理 Tab 切换：纯恢复已保存状态，不重放 enterRoom 导航动作
  const handleTabClick = async (tab: Tab) => {
    if (tab.id === activeTabId) return
    await activateTab(tab.id)
  }

  // 有知识库 Tab 时才渲染（主页 Tab 本身不渲染 TabBar）
  if (tabs.length <= 1) return null

  return (
    <div className={styles.bar} role="tablist">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => handleTabClick(tab)}
          onClose={() => onCloseTab(tab.id)}
        />
      ))}
    </div>
  )
})