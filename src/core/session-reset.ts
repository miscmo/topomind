import { useAppStore } from '../stores/appStore'
import { tabStore } from '../stores/tabStore'
import { roomStore } from '../stores/roomStore'
import { useMonitorStore } from '../stores/monitorStore'
import { Store } from './storage'

export function resetClientSession() {
  try {
    Store.revokeAllImageUrls()
  } catch {
    // ignore cleanup errors during session reset
  }

  useMonitorStore.getState().reset()
  roomStore.getState().reset()
  tabStore.getState().reset()
  tabStore.getState().initHomeTab()
  useAppStore.getState().reset()
}
