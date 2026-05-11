import { useCallback, useRef } from 'react'
import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import type { Store } from '../../core/storage'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { loadRoomGraph } from './roomLoader'
import type { NavState } from '../useNavContext'

interface GraphRoomState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
}

interface UseGraphRoomLoaderOptions {
  storage: Store
  getActiveNavState: () => NavState
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  updateSelectedNode: (nodes: KnowledgeNode[], nodeId: string | null) => void
  setState: React.Dispatch<React.SetStateAction<GraphRoomState>>
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
}

export function useGraphRoomLoader(options: UseGraphRoomLoaderOptions) {
  const {
    storage,
    getActiveNavState,
    rebuildMaps,
    updateSelectedNode,
    setState,
    nodesRef,
    edgesRef,
  } = options
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)

  const loadRoom = useCallback(
    async (dirPath: string) => {
      const requestSeq = ++loadRequestSeqRef.current
      setState((s) => ({ ...s, loading: true }))

      try {
        const kbPath = getActiveNavState().kbPath
        const loaded = await loadRoomGraph(storage, dirPath, kbPath)

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })

        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          return
        }

        latestAppliedLoadSeqRef.current = requestSeq
        setState({ nodes: loaded.nodes, edges: loaded.edges, loading: false, selectedNode: null })
        rebuildMaps(loaded.nodes, loaded.edges)
        updateSelectedNode(loaded.nodes, null)
        nodesRef.current = loaded.nodes
        edgesRef.current = loaded.edges
        logAction('房间:加载完成', 'useGraph', {
          roomPath: dirPath,
          kbPath,
          nodeCount: loaded.nodes.length,
          edgeCount: loaded.edges.length,
          requestSeq,
        })
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    },
    [storage, getActiveNavState, rebuildMaps, updateSelectedNode, setState, nodesRef, edgesRef]
  )

  return { loadRoom }
}
