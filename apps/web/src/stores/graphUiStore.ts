import { create } from 'zustand'
import type { DefaultEdgeStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits, DefaultEditorStyle } from '../types/uiStoreTypes'
import { STYLE_CONFIG_DEFAULTS } from '../domain/style/styleDefaults'

interface GraphUiStore {
  showGrid: boolean
  selectedEdgeId: string | null
  connectingSourceId: string | null
  connectingTargetId: string | null
  defaultEdgeStyle: DefaultEdgeStyle
  defaultNodeStyle: DefaultNodeStyle
  defaultNodeSize: DefaultNodeSize
  defaultEditorStyle: DefaultEditorStyle
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
  setDefaultEditorStyle: (style: Partial<DefaultEditorStyle>) => void
  replaceDefaultEditorStyle: (style: DefaultEditorStyle) => void
  setNodeSizeLimits: (limits: Partial<NodeSizeLimits>) => void
  replaceNodeSizeLimits: (limits: NodeSizeLimits) => void
  setNodeBadgeSize: (size: number) => void
  resetGraphUi: () => void
}

export const GRAPH_UI_INITIAL_STATE: Pick<GraphUiStore, 'showGrid' | 'selectedEdgeId' | 'connectingSourceId' | 'connectingTargetId' | 'defaultEdgeStyle' | 'defaultNodeStyle' | 'defaultNodeSize' | 'defaultEditorStyle' | 'nodeSizeLimits' | 'nodeBadgeSize'> = {
  showGrid: true,
  selectedEdgeId: null,
  connectingSourceId: null,
  connectingTargetId: null,
  ...STYLE_CONFIG_DEFAULTS,
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
  setDefaultEditorStyle: (style) => set((state) => ({
    defaultEditorStyle: { ...state.defaultEditorStyle, ...style },
  })),
  replaceDefaultEditorStyle: (defaultEditorStyle) => set({ defaultEditorStyle }),
  setNodeSizeLimits: (limits) => set((state) => ({
    nodeSizeLimits: { ...state.nodeSizeLimits, ...limits },
  })),
  replaceNodeSizeLimits: (nodeSizeLimits) => set({ nodeSizeLimits }),
  setNodeBadgeSize: (nodeBadgeSize) => set({ nodeBadgeSize }),
  resetGraphUi: () => set({ ...GRAPH_UI_INITIAL_STATE }),
}))
