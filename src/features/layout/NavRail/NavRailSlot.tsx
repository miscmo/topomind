/**
 * 插件导航扩展点：把 manifest 的 navItems 静态贡献转换成宿主导航项。
 *
 * 为什么不需要 runtime renderer：navItem 只声明 icon/title/openCommand，
 * 点击时走命令桥（会按 activationEvent 按需激活插件并打开 secondary view）。
 * 所以「装了插件 → 左侧多一个图标」在插件代码加载前就能生效。
 */
import { useEffect, useMemo, useState } from 'react'

import { getPluginManager } from '@/plugins/bootstrap'
import type { StaticContributionRecord } from '@/plugins'
import { normalizeNavIcon, type NavGroup, type NavItemDescriptor } from './navModel'

function toDescriptor(record: StaticContributionRecord): NavItemDescriptor {
  const data = record.manifestData
  const group: NavGroup =
    data.group === 'tools' || data.group === 'account' ? data.group : 'workspace'

  return {
    id: record.contributionId,
    title: typeof data.title === 'string' ? data.title : record.contributionId,
    icon: normalizeNavIcon(data.icon),
    group,
    order: typeof data.order === 'number' ? data.order : 50,
    openCommand: typeof data.openCommand === 'string' ? data.openCommand : undefined,
    pluginId: record.pluginId,
  }
}

export function usePluginNavItems(): NavItemDescriptor[] {
  const registry = useMemo(() => getPluginManager().getRegistry(), [])
  const [records, setRecords] = useState<StaticContributionRecord[]>(() =>
    registry.listStaticNavItems(),
  )

  useEffect(() => {
    const subscription = registry.subscribe(() => {
      setRecords(registry.listStaticNavItems())
    })
    setRecords(registry.listStaticNavItems())
    return () => subscription.dispose()
  }, [registry])

  return useMemo(() => records.map(toDescriptor), [records])
}
