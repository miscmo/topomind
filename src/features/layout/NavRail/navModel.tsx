/**
 * 全局导航的模型层：图标表、宿主导航项、激活态推导。
 * 插件声明的导航项在 NavRailSlot 里转换成同一个 NavItemDescriptor，
 * 这样宿主与插件共用一套排序 / 渲染 / 激活规则。
 */
import {
  Activity,
  AppWindow,
  FileText,
  Home,
  Layers3,
  Library,
  ListTree,
  PanelRightClose,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { Tab } from '@/stores/tabs/tabStore'
import type { LeftDockPanelId } from '@/stores/nodeTreePanelStore'

export type NavIconName =
  | 'home'
  | 'learning'
  | 'monitor'
  | 'settings'
  | 'profile'
  | 'rail'
  | 'search'
  | 'default'

export type NavGroup = 'workspace' | 'tools' | 'account'

export interface NavItemDescriptor {
  id: string
  title: string
  icon: NavIconName
  group: NavGroup
  order: number
  /** titlebar = 按钮住在标题栏（不进左侧 rail），但仍参与快捷键与激活态推导。 */
  placement?: 'rail' | 'titlebar'
  /** 插件项通过命令打开，宿主项由 NavRail 自己分发 */
  openCommand?: string
  pluginId?: string
}

export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  home: Home,
  learning: Activity,
  monitor: ScrollText,
  settings: Settings,
  profile: AppWindow,
  rail: PanelRightClose,
  search: Search,
  default: Workflow,
}

/** manifest 里的 icon 字符串 → 导航图标名。未知值回落到通用图标，不让插件写坏宿主 UI。 */
export function normalizeNavIcon(icon: unknown): NavIconName {
  switch (icon) {
    case 'home': return 'home'
    case 'chart':
    case 'activity':
    case 'learning': return 'learning'
    case 'terminal':
    case 'monitor':
    case 'logs': return 'monitor'
    case 'settings': return 'settings'
    case 'profile':
    case 'account': return 'profile'
    case 'search': return 'search'
    case 'flask': return 'default'
    default: return 'default'
  }
}

/** 首页搬到标题栏后仍留在这一份清单里：Ctrl+1..9 与激活态推导共用同一真源。 */
export const HOST_NAV_ITEMS: NavItemDescriptor[] = [
  { id: 'home', title: '首页', icon: 'home', group: 'workspace', order: 10, placement: 'titlebar' },
  { id: 'settings', title: '设置', icon: 'settings', group: 'tools', order: 80 },
  { id: 'profile', title: '账户与工作区', icon: 'profile', group: 'account', order: 100 },
]

export const HOST_VIEW_IDS = {
  settings: 'host.settings',
  profile: 'host.profile',
} as const

/** 宿主视图 id → 导航项 id；插件视图直接用 viewId 作为导航项 id。
 *  画布页没有对应的导航项，返回空串表示不高亮任何图标。 */
export function resolveActiveNavId(activeTab: Tab | undefined): string {
  if (!activeTab) return 'home'
  if (activeTab.type === 'home') return 'home'
  if (activeTab.type === 'kb') return ''
  if (activeTab.viewId === HOST_VIEW_IDS.settings) return 'settings'
  if (activeTab.viewId === HOST_VIEW_IDS.profile) return 'profile'
  return activeTab.viewId
}

export const GROUP_DIVIDER_ICONS: Record<NavGroup, LucideIcon> = {
  workspace: Layers3,
  tools: SlidersHorizontal,
  account: ListTree,
}

export const FALLBACK_ICONS = { FileText, ListTree } as const

/**
 * 左侧 Dock 的竖向页面 tab（宿主固定项），顺序即导航栏从上往下的顺序。
 *
 * 刻意不进 HOST_NAV_ITEMS / 插件 navItems 链路：
 *  - 它们管「去哪里」，这三项管「当前画布左栏显示哪一页」，职责不同；
 *  - 不参与 Control+1..9 的下标排序，也不改变 GUI 阶段的 nav item id 白名单；
 *  - 渲染时使用独立的 data-tm-left-dock-tab 属性，不带 data-tm-nav-item；
 *  - 四页共用同一渲染分支，因此显隐条件天然一致（只随画布视图出现）。
 */
export interface DockTabDescriptor {
  id: LeftDockPanelId
  title: string
  icon: LucideIcon
}

/** 画布设置紧跟「节点结构」之后：前 3 页顺序不变，新页只追加在末尾。 */
export const HOST_DOCK_TABS: readonly DockTabDescriptor[] = [
  { id: 'agent', title: 'AI Agent', icon: Sparkles },
  { id: 'kbList', title: '知识库列表', icon: Library },
  { id: 'tree', title: '节点结构', icon: ListTree },
  { id: 'canvasSettings', title: '画布设置', icon: SlidersHorizontal },
]
