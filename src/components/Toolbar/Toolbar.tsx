/**
 * 工具栏组件
 * 布局控制、缩放、网格切换等
 */
import { useAppStore } from '../../stores/appStore'
import { useGraph } from '../../hooks/useGraph'
import { useReactFlow } from '@xyflow/react'
import styles from './Toolbar.module.css'

export default function Toolbar() {
  const showGrid = useAppStore((s) => s.showGrid)
  const toggleGrid = useAppStore((s) => s.toggleGrid)
  const showGitPanel = useAppStore((s) => s.showGitPanel)
  const toggleGitPanel = useAppStore((s) => s.toggleGitPanel)
  const graph = useGraph()
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  return (
    <div id="toolbar" className={styles.toolbar}>
      {/* 布局方向 */}
      <button
        title="垂直布局 (↓)"
        onClick={() => graph.layoutNodes('DOWN')}
      >
        ↓ 布局
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
        onClick={toggleGrid}
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
}
