import { memo } from 'react'
import DetailPanel from './DetailPanel/DetailPanel'
import StyleSection from './DetailPanel/StyleSection'
import styles from './GraphPage.module.css'

interface GraphRightPanelProps {
  selectedNodeId: string | null
  tabId?: string
  rightPanelTab: 'detail' | 'style'
  onTabChange: (tab: 'detail' | 'style') => void
}

export default memo(function GraphRightPanel({ selectedNodeId, tabId, rightPanelTab, onTabChange }: GraphRightPanelProps) {
  return (
    <div className={styles.rightPanel}>
      <div className={styles.rightPanelTabs}>
        <button
          className={`${styles.rightPanelTabBtn} ${rightPanelTab === 'detail' ? styles.rightPanelTabBtnActive : ''}`}
          onClick={() => onTabChange('detail')}
        >
          详情
        </button>
        <button
          className={`${styles.rightPanelTabBtn} ${rightPanelTab === 'style' ? styles.rightPanelTabBtnActive : ''}`}
          onClick={() => onTabChange('style')}
        >
          样式
        </button>
      </div>
      {rightPanelTab === 'detail' ? (
        <DetailPanel selectedNodeId={selectedNodeId} tabId={tabId} />
      ) : (
        <StyleSection />
      )}
    </div>
  )
})
