import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import { getPluginManager } from '../bootstrap'
import type { StaticContributionRecord } from './pluginTypes'

interface WidgetSlotState {
  widgets: Array<{
    widgetId: string
    pluginId: string
    render: (props: { widgetId: string; pluginId: string }) => ReactNode
  }>
  missingPluginIds: string[]
}

export interface PluginWidgetSlotProps {
  placement: 'titlebar' | 'home'
}

function readRuntimeWidgets(
  staticWidgets: StaticContributionRecord[],
  getRenderer: (widgetId: string) => ((props: { widgetId: string; pluginId: string }) => ReactNode) | undefined,
): WidgetSlotState {
  const missingPluginIds = new Set<string>()

  return {
    widgets: staticWidgets.flatMap((record) => {
      const render = getRenderer(record.contributionId)
      if (!render) {
        missingPluginIds.add(record.pluginId)
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
    missingPluginIds: [...missingPluginIds],
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
    () => ({ widgets: [], missingPluginIds: [] }),
  )

  useEffect(() => {
    attemptedPluginIdsRef.current.clear()
  }, [placement])

  useEffect(() => {
    const missingPluginIds = state.missingPluginIds.filter(
      (pluginId) => !attemptedPluginIdsRef.current.has(pluginId),
    )

    if (missingPluginIds.length === 0) {
      return
    }

    let disposed = false
    for (const pluginId of missingPluginIds) {
      attemptedPluginIdsRef.current.add(pluginId)
    }

    void Promise.allSettled(
      missingPluginIds.map(async (pluginId) => {
        await manager.ensureActivated(pluginId, { type: 'app-ready' })
        return pluginId
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
  }, [manager, placement, state.missingPluginIds])

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
