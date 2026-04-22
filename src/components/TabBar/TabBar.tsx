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
  const getRoomStateFromTab = useTabStore((s) => s.getRoomStateFromTab)
  const restoreRoomStateToTab = useTabStore((s) => s.restoreRoomStateToTab)
  const showHome = useAppStore((s) => s.showHome)

  // 处理 Tab 切换：纯恢复已保存状态，不重放 enterRoom 导航动作
  const handleTabClick = (tab: Tab) => {
    if (tab.id === activeTabId) return

    if (tab.id === 'home') {
      showHome()
      setActiveTab(tab.id)
      return
    }

    if (tab.type === 'kb' && tab.kbPath) {
      const roomState = getRoomStateFromTab(tab.id)
      restoreRoomStateToTab(tab.id, {
        kbPath: tab.kbPath,
        roomHistory: roomState?.roomHistory ?? [],
        currentRoomPath: roomState?.currentRoomPath ?? tab.kbPath,
        currentRoomName: roomState?.currentRoomName || tab.label,
      })
    }

    setActiveTab(tab.id)
  }

  // 仅有一个 Tab（主页）时不渲染
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