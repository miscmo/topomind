import type { TopoMindPluginModule } from '../../public'
import { SampleView } from './SampleView'

const plugin: TopoMindPluginModule = {
  activate(ctx) {
    ctx.log.info('activate devtools sample plugin', { reason: ctx.activationReason })

    ctx.subscriptions.push(
      ctx.views.register({
        viewId: 'devtools.sample',
        render: () => (
          <SampleView
            pluginId={ctx.pluginId}
            activationReason={ctx.activationReason.type}
            workspaceId={ctx.workspace.getCurrentWorkspaceId()}
          />
        ),
      }),
    )

    ctx.subscriptions.push(
      ctx.commands.register({
        commandId: 'devtoolsSample.open',
        execute: async () => {
          await ctx.views.open('devtools.sample')
        },
      }),
    )
  },
}

export default plugin
