/**
 * 面包屑纯函数工具
 * 所有函数均为纯函数，无副作用，便于单元测试。
 */
import type { RoomHistoryItem } from '../../types'
import type { BreadcrumbItem, BreadcrumbKind, BreadcrumbState } from './breadcrumb.types'

/**
 * 计算单个面包屑条目
 */
function makeItem(
  roomPath: string,
  roomName: string,
  kind: BreadcrumbKind,
  clickable: boolean
): BreadcrumbItem {
  return { id: roomPath, label: roomName, path: roomPath, kind, clickable }
}

/**
 * 计算根级面包屑条目
 */
export function computeRootItem(
  rootPath: string,
  rootLabel: string,
  isAtRoot: boolean
): BreadcrumbItem {
  return makeItem(rootPath, rootLabel, 'root', !isAtRoot)
}

/**
 * 从房间历史列表计算历史面包屑条目
 */
export function computeHistoryItems(history: RoomHistoryItem[]): BreadcrumbItem[] {
  return history.map((item) =>
    makeItem(item.room.path, item.room.name, 'history', true)
  )
}

/**
 * 计算当前房间面包屑条目（不可点击）
 */
export function computeCurrentItem(roomPath: string, roomName: string): BreadcrumbItem {
  return makeItem(roomPath, roomName, 'current', false)
}

/**
 * 判断是否处于根级
 */
export function computeIsAtRoot(roomPath: string | null, rootPath: string | null): boolean {
  if (!roomPath || !rootPath) return false
  return roomPath === rootPath
}

/**
 * 判断是否应渲染面包屑
 * 条件：有根路径 且 有当前房间路径
 */
export function computeVisible(rootPath: string | null, roomPath: string | null): boolean {
  return Boolean(rootPath && roomPath)
}

/**
 * 根据导航状态计算完整面包屑状态
 * 这是领域计算的核心函数
 */
export function computeBreadcrumbState(params: {
  kbPath: string | null
  roomPath: string | null
  roomName: string
  history: RoomHistoryItem[]
  rootLabel: string
}): BreadcrumbState {
  const { kbPath, roomPath, roomName, history, rootLabel } = params

  const isAtRoot = computeIsAtRoot(roomPath, kbPath)
  const visible = computeVisible(kbPath, roomPath)

  if (!visible) {
    return {
      items: [],
      isAtRoot,
      visible: false,
      kbPath,
      roomPath,
      roomName,
      rootLabel,
    }
  }

  const items: BreadcrumbItem[] = []

  // 1. 根节点
  items.push(computeRootItem(kbPath!, rootLabel, isAtRoot))

  // 2. 历史节点
  items.push(...computeHistoryItems(history))

  // 3. 当前节点（不在根级时）
  if (!isAtRoot) {
    items.push(computeCurrentItem(roomPath!, roomName))
  }

  return { items, isAtRoot, visible, kbPath, roomPath, roomName, rootLabel }
}
