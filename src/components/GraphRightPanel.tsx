import { memo } from 'react'
import DetailPanel from './DetailPanel/DetailPanel'
import StyleSection from './DetailPanel/StyleSection'
import styles from './GraphPage.module.css'

interface GraphRightPanelProps {
  selectedNodeId: string | null
  tabId: string
  rightPanelTab: 'detail' | 'style'
  width: number
  onTabChange: (tab: 'detail' | 'style') => void
  onCollapse: () => void
}

export default memo(function GraphRightPanel({ selectedNodeId, tabId, rightPanelTab, width, onTabChange, onCollapse }: GraphRightPanelProps) {
  return (
    <div className={styles.rightPanel} style={{ width }}>
      <div className={styles.rightPanelTabs}>
        <div className={styles.rightPanelTabGroup}>
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
        <button className={styles.panelToggleBtn} onClick={onCollapse} title="折叠右侧面板">
          ›
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
