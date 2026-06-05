export interface SecondaryViewNavigationTarget {
  viewId: string
  label: string
  tabId: string
}

export const LEGACY_SECONDARY_VIEWS: Record<string, SecondaryViewNavigationTarget> = {
  'monitor.logs': {
    viewId: 'monitor.logs',
    label: '系统日志',
    tabId: 'monitor',
  },
  'learning.statistics': {
    viewId: 'learning.statistics',
    label: '学习统计',
    tabId: 'statistics',
  },
}

export function getLegacySecondaryView(viewId: string): SecondaryViewNavigationTarget | undefined {
  return LEGACY_SECONDARY_VIEWS[viewId]
}

export function getDefaultSecondaryViewTabId(viewId: string): string {
  return `secondary-view:${viewId}`
}
