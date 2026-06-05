import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import { getPluginManager } from '../bootstrap'
import type { StaticContributionRecord } from './pluginTypes'
import { chooseWidgetActivationReason } from './widgetActivation'

interface WidgetSlotState {
  widgets: Array<{
    widgetId: string
    pluginId: string
    render: (props: { widgetId: string; pluginId: string }) => ReactNode
  }>
  missingPlugins: Array<{
    pluginId: string
    widgetIds: string[]
  }>
}

export interface PluginWidgetSlotProps {
  placement: 'titlebar' | 'home'
}

function readRuntimeWidgets(
  staticWidgets: StaticContributionRecord[],
  getRenderer: (widgetId: string) => ((props: { widgetId: string; pluginId: string }) => ReactNode) | undefined,
): WidgetSlotState {
  const missingPluginsByPluginId = new Map<string, Set<string>>()

  return {
    widgets: staticWidgets.flatMap((record) => {
      const render = getRenderer(record.contributionId)
      if (!render) {
        const widgetIds = missingPluginsByPluginId.get(record.pluginId) ?? new Set<string>()
        widgetIds.add(record.contributionId)
        missingPluginsByPluginId.set(record.pluginId, widgetIds)
        return []
      }

      return [
        {
          widgetId: record.contributionId,
          pluginId: record.pluginId,
          render,
        },
      ]
    }),
    missingPlugins: [...missingPluginsByPluginId].map(([pluginId, widgetIds]) => ({
      pluginId,
      widgetIds: [...widgetIds],
    })),
  }
}

export function PluginWidgetSlot({ placement }: PluginWidgetSlotProps) {
  const manager = useMemo(() => getPluginManager(), [])
  const registry = manager.getRegistry()
  const attemptedPluginIdsRef = useRef<Set<string>>(new Set())

  const state = useSyncExternalStore(
    (listener) => {
      const subscription = registry.subscribe(listener)
      return () => {
        subscription.dispose()
      }
    },
    () =>
      readRuntimeWidgets(
        registry.listStaticWidgetsByPlacement(placement),
        (widgetId) => registry.getWidgetRenderer(widgetId),
      ),
    () => ({ widgets: [], missingPlugins: [] }),
  )

  useEffect(() => {
    attemptedPluginIdsRef.current.clear()
  }, [placement])

  useEffect(() => {
    const missingPlugins = state.missingPlugins.filter(
      (missingPlugin) => !attemptedPluginIdsRef.current.has(missingPlugin.pluginId),
    )

    if (missingPlugins.length === 0) {
      return
    }

    let disposed = false
    for (const missingPlugin of missingPlugins) {
      attemptedPluginIdsRef.current.add(missingPlugin.pluginId)
    }

    void Promise.allSettled(
      missingPlugins.map(async (missingPlugin) => {
        const staticWidget = missingPlugin.widgetIds
          .map((widgetId) => registry.getStaticWidget(widgetId))
          .find((record) => record?.pluginId === missingPlugin.pluginId)
        const activationReason = staticWidget ? chooseWidgetActivationReason(staticWidget) : null

        if (!activationReason) {
          throw new Error(`Plugin ${missingPlugin.pluginId} has no supported widget activation event`)
        }

        await manager.ensureActivated(missingPlugin.pluginId, activationReason)
        return missingPlugin.pluginId
      }),
    ).then((results) => {
      if (disposed) {
        return
      }

      for (const result of results) {
        if (result.status === 'fulfilled') {
          continue
        }

        const error = result.reason
        console.error(`Failed to activate widget plugin for placement ${placement}`, error)
      }
    })

    return () => {
      disposed = true
    }
  }, [manager, placement, registry, state.missingPlugins])

  return (
    <>
      {state.widgets.map((widget) => (
        <div key={widget.widgetId}>
          {widget.render({ widgetId: widget.widgetId, pluginId: widget.pluginId })}
        </div>
      ))}
    </>
  )
}
