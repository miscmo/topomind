/**
 * 房间状态管理（Zustand）
 * 替代 Vue3 Pinia 的 room store
 * 管理知识卡片房间的导航状态
 */
import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
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

  // Computed-like helpers
  isInRoom: () => boolean
  isGlobalView: () => boolean
  getBreadcrumbs: () => RoomHistoryItem[]
}

const roomStoreCreator = (set: (fn: (s: RoomState) => RoomState) => void, get: () => RoomState): RoomState => ({
  currentKBPath: null,
  currentRoomPath: null,
  currentRoomName: '全局',
  roomHistory: [],
  loading: false,

  setLoading: (loading) => set({ loading }),

  setCurrentKB: (kbPath) => set({ currentKBPath: kbPath }),

  enterRoom: (room: { path: string; kbPath: string; name: string }) => {
    const state = get()
    // 如果当前有房间，先保存当前状态到历史
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
      // 全局视图进入第一个房间
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
      // 返回全局视野
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
      // 不在历史中，作为新入口
      get().enterRoom(item.room.path, item.room.kbPath, item.room.name)
    } else {
      // 在历史中，截断后面的历史
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
    const crumbs = state.roomHistory.map((h) => h.room)
    if (state.currentRoomPath) {
      crumbs.push({ path: state.currentRoomPath, kbPath: state.currentKBPath || '', name: state.currentRoomName })
    }
    return crumbs
  },
})

// 创建一个独立的 store 实例（用于 .getState() 外部调用）
export const roomStore = createStore<RoomState>(roomStoreCreator)

// Zustand hook（React 组件中使用）
export const useRoomStore = create<RoomState>((set, get) => roomStoreCreator(set, get))
