// src/components/TabBar/TabBar.tsx
/**
 * Tab 栏组件 — 渲染所有 Tab，仅 tabs.length > 1 时显示
 */
import { memo } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { useAppStore } from '../../stores/appStore'
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
        {tab.isDirty && <span className={styles.tabDirty}> •</span>}
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
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const showHome = useAppStore((s) => s.showHome)

  // 仅有一个 Tab（主页）时不渲染
  if (tabs.length <= 1) return null

  return (
    <div className={styles.bar} role="tablist">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => {
            setActiveTab(tab.id)
            if (tab.id === 'home') {
              showHome()
            }
          }}
          onClose={() => onCloseTab(tab.id)}
        />
      ))}
    </div>
  )
})