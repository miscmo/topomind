import { createElement } from 'react'

import type { TopoMindPluginModule } from '../../public'
import { LearningStatisticsPageEntry } from './LearningStatisticsPageEntry.ts'
import { LearningTrackerWidgetEntry } from './LearningTrackerWidgetEntry.ts'

const plugin: TopoMindPluginModule = {
  activate(ctx) {
    ctx.log.info('activate learning statistics plugin', { reason: ctx.activationReason })

    ctx.subscriptions.push(
      ctx.views.register({
        viewId: 'learning.statistics',
        render: () =>
          createElement(LearningStatisticsPageEntry, {
            learning: ctx.learning,
            workspace: ctx.workspace,
            onBackHome: () => ctx.commands.execute('home.open'),
          }),
      }),
    )

    ctx.subscriptions.push(
      ctx.commands.register({
        commandId: 'learning.open',
        execute: async () => {
          await ctx.views.open('learning.statistics')
        },
      }),
    )

    ctx.subscriptions.push(
      ctx.ui.registerWidget({
        widgetId: 'learning.titlebar.overview',
        placement: 'titlebar',
        render: () =>
          createElement(LearningTrackerWidgetEntry, {
            learning: ctx.learning,
            workspace: ctx.workspace,
            onOpenStatistics: () => ctx.views.open('learning.statistics'),
          }),
      }),
    )
  },
}

export default plugin
