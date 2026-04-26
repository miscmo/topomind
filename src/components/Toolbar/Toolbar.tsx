/**
 * 工具栏组件
 * 布局控制、缩放、网格切换等
 */
import { memo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { logAction } from '../../core/log-backend'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  zoomLevel: number
}

export default memo(function Toolbar({ zoomLevel }: ToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  return (
    <div id="toolbar" className={styles.toolbar}>
      <button title="适应视图" onClick={() => { logAction('视图:适应视图', 'Toolbar', {}); fitView({ padding: 0.2, duration: 300 }) }}>⊙</button>
      <button title="放大" onClick={() => { logAction('视图:放大', 'Toolbar', {}); zoomIn({ duration: 200 }) }}>+</button>
      <button title="缩小" onClick={() => { logAction('视图:缩小', 'Toolbar', {}); zoomOut({ duration: 200 }) }}>−</button>
      <div className={styles.zoomText} aria-label="缩放比例">{`${Math.round(zoomLevel * 100)}%`}</div>
    </div>
  )
})
