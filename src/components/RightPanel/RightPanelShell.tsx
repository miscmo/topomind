import { memo } from 'react'
import CardPanel from './CardTab/CardPanel'
import DetailPanel from './DetailTab/DetailPanel'
import StyleSection from './StyleTab/StyleSection'
import type { RightPanelTab } from '../../stores/uiStoreTypes'
import styles from './RightPanel.module.css'

interface RightPanelShellProps {
  tabId: string
  rightPanelTab: RightPanelTab
  width: number
  onTabChange: (tab: RightPanelTab) => void
  onCollapse: () => void
}

export default memo(function RightPanelShell({ tabId, rightPanelTab, width, onTabChange, onCollapse }: RightPanelShellProps) {
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
            className={`${styles.rightPanelTabBtn} ${rightPanelTab === 'card' ? styles.rightPanelTabBtnActive : ''}`}
            onClick={() => onTabChange('card')}
          >
            卡片
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
        <DetailPanel tabId={tabId} />
      ) : rightPanelTab === 'card' ? (
        <CardPanel tabId={tabId} />
      ) : (
        <StyleSection />
      )}
    </div>
  )
})
