import { create } from 'zustand'

interface RoomOverviewState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

/**
 * 总览只是视图开关：不落盘、不进 _config.json、不碰节点/边字段白名单。
 * 关掉后底层画布的 viewport 与选中态原封不动。
 */
export const useRoomOverviewStore = create<RoomOverviewState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}))
