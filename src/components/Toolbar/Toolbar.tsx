/**
 * 工具栏组件
 * 布局控制、缩放、网格切换等
 */
import { memo } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useGraphContext } from '../../contexts/GraphContext'
import { useReactFlow } from '@xyflow/react'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  showGrid: boolean
  onToggleGrid: () => void
}

export default memo(function Toolbar({ showGrid, onToggleGrid }: ToolbarProps) {
  const showGitPanel = useAppStore((s) => s.showGitPanel)
  const toggleGitPanel = useAppStore((s) => s.toggleGitPanel)
  const edgeMode = useAppStore((s) => s.edgeMode)
  const exitEdgeMode = useAppStore((s) => s.exitEdgeMode)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const enterEdgeMode = useAppStore((s) => s.enterEdgeMode)
  const graph = useGraphContext()
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const handleReset = () => {
    fitView({ padding: 0.15, duration: 300 })
  }

  return (
    <div id="toolbar" className={styles.toolbar}>
      {/* 重置视图 */}
      <button title="重置视图（恢复默认缩放和位置）" onClick={handleReset}>
        ↺ 重置
      </button>

      <div className={styles.sep} />

      {/* 连线模式 */}
      <button
        className={edgeMode ? styles.active : ''}
        title="连线模式（Tab 切换）"
        onClick={() => {
          if (edgeMode) {
            exitEdgeMode()
          } else if (selectedNodeId) {
            enterEdgeMode(selectedNodeId)
          }
        }}
        style={edgeMode ? { color: '#e67e22', fontWeight: 700 } : {}}
      >
        🔗 连线
      </button>

      <div className={styles.sep} />

      {/* 缩放 */}
      <button title="放大" onClick={() => zoomIn({ duration: 200 })}>+</button>
      <button title="缩小" onClick={() => zoomOut({ duration: 200 })}>−</button>
      <button title="适应视图" onClick={() => fitView({ padding: 0.1, duration: 200 })}>
        ⊡
      </button>

      <div className={styles.sep} />

      {/* 网格 */}
      <button
        className={showGrid ? styles.active : ''}
        title={showGrid ? '隐藏网格' : '显示网格'}
        onClick={onToggleGrid}
      >
        #格
      </button>

      {/* Git 面板 */}
      <button
        className={showGitPanel ? styles.active : ''}
        title="Git 面板"
        onClick={toggleGitPanel}
      >
        Git
      </button>
    </div>
  )
})
