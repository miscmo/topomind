/**
 * useBreadcrumbModel — 面包屑数据适配层 + 领域计算层
 *
 * 职责：
 * 1. 从 tabStore 读取原始导航状态
 * 2. 统一转换为标准化 BreadcrumbState
 * 3. 对外只暴露标准化数据，UI 组件无需关心 store 差异
 *
 * 使用方式：
 *   const model = useBreadcrumbModel(tabId)
 *   const { items, isAtRoot, visible } = model
 */
import { useMemo } from 'react'
import { useTabStore } from '../../stores/tabStore'
import type { BreadcrumbState } from './breadcrumb.types'
import { computeBreadcrumbState } from './breadcrumb.utils'

interface UseBreadcrumbModelOptions {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId: string
}

/**
 * 读取并标准化面包屑状态
 * - 读取 tabStore 中对应 tab 的状态
 */
export function useBreadcrumbModel({
  tabId,
}: UseBreadcrumbModelOptions): BreadcrumbState {
  const tab = useTabStore((s) => s.getTabById(tabId))

  const state = useMemo((): BreadcrumbState => {
    if (tab) {
      const kbPath = tab.kbPath ?? null
      const roomPath = tab.currentRoomPath ?? null
      const roomName = tab.currentRoomName ?? tab.label ?? '知识库'
      const history = tab.roomHistory ?? []
      const rootLabel = tab.label ?? '知识库'

      return computeBreadcrumbState({ kbPath, roomPath, roomName, history, rootLabel })
    }

    return computeBreadcrumbState({ kbPath: null, roomPath: null, roomName: '', history: [], rootLabel: '' })
  }, [tab])

  return state
}
