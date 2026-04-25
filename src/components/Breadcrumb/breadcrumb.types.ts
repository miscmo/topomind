/**
 * 面包屑导航类型定义
 * 标准化面包屑数据模型，与 roomStore / tabStore 原始字段解耦。
 */

/** 面包屑条目类型 */
export type BreadcrumbKind = 'root' | 'history' | 'current'

/**
 * 面包屑条目
 * - root: 知识库根节点
 * - history: 可跳转的历史祖先节点
 * - current: 当前房间，不可点击
 */
export interface BreadcrumbItem {
  /** 唯一标识：root 用 'root'，history/current 用房间路径 */
  id: string
  /** 显示名称 */
  label: string
  /** 完整路径（用于调试/右键菜单/复制路径） */
  path: string
  /** 条目类型 */
  kind: BreadcrumbKind
  /** 是否可点击 */
  clickable: boolean
}

/** 面包屑状态（useBreadcrumbModel 产出） */
export interface BreadcrumbState {
  /** 知识库根路径 */
  kbPath: string | null
  /** 当前房间路径 */
  roomPath: string | null
  /** 当前房间名称 */
  roomName: string
  /** 知识库显示名称 */
  rootLabel: string
  /** 计算后的面包屑条目列表 */
  items: BreadcrumbItem[]
  /** 是否处于根级（当前路径 == 根路径） */
  isAtRoot: boolean
  /** 是否应渲染面包屑 */
  visible: boolean
}
