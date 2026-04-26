/**
 * 工具栏组件
 * 搜索、布局控制、缩放等
 */
import { memo, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { logAction } from '../../core/log-backend'
import { useAppStore } from '../../stores/appStore'
import { tabStore } from '../../stores/tabStore'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  tabId?: string
  zoomLevel: number
}

export default memo(function Toolbar({ tabId, zoomLevel }: ToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  // Subscribe to searchQuery reactively so the input stays in sync
  const searchQuery = useAppStore((s) => s.searchQuery)

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    if (tabId) {
      tabStore.getState().setTabSearchQuery(tabId, query)
    } else {
      useAppStore.getState().setSearchQuery(query)
    }
    logAction('搜索:输入', 'Toolbar', { query })
  }, [tabId])

  const handleSearchClear = useCallback(() => {
    if (tabId) {
      tabStore.getState().setTabSearchQuery(tabId, '')
    } else {
      useAppStore.getState().setSearchQuery('')
    }
    logAction('搜索:清除', 'Toolbar', {})
  }, [tabId])

  return (
    <div id="toolbar" className={styles.toolbar}>
      <div className={styles.searchWrapper}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="搜索节点..."
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="搜索节点"
        />
        {searchQuery && (
          <button
            className={styles.searchClear}
            onClick={handleSearchClear}
            title="清除搜索"
            aria-label="清除搜索"
          >
            ✕
          </button>
        )}
      </div>
      <button title="适应视图" onClick={() => { logAction('视图:适应视图', 'Toolbar', {}); fitView({ padding: 0.2, duration: 300 }) }}>⊙</button>
      <button title="放大" onClick={() => { logAction('视图:放大', 'Toolbar', {}); zoomIn({ duration: 200 }) }}>+</button>
      <button title="缩小" onClick={() => { logAction('视图:缩小', 'Toolbar', {}); zoomOut({ duration: 200 }) }}>−</button>
      <div className={styles.zoomText} aria-label="缩放比例">{`${Math.round(zoomLevel * 100)}%`}</div>
    </div>
  )
})
