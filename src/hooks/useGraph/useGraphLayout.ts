import { useCallback, useRef, useState } from 'react'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import type { Store } from '../../core/storage'
import { logAction } from '../../core/log-backend'
import { buildMetaFromNodesEdges } from './graphBuilder'
import type { NavState } from '../useNavContext'

interface UseGraphLayoutOptions {
  computeLayout: (nodes: KnowledgeNode[], direction?: 'RIGHT' | 'DOWN') => Promise<Record<string, { x: number; y: number }>>
  storage: Store
  getActiveNavState: () => NavState
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  setNodes: (nodes: KnowledgeNode[]) => void
  setDirtyState: (next: boolean) => void
}

export function useGraphLayout(options: UseGraphLayoutOptions) {
  const {
    computeLayout,
    storage,
    getActiveNavState,
    nodesRef,
    edgesRef,
    rebuildMaps,
    setNodes,
    setDirtyState,
  } = options
  const [isLayouting, setIsLayouting] = useState(false)
  const isLayoutingRef = useRef(false)

  const layoutNodes = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'DOWN') => {
      if (isLayoutingRef.current) {
        logAction('布局:跳过重复请求', 'useGraph', { direction })
        return
      }

      isLayoutingRef.current = true
      setIsLayouting(true)

      try {
        const navStateBeforeLayout = getActiveNavState()
        const roomPathBeforeLayout = navStateBeforeLayout.roomPath
        const nodesBeforeLayout = nodesRef.current
        const positions = await computeLayout(nodesBeforeLayout, direction)
        if (Object.keys(positions).length === 0) return

        if (getActiveNavState().roomPath !== roomPathBeforeLayout || nodesRef.current !== nodesBeforeLayout) {
          logAction('布局:丢弃过期结果', 'useGraph', { direction, roomPath: roomPathBeforeLayout })
          return
        }

        const updatedNodes = nodesBeforeLayout.map((n) => {
          const pos = positions[n.id]
          return pos ? { ...n, position: pos } : n
        })

        rebuildMaps(updatedNodes, edgesRef.current)
        nodesRef.current = updatedNodes
        setNodes(updatedNodes)
        logAction('布局:应用', 'useGraph', { direction, positionedCount: Object.keys(positions).length })

        if (roomPathBeforeLayout) {
          await storage.flushGraphSave(
            roomPathBeforeLayout,
            () => buildMetaFromNodesEdges(updatedNodes, edgesRef.current),
            () => setDirtyState(false)
          )
        }
      } finally {
        isLayoutingRef.current = false
        setIsLayouting(false)
      }
    },
    [computeLayout, rebuildMaps, getActiveNavState, storage, setDirtyState, setNodes, nodesRef, edgesRef]
  )

  return { isLayouting, layoutNodes }
}
