import { create } from 'zustand'
import type { DefaultEdgeStyle } from './uiStoreTypes'

interface GraphUiStore {
  showGrid: boolean
  selectedEdgeId: string | null
  defaultEdgeStyle: DefaultEdgeStyle
  setSelectedEdgeId: (edgeId: string | null) => void
  setDefaultEdgeStyle: (style: Partial<DefaultEdgeStyle>) => void
  replaceDefaultEdgeStyle: (style: DefaultEdgeStyle) => void
  resetGraphUi: () => void
}

export const GRAPH_UI_INITIAL_STATE: Pick<GraphUiStore, 'showGrid' | 'selectedEdgeId' | 'defaultEdgeStyle'> = {
  showGrid: true,
  selectedEdgeId: null,
  defaultEdgeStyle: {
    lineMode: 'smoothstep',
    lineStyle: 'solid',
    color: '#7f8c8d',
    arrow: true,
  },
}

export const useGraphUiStore = create<GraphUiStore>((set) => ({
  ...GRAPH_UI_INITIAL_STATE,
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
  setDefaultEdgeStyle: (style) => set((state) => ({
    defaultEdgeStyle: { ...state.defaultEdgeStyle, ...style },
  })),
  replaceDefaultEdgeStyle: (defaultEdgeStyle) => set({ defaultEdgeStyle }),
  resetGraphUi: () => set({ ...GRAPH_UI_INITIAL_STATE }),
}))
