/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情和样式配置
 */
import { memo } from 'react'
import { GraphContextProvider } from '../../contexts/GraphContext'
import Breadcrumb from '../Breadcrumb/Breadcrumb'
import RightPanelContainer from '../RightPanel/RightPanelContainer'
import GraphCanvas from '../GraphCanvas'
import GraphPageContextMenu from './GraphPageContextMenu'
import { useGraphPageController } from './useGraphPageController'
import { useGraphPageActions } from './useGraphPageActions'
import styles from './GraphPage.module.css'

interface GraphPageProps {
  tabId: string
}

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  const { graphSession, graph } = useGraphPageController({ tabId })
  const { canvasProps, contextMenuProps } = useGraphPageActions({ graph })

  return (
    <GraphContextProvider graph={graph}>
      <div id="graph-page" className={styles.page}>
        <div id="app-layout" className={styles.layout}>
          <div id="graph-panel" className={styles.graphPanel}>
            <Breadcrumb tabId={tabId} />

            <GraphCanvas tabId={tabId} {...canvasProps} />
          </div>
          <RightPanelContainer tabId={tabId} />
        </div>
        <GraphPageContextMenu {...contextMenuProps} />
      </div>
    </GraphContextProvider>
  )
})
