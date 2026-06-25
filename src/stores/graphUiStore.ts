import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { DefaultEdgeStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits, DefaultEditorStyle } from '../types/uiStoreTypes'
import { STYLE_CONFIG_DEFAULTS } from '../domain/style/styleDefaults'
import type { KnowledgeNodeStyle } from '../types'

interface MiniMapSize {
  width: number
  height: number
}

interface GraphUiStore {
  showGrid: boolean
  showMiniMap: boolean
  miniMapSize: MiniMapSize
  selectedEdgeId: string | null
  connectingSourceId: string | null
  connectingTargetId: string | null
  formatPainterStyle: KnowledgeNodeStyle | null
  defaultEdgeStyle: DefaultEdgeStyle
  defaultNodeStyle: DefaultNodeStyle
  defaultNodeSize: DefaultNodeSize
  defaultEditorStyle: DefaultEditorStyle
  nodeSizeLimits: NodeSizeLimits
  nodeBadgeSize: number
  setShowMiniMap: (showMiniMap: boolean) => void
  setMiniMapSize: (miniMapSize: MiniMapSize) => void
  setSelectedEdgeId: (edgeId: string | null) => void
  setConnectingSourceId: (nodeId: string | null) => void
  setConnectingTargetId: (nodeId: string | null) => void
  setFormatPainterStyle: (style: KnowledgeNodeStyle | null) => void
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

export const GRAPH_UI_INITIAL_STATE: Pick<GraphUiStore, 'showGrid' | 'showMiniMap' | 'miniMapSize' | 'selectedEdgeId' | 'connectingSourceId' | 'connectingTargetId' | 'formatPainterStyle' | 'defaultEdgeStyle' | 'defaultNodeStyle' | 'defaultNodeSize' | 'defaultEditorStyle' | 'nodeSizeLimits' | 'nodeBadgeSize'> = {
  showGrid: true,
  showMiniMap: true,
  miniMapSize: {
    width: 220,
    height: 140,
  },
  selectedEdgeId: null,
  connectingSourceId: null,
  connectingTargetId: null,
  formatPainterStyle: null,
  ...STYLE_CONFIG_DEFAULTS,
}

export const useGraphUiStore = create<GraphUiStore>()(
  persist(
    (set) => ({
      ...GRAPH_UI_INITIAL_STATE,
      setShowMiniMap: (showMiniMap) => set({ showMiniMap }),
      setMiniMapSize: (miniMapSize) => set({ miniMapSize }),
      setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
      setConnectingSourceId: (connectingSourceId) => set({ connectingSourceId }),
      setConnectingTargetId: (connectingTargetId) => set({ connectingTargetId }),
      setFormatPainterStyle: (formatPainterStyle) => set({ formatPainterStyle }),
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
    }),
    {
      name: 'topomind-graph-ui-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        showMiniMap: state.showMiniMap,
        miniMapSize: state.miniMapSize,
      }),
    }
  )
)
