/**
 * useBreadcrumbModel — 面包屑数据适配层 + 领域计算层
 *
 * 职责：
 * 1. 从 roomStore 或 tabStore 读取原始导航状态
 * 2. 统一转换为标准化 BreadcrumbState
 * 3. 对外只暴露标准化数据，UI 组件无需关心 store 差异
 *
 * 使用方式：
 *   const model = useBreadcrumbModel(tabId)
 *   const { items, isAtRoot, visible } = model
 */
import { useMemo } from 'react'
import { useRoomStore } from '../../stores/roomStore'
import { useTabStore } from '../../stores/tabStore'
import type { BreadcrumbState } from './breadcrumb.types'
import { computeBreadcrumbState } from './breadcrumb.utils'

interface UseBreadcrumbModelOptions {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId?: string
}

/**
 * 读取并标准化面包屑状态
 * - Tab 模式：读取 tabStore 中对应 tab 的状态
 * - 非 Tab 模式：读取 roomStore 全局状态
 */
export function useBreadcrumbModel({
  tabId,
}: UseBreadcrumbModelOptions): BreadcrumbState {
  // Tab 模式：从 tabStore 读取
  const tab = useTabStore((s) => (tabId ? s.getTabById(tabId) : undefined))

  // 非 Tab 模式：从 roomStore 读取
  const globalRoomHistory = useRoomStore((s) => s.roomHistory)
  const globalRoomPath = useRoomStore((s) => s.currentRoomPath)
  const globalRoomName = useRoomStore((s) => s.currentRoomName)
  const globalKBPath = useRoomStore((s) => s.currentKBPath)

  const state = useMemo((): BreadcrumbState => {
    if (tabId && tab) {
      // Tab 模式
      const kbPath = tab.kbPath ?? null
      const roomPath = tab.currentRoomPath ?? null
      const roomName = tab.currentRoomName ?? tab.label ?? '知识库'
      const history = tab.roomHistory ?? []
      const rootLabel = tab.label ?? '知识库'

      return computeBreadcrumbState({ kbPath, roomPath, roomName, history, rootLabel })
    }

    // 非 Tab 模式
    const kbPath = globalKBPath
    const roomPath = globalRoomPath
    const roomName = globalRoomName || '全局'
    const history = globalRoomHistory
    const rootLabel = kbPath ? '知识库' : ''

    return computeBreadcrumbState({ kbPath, roomPath, roomName, history, rootLabel })
  }, [
    tabId,
    tab,
    globalRoomHistory,
    globalRoomPath,
    globalRoomName,
    globalKBPath,
  ])

  return state
}
