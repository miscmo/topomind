/**
 * 房间状态管理（Zustand）
 * 替代 Vue3 Pinia 的 room store
 * 管理知识卡片房间的导航状态
 */
import { create } from 'zustand'
import type { Room, RoomHistoryItem } from '@/types'

interface RoomState {
  // 当前知识库路径
  currentKBPath: string | null
  // 当前房间路径（null = 全局视野）
  currentRoomPath: string | null
  // 当前房间名称
  currentRoomName: string
  // 房间历史栈（用于返回功能）
  roomHistory: RoomHistoryItem[]
  // 是否正在加载房间
  loading: boolean

  // Actions
  enterRoom: (room: { path: string; kbPath: string; name: string }) => void
  goBack: () => RoomHistoryItem | null
  goToRoom: (item: RoomHistoryItem) => void
  exitToGlobal: () => void
  clearRoom: () => void
  setLoading: (loading: boolean) => void
  setCurrentKB: (kbPath: string) => void
  navigateToHistoryIndex: (index: number) => void

  // Computed-like helpers
  isInRoom: () => boolean
  isGlobalView: () => boolean
  getBreadcrumbs: () => RoomHistoryItem[]
}

/**
 * Zustand v5: create(fn) 返回的同一个对象同时具有 React Hook 和 Vanilla Store 的能力。
 * 同一个实例通过 roomStore.getState()（在 hooks 中使用）和 useRoomStore()（在组件中使用）
 * 共享同一个状态。
 */
export const roomStore = create<RoomState>((set, get) => ({
  currentKBPath: null,
  currentRoomPath: null,
  currentRoomName: '全局',
  roomHistory: [],
  loading: false,

  setLoading: (loading) => set({ loading }),

  setCurrentKB: (kbPath) => set({ currentKBPath: kbPath }),

  enterRoom: (room: { path: string; kbPath: string; name: string }) => {
    const state = get()
    if (state.currentRoomPath !== null) {
      const historyItem: RoomHistoryItem = {
        room: {
          path: state.currentRoomPath,
          kbPath: state.currentKBPath || room.kbPath,
          name: state.currentRoomName,
        },
      }
      set((s) => ({
        roomHistory: [...s.roomHistory, historyItem],
        currentRoomPath: room.path,
        currentKBPath: room.kbPath,
        currentRoomName: room.name,
      }))
    } else {
      set({
        currentRoomPath: room.path,
        currentKBPath: room.kbPath,
        currentRoomName: room.name,
        roomHistory: [],
      })
    }
  },

  goBack: () => {
    const state = get()
    if (state.roomHistory.length === 0) {
      return null
    }
    const lastItem = state.roomHistory[state.roomHistory.length - 1]
    const newHistory = state.roomHistory.slice(0, -1)
    if (newHistory.length === 0) {
      set({
        currentRoomPath: null,
        currentKBPath: lastItem.room.kbPath,
        currentRoomName: '全局',
        roomHistory: [],
      })
    } else {
      const prevItem = newHistory[newHistory.length - 1]
      set({
        currentRoomPath: prevItem.room.path,
        currentKBPath: prevItem.room.kbPath,
        currentRoomName: prevItem.room.name,
        roomHistory: newHistory,
      })
    }
    return lastItem
  },

  goToRoom: (item) => {
    const history = get().roomHistory
    const idx = history.findIndex((h) => h.room.path === item.room.path)
    if (idx === -1) {
      get().enterRoom({ path: item.room.path, kbPath: item.room.kbPath, name: item.room.name })
    } else {
      const newHistory = history.slice(0, idx)
      if (newHistory.length === 0) {
        set({
          currentRoomPath: null,
          currentKBPath: item.room.kbPath,
          currentRoomName: '全局',
          roomHistory: [],
        })
      } else {
        const prev = newHistory[newHistory.length - 1]
        set({
          currentRoomPath: item.room.path,
          currentKBPath: item.room.kbPath,
          currentRoomName: item.room.name,
          roomHistory: newHistory,
        })
      }
    }
  },

  exitToGlobal: () => set({
    currentRoomPath: null,
    currentRoomName: '全局',
    roomHistory: [],
  }),

  navigateToHistoryIndex: (index: number) => {
    const state = get()
    const history = state.roomHistory
    if (index < 0 || index >= history.length) return

    const target = history[index]
    const newHistory = history.slice(0, index)
    if (newHistory.length === 0) {
      set({
        currentRoomPath: null,
        currentKBPath: target.room.kbPath,
        currentRoomName: '全局',
        roomHistory: [],
      })
    } else {
      set({
        currentRoomPath: target.room.path,
        currentKBPath: target.room.kbPath,
        currentRoomName: target.room.name,
        roomHistory: newHistory,
      })
    }
  },

  clearRoom: () => set({
    currentKBPath: null,
    currentRoomPath: null,
    currentRoomName: '全局',
    roomHistory: [],
    loading: false,
  }),

  isInRoom: () => get().currentRoomPath !== null,

  isGlobalView: () => get().currentRoomPath === null,

  getBreadcrumbs: () => {
    const state = get()
    const crumbs: RoomHistoryItem[] = [...state.roomHistory]
    if (state.currentRoomPath) {
      crumbs.push({ room: { path: state.currentRoomPath, kbPath: state.currentKBPath || '', name: state.currentRoomName } })
    }
    return crumbs
  },
}))

// 在 React 组件中使用同一个 store 实例作为 hook
export const useRoomStore = roomStore
