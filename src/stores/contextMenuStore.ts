import { create } from 'zustand'
import type { ContextMenuStoreState } from './uiStoreTypes'

interface ContextMenuStore extends ContextMenuStoreState {
  resetContextMenu: () => void
}

export const CONTEXT_MENU_INITIAL_STATE: Pick<ContextMenuStoreState, 'contextMenu'> = {
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    type: null,
    targetId: null,
  },
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  ...CONTEXT_MENU_INITIAL_STATE,
  showContextMenu: (x, y, type, targetId = null) => set({
    contextMenu: { visible: true, x, y, type, targetId },
  }),
  hideContextMenu: () => set((state) => ({
    contextMenu: { ...state.contextMenu, visible: false },
  })),
  resetContextMenu: () => set({ ...CONTEXT_MENU_INITIAL_STATE }),
}))
