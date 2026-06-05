import type { ActivationReason } from '../public/plugin'
import type { StaticContributionRecord } from './pluginTypes'

function activationReasonFromEvent(event: string): ActivationReason | null {
  if (event === 'onAppReady') {
    return { type: 'app-ready' }
  }

  if (event === 'onWorkspaceReady') {
    return { type: 'workspace-ready' }
  }

  if (event.startsWith('onCommand:')) {
    return { type: 'command', commandId: event.slice('onCommand:'.length) }
  }

  if (event.startsWith('onViewOpen:')) {
    return { type: 'view', viewId: event.slice('onViewOpen:'.length) }
  }

  return null
}

export function chooseWidgetActivationReason(
  record: StaticContributionRecord,
): ActivationReason | null {
  for (const event of record.activationEvents) {
    const reason = activationReasonFromEvent(event)
    if (reason) {
      return reason
    }
  }

  return null
}
