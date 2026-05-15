import { create } from 'zustand'
import type { DefaultEdgeStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits } from './uiStoreTypes'

interface GraphUiStore {
  showGrid: boolean
  selectedEdgeId: string | null
  connectingSourceId: string | null
  connectingTargetId: string | null
  defaultEdgeStyle: DefaultEdgeStyle
  defaultNodeStyle: DefaultNodeStyle
  defaultNodeSize: DefaultNodeSize
  nodeSizeLimits: NodeSizeLimits
  nodeBadgeSize: number
  setSelectedEdgeId: (edgeId: string | null) => void
  setConnectingSourceId: (nodeId: string | null) => void
  setConnectingTargetId: (nodeId: string | null) => void
  setDefaultEdgeStyle: (style: Partial<DefaultEdgeStyle>) => void
  replaceDefaultEdgeStyle: (style: DefaultEdgeStyle) => void
  setDefaultNodeStyle: (style: Partial<DefaultNodeStyle>) => void
  replaceDefaultNodeStyle: (style: DefaultNodeStyle) => void
  setDefaultNodeSize: (size: Partial<DefaultNodeSize>) => void
  replaceDefaultNodeSize: (size: DefaultNodeSize) => void
  setNodeSizeLimits: (limits: Partial<NodeSizeLimits>) => void
  replaceNodeSizeLimits: (limits: NodeSizeLimits) => void
  setNodeBadgeSize: (size: number) => void
  resetGraphUi: () => void
}

export const GRAPH_UI_INITIAL_STATE: Pick<GraphUiStore, 'showGrid' | 'selectedEdgeId' | 'connectingSourceId' | 'connectingTargetId' | 'defaultEdgeStyle' | 'defaultNodeStyle' | 'defaultNodeSize' | 'nodeSizeLimits' | 'nodeBadgeSize'> = {
  showGrid: true,
  selectedEdgeId: null,
  connectingSourceId: null,
  connectingTargetId: null,
  defaultEdgeStyle: {
    lineMode: 'straight',
    lineStyle: 'solid',
    color: '#7f8c8d',
    arrow: true,
  },
  defaultNodeStyle: {
    headerFontSize: 11,
    bodyFontSize: 12,
    headerColor: '#475569',
    headerBackgroundColor: '#f8fafc',
    headerFontWeight: 'normal',
    headerFontStyle: 'normal',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
  },
  defaultNodeSize: {
    width: 120,
    height: 52,
  },
  nodeSizeLimits: {
    minWidth: 120,
    minHeight: 52,
    maxWidth: 640,
    maxHeight: 480,
  },
  nodeBadgeSize: 14,
}

export const useGraphUiStore = create<GraphUiStore>((set) => ({
  ...GRAPH_UI_INITIAL_STATE,
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
  setConnectingSourceId: (connectingSourceId) => set({ connectingSourceId }),
  setConnectingTargetId: (connectingTargetId) => set({ connectingTargetId }),
  setDefaultEdgeStyle: (style) => set((state) => ({
    defaultEdgeStyle: { ...state.defaultEdgeStyle, ...style },
  })),
  replaceDefaultEdgeStyle: (defaultEdgeStyle) => set({ defaultEdgeStyle }),
  setDefaultNodeStyle: (style) => set((state) => ({
    defaultNodeStyle: { ...state.defaultNodeStyle, ...style },
  })),
  replaceDefaultNodeStyle: (defaultNodeStyle) => set({ defaultNodeStyle }),
  setDefaultNodeSize: (size) => set((state) => ({
    defaultNodeSize: { ...state.defaultNodeSize, ...size },
  })),
  replaceDefaultNodeSize: (defaultNodeSize) => set({ defaultNodeSize }),
  setNodeSizeLimits: (limits) => set((state) => ({
    nodeSizeLimits: { ...state.nodeSizeLimits, ...limits },
  })),
  replaceNodeSizeLimits: (nodeSizeLimits) => set({ nodeSizeLimits }),
  setNodeBadgeSize: (nodeBadgeSize) => set({ nodeBadgeSize }),
  resetGraphUi: () => set({ ...GRAPH_UI_INITIAL_STATE }),
}))
