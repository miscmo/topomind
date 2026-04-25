/**
 * 面包屑导航组件
 * 显示完整房间路径：知识库根 > 父房间 > ... > 当前房间
 * 历史房间可点击跳转，当前房间不可点击。
 *
 * 架构：纯渲染组件，数据来源于 useBreadcrumbModel，行为来源于 useBreadcrumbActions
 */
import { memo } from 'react'
import { useGraphContext } from '../../contexts/GraphContext'
import { useBreadcrumbModel } from './useBreadcrumbModel'
import { useBreadcrumbActions } from './breadcrumb.actions'
import styles from './Breadcrumb.module.css'

interface BreadcrumbProps {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId?: string
}

export default memo(function Breadcrumb({ tabId }: BreadcrumbProps) {
  const graph = useGraphContext()
  const { items, visible } = useBreadcrumbModel({ tabId })
  const { navigateToRoot, navigateToHistory } = useBreadcrumbActions({ tabId, graph })

  if (!visible) return null

  return (
    <div id="breadcrumb" className={styles.breadcrumb}>
      {items.map((item, index) => {
        if (item.kind === 'root') {
          return (
            <button
              key={item.id}
              data-testid="breadcrumb-root"
              className={styles.link}
              onClick={navigateToRoot}
              disabled={!item.clickable}
              aria-current={!item.clickable ? 'page' : undefined}
            >
              {item.label}
            </button>
          )
        }

        // items[0] is root, items[1..n-1] are history/current
        // For navigateToHistory: history[0] maps to index 0 in the breadcrumb items array
        // Since items[0] is root, history index = current index - 1
        const historyIndex = index - 1

        const isLast = index === items.length - 1

        return (
          <span key={item.id} className={styles.chain}>
            <span className={styles.sep}>&gt;</span>
            {isLast ? (
              <span className={styles.current}>{item.label}</span>
            ) : (
              <button
                className={styles.link}
                onClick={() => navigateToHistory(historyIndex, item.label, item.path)}
              >
                {item.label}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
})
