/**
 * 工具栏组件
 * 缩放和视图控制
 */
import { memo, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { logAction } from '../../core/log-backend'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  zoomLevel: number
}

export default memo(function Toolbar({ zoomLevel }: ToolbarProps) {
  const { zoomIn, zoomOut } = useReactFlow()

  return (
    <div id="toolbar" className={styles.toolbar}>
      <button title="放大" onClick={() => { logAction('视图:放大', 'Toolbar', {}); zoomIn({ duration: 200 }) }}>+</button>
      <button title="缩小" onClick={() => { logAction('视图:缩小', 'Toolbar', {}); zoomOut({ duration: 200 }) }}>−</button>
      <div className={styles.zoomText} aria-label="缩放比例">{`${Math.round(zoomLevel * 100)}%`}</div>
    </div>
  )
})
