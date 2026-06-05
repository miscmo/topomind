import { createElement } from 'react'

import type { TopoMindPluginModule } from '../../public'
import { MonitorPageEntry } from './MonitorPageEntry.ts'

const plugin: TopoMindPluginModule = {
  activate(ctx) {
    ctx.log.info('activate monitor plugin', { reason: ctx.activationReason })

    ctx.subscriptions.push(
      ctx.views.register({
        viewId: 'monitor.logs',
        render: () =>
          createElement(MonitorPageEntry, {
            logs: ctx.logs,
            performance: ctx.performance,
            plugins: ctx.plugins,
            log: ctx.log,
          }),
      }),
    )

    ctx.subscriptions.push(
      ctx.commands.register({
        commandId: 'monitor.open',
        execute: async () => {
          await ctx.views.open('monitor.logs')
        },
      }),
    )
  },
}

export default plugin
