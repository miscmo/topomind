import { tabStore } from '../stores/tabStore'

type Saver = () => Promise<void>

const tabSavers = new Map<string, Saver>()

function getDirtyTabIds(): string[] {
  return tabStore.getState().tabs.filter((tab) => tab.type === 'kb' && tab.isDirty).map((tab) => tab.id)
}

export function registerTabSaver(tabId: string, saver: Saver) {
  tabSavers.set(tabId, saver)
  return () => {
    const current = tabSavers.get(tabId)
    if (current === saver) {
      tabSavers.delete(tabId)
    }
  }
}

export async function flushTabs(tabIds: string[]): Promise<{ ok: boolean; failedTabId?: string }> {
  for (const tabId of tabIds) {
    const saver = tabSavers.get(tabId)
    if (!saver) continue
    try {
      await saver()
      tabStore.getState().setTabDirty(tabId, false)
    } catch {
      return { ok: false, failedTabId: tabId }
    }
  }
  return { ok: true }
}

export async function flushAllDirtyTabs(): Promise<{ ok: boolean; failedTabId?: string }> {
  return flushTabs(getDirtyTabIds())
}

export function hasDirtyTabs(): boolean {
  return getDirtyTabIds().length > 0
}

export function getDirtyState() {
  const dirtyTabIds = getDirtyTabIds()
  return {
    hasDirty: dirtyTabIds.length > 0,
    dirtyTabIds,
  }
}

if (typeof window !== 'undefined') {
  ;(window as typeof window & {
    __topomindCloseGuard?: {
      hasDirtyTabs: () => boolean
      getDirtyState: () => { hasDirty: boolean; dirtyTabIds: string[] }
      flushAllDirtyTabs: () => Promise<{ ok: boolean; failedTabId?: string }>
    }
  }).__topomindCloseGuard = {
    hasDirtyTabs,
    getDirtyState,
    flushAllDirtyTabs,
  }
}
