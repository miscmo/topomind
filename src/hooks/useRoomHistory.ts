import { useState, useEffect, useCallback, useRef } from 'react'
import { useTabStore } from '../stores/tabs/tabStore'
import type { RoomTarget } from '../stores/tabs/tabTypes'

export interface RoomHistoryRecord {
  path: string
  name: string
  /** 兼容旧记录：可能缺失。展示时优先使用 display。 */
  historyStack?: { room: RoomTarget }[]
  /** 预先拼接好的面包屑展示文本，UI 直接使用，避免运行时拼接 */
  display?: string
}

const HISTORY_KEY_PREFIX = 'topomind_room_recent_v3_'
const MAX_HISTORY_ITEMS = 8
const ROOM_HISTORY_UPDATED_EVENT = 'topomind:room-history-updated'

function buildDisplay(kbLabel: string, historyStack: { room: RoomTarget }[] | undefined, roomName: string, kbPath: string | null, roomPath: string): string {
  if (roomPath === kbPath) return kbLabel || '知识库'

  const parts = [kbLabel || '知识库']
  historyStack?.forEach(h => {
    if (h.room.path !== kbPath) {
      parts.push(h.room.name)
    }
  })
  parts.push(roomName)
  return parts.join(' > ')
}

export function useRoomHistoryTracker(tabId: string) {
  const tab = useTabStore(s => s.getTabById(tabId))
  const kbPath = tab?.type === 'kb' ? tab.kbPath : null
  const kbLabel = tab?.type === 'kb' ? tab.label || '知识库' : '知识库'
  const currentRoomPath = tab?.type === 'kb' ? tab.currentRoomPath : null
  const currentRoomName = tab?.type === 'kb' ? tab.currentRoomName : null
  const roomHistory = tab?.type === 'kb' ? tab.roomHistory : null

  // 用 ref 缓存当前 roomHistory 的序列化结果，避免对象引用变化引起的重复写入
  const lastSerializedStackRef = useRef<string | null>(null)

  useEffect(() => {
    if (!kbPath || !currentRoomPath) return

    const storageKey = `${HISTORY_KEY_PREFIX}${kbPath}`
    let history: RoomHistoryRecord[] = []

    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        history = JSON.parse(stored)
      }
    } catch (e) {
      console.warn('Failed to parse room history from localStorage', e)
    }

    const existingIndex = history.findIndex(h => h.path === currentRoomPath)
    const stack = roomHistory ?? undefined
    const newDisplay = buildDisplay(kbLabel, stack, currentRoomName || '未命名', kbPath, currentRoomPath)

    if (existingIndex >= 0) {
      // 需求：如果打开的房间在列表中存在则不更新列表和顺序，仅在名称或堆栈发生变化时静默同步
      const isNameChanged = history[existingIndex].name !== currentRoomName
      const isDisplayChanged = history[existingIndex].display !== newDisplay
      const serializedStack = JSON.stringify(stack || [])
      const isStackChanged = lastSerializedStackRef.current !== serializedStack

      if (!isNameChanged && !isStackChanged && !isDisplayChanged) {
        return
      }

      history[existingIndex].name = currentRoomName || history[existingIndex].name
      history[existingIndex].historyStack = stack || []
      history[existingIndex].display = newDisplay

      try {
        localStorage.setItem(storageKey, JSON.stringify(history))
        window.dispatchEvent(new CustomEvent(ROOM_HISTORY_UPDATED_EVENT, { detail: { storageKey } }))
        lastSerializedStackRef.current = serializedStack
      } catch (e) {
        console.warn('Failed to persist room history', e)
      }
      return
    }

    // 需求：如果打开的房间不存在列表，则在列表中增加一项（加到最前面）
    const serializedStack = JSON.stringify(stack || [])
    history.unshift({
      path: currentRoomPath,
      name: currentRoomName || '未命名',
      historyStack: stack || [],
      display: newDisplay
    })

    if (history.length > MAX_HISTORY_ITEMS) {
      history = history.slice(0, MAX_HISTORY_ITEMS)
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(history))
      window.dispatchEvent(new CustomEvent(ROOM_HISTORY_UPDATED_EVENT, { detail: { storageKey } }))
      lastSerializedStackRef.current = serializedStack
    } catch (e) {
      console.warn('Failed to persist room history', e)
    }
  }, [kbPath, kbLabel, currentRoomPath, currentRoomName, roomHistory])
}

export function useRoomHistoryList(
  kbPath: string | null | undefined,
  kbLabel: string | null | undefined,
  refreshKey?: string | null,
) {
  const [historyList, setHistoryList] = useState<RoomHistoryRecord[]>([])

  const loadHistory = useCallback(() => {
    if (!kbPath) {
      setHistoryList([])
      return
    }

    const storageKey = `${HISTORY_KEY_PREFIX}${kbPath}`
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        let history: RoomHistoryRecord[] = JSON.parse(stored)
        // 给缺失 display 的旧记录补一个回退值
        history = history.map(item => {
          if (item.display) return item
          return {
            ...item,
            display: buildDisplay(kbLabel || '知识库', item.historyStack, item.name, kbPath, item.path)
          }
        })
        setHistoryList(history)
      } else {
        setHistoryList([])
      }
    } catch (e) {
      console.warn('Failed to load room history', e)
      setHistoryList([])
    }
  }, [kbPath, kbLabel])

  useEffect(() => {
    loadHistory()

    const handleStorageChange = (e: StorageEvent) => {
      if (kbPath && e.key === `${HISTORY_KEY_PREFIX}${kbPath}`) {
        loadHistory()
      }
    }

    const handleRoomHistoryUpdated = (event: Event) => {
      const storageKey = (event as CustomEvent<{ storageKey?: string }>).detail?.storageKey
      if (kbPath && storageKey === `${HISTORY_KEY_PREFIX}${kbPath}`) {
        loadHistory()
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener(ROOM_HISTORY_UPDATED_EVENT, handleRoomHistoryUpdated)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener(ROOM_HISTORY_UPDATED_EVENT, handleRoomHistoryUpdated)
    }
  }, [loadHistory, kbPath, refreshKey])

  return historyList
}
