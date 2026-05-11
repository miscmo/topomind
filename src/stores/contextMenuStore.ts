import { create } from 'zustand'
import type { ContextMenuState, ContextMenuType } from './uiStoreTypes'

interface ContextMenuStore {
  contextMenu: ContextMenuState
  showContextMenu: (x: number, y: number, type: Exclude<ContextMenuType, null>, targetId?: string | null) => void
  hideContextMenu: () => void
  resetContextMenu: () => void
}

export const CONTEXT_MENU_INITIAL_STATE: Pick<ContextMenuStore, 'contextMenu'> = {
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
