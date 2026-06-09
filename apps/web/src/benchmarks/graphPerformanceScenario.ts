import type { Edge, Node } from '@xyflow/react'

export interface BenchmarkNodeData extends Record<string, unknown> {
  label: string
  row: number
  col: number
}

export type BenchmarkGraphNode = Node<BenchmarkNodeData, 'benchmarkNode'>

export interface GraphBenchmarkScenario {
  name: string
  nodeCount: number
  edgeCount: number
  targetNodeId: string
  nodes: BenchmarkGraphNode[]
  edges: Edge[]
}

const GRID_COLUMNS = 40
const GRID_ROWS = 25
const NODE_WIDTH = 172
const NODE_HEIGHT = 64
const GAP_X = 72
const GAP_Y = 56

export function createGraphBenchmarkScenario(): GraphBenchmarkScenario {
  const nodes: BenchmarkGraphNode[] = []
  const edges: Edge[] = []

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLUMNS; col += 1) {
      const index = row * GRID_COLUMNS + col
      const id = `bench-node-${index + 1}`
      nodes.push({
        id,
        type: 'benchmarkNode',
        position: {
          x: col * (NODE_WIDTH + GAP_X),
          y: row * (NODE_HEIGHT + GAP_Y),
        },
        data: {
          label: `节点 ${index + 1}`,
          row,
          col,
        },
        draggable: false,
        selectable: true,
      })

      if (col + 1 < GRID_COLUMNS) {
        edges.push({
          id: `bench-edge-right-${index + 1}`,
          source: id,
          target: `bench-node-${index + 2}`,
          animated: false,
        })
      }

      if (row + 1 < GRID_ROWS && col % 4 === 0) {
        edges.push({
          id: `bench-edge-down-${index + 1}`,
          source: id,
          target: `bench-node-${index + 1 + GRID_COLUMNS}`,
          animated: false,
        })
      }
    }
  }

  return {
    name: 'graph-baseline-1000',
    nodeCount: nodes.length,
    edgeCount: edges.length,
    targetNodeId: `bench-node-${Math.floor(nodes.length / 2)}`,
    nodes,
    edges,
  }
}
