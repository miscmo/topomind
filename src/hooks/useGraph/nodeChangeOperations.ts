import type { KnowledgeEdge, KnowledgeNode } from '../../types'

export interface NodeChangeOperationsDeps {
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  getActiveSelectedNodeId: () => string | null
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  saveNow: (dirPath: string) => Promise<void>
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
  updateSelectedNode: (nodes: KnowledgeNode[], nodeId: string | null) => void
}

export function buildNodeChangeOperations(deps: NodeChangeOperationsDeps) {
  const {
    nodesRef,
    edgesRef,
    getActiveGraphSession,
    getActiveSelectedNodeId,
    rebuildMaps,
    saveNow,
    setState,
    updateSelectedNode,
  } = deps

  const applyNodePositionChanges = async (changes: Array<{ id: string; position: { x: number; y: number } }>) => {
    setState((prev) => {
      const nodesMap = new Map(prev.nodes.map((n) => [n.id, n]))
      for (const change of changes) {
        const node = nodesMap.get(change.id)
        if (node && change.position) {
          nodesMap.set(change.id, { ...node, position: change.position })
        }
      }
      const nodes = Array.from(nodesMap.values())
      nodesRef.current = nodes
      rebuildMaps(nodes, prev.edges)
      updateSelectedNode(nodes, getActiveSelectedNodeId())
      return { ...prev, nodes }
    })
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
  }

  const applyNodeRemoveChanges = async (changeIds: string[]) => {
    const removedSet = new Set(changeIds)
    setState((prev) => {
      const nodes = prev.nodes.filter((n) => !changeIds.includes(n.id))
      const edges = prev.edges.filter((e) => !removedSet.has(e.source) && !removedSet.has(e.target))
      nodesRef.current = nodes
      edgesRef.current = edges
      rebuildMaps(nodes, edges)
      return { ...prev, nodes, edges }
    })
    const dirPath = getActiveGraphSession().roomPath
    if (dirPath) await saveNow(dirPath)
  }

  const applyNodeDimensionChanges = (changes: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined }>) => {
    setState((prev) => {
      const nodes = prev.nodes.map((n) => {
        const change = changes.find((c) => c.id === n.id)
        if (!change) return n
        return {
          ...n,
          measured: change.dimensions ?? undefined,
        }
      })
      nodesRef.current = nodes
      return { ...prev, nodes }
    })
  }

  return {
    applyNodePositionChanges,
    applyNodeRemoveChanges,
    applyNodeDimensionChanges,
  }
}
