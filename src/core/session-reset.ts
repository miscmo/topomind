import { useAppStore } from '../stores/appStore'
import { tabStore } from '../stores/tabStore'
import { useMonitorStore } from '../stores/monitorStore'

export function resetClientSession() {
  useMonitorStore.getState().reset()
  tabStore.getState().reset()
  tabStore.getState().initHomeTab()
  useAppStore.getState().reset()
}
