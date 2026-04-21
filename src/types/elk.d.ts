/**
 * ELK.js type declarations
 * Covers the elk.bundled.js output used in this project.
 * These types represent what the bundled library actually provides at runtime.
 */

// ELK node in input graph
interface ELKGraphNode {
  id: string
  width?: number
  height?: number
  layoutOptions?: Record<string, string | number>
}

// ELK edge in input graph
interface ELKGraphEdge {
  id: string
  sources: string[]
  targets: string[]
}

// Input graph structure for elk.layout()
export interface ELKGraph {
  id: string
  layoutOptions?: Record<string, string | number>
  children?: ELKGraphNode[]
  edges?: ELKGraphEdge[]
}

// Output node from ELK layout result
export interface ELKLayoutNode {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  children?: ELKLayoutNode[]
}

// Output from elk.layout()
export interface ELKLayoutResult {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  children?: ELKLayoutNode[]
}

// Ambient module declaration for the bundled ELK module
declare module 'elkjs/lib/elk.bundled.js' {
  export default class ELK {
    layout(
      graph: ELKGraph,
      options?: Record<string, unknown>
    ): Promise<ELKLayoutResult>
  }
}