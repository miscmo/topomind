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
  ListTree,
  PanelRightClose,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { Tab } from '@/stores/tabs/tabStore'

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

export const HOST_NAV_ITEMS: NavItemDescriptor[] = [
  { id: 'home', title: '首页', icon: 'home', group: 'workspace', order: 10 },
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
