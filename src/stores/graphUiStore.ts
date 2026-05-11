import { create } from 'zustand'
import type { GraphUiStoreState } from './uiStoreTypes'

interface GraphUiStore extends GraphUiStoreState {
  resetGraphUi: () => void
}

export const GRAPH_UI_INITIAL_STATE: Pick<GraphUiStoreState, 'showGrid' | 'selectedEdgeId' | 'defaultEdgeStyle'> = {
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
