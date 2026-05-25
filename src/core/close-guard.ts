type Saver = () => Promise<void>
type DirtyChecker = () => boolean

const tabSavers = new Map<string, { saver: Saver; isDirty: DirtyChecker }>()

export function registerTabSaver(tabId: string, saver: Saver, isDirty: DirtyChecker = () => true) {
  tabSavers.set(tabId, { saver, isDirty })
  return () => {
    const current = tabSavers.get(tabId)
    if (current?.saver === saver) {
      tabSavers.delete(tabId)
    }
  }
}

export async function flushTabs(tabIds: string[]): Promise<{ ok: boolean; failedTabId?: string }> {
  for (const tabId of tabIds) {
    const entry = tabSavers.get(tabId)
    if (!entry) continue
    try {
      await entry.saver()
    } catch {
      return { ok: false, failedTabId: tabId }
    }
  }
  return { ok: true }
}

export async function flushAllTabs(): Promise<{ ok: boolean; failedTabId?: string }> {
  const allTabIds = Array.from(tabSavers.keys())
  return flushTabs(allTabIds)
}

export function getDirtyState(): { hasDirty: boolean; dirtyTabIds: string[] } {
  const dirtyTabIds = Array.from(tabSavers.entries())
    .filter(([, entry]) => entry.isDirty())
    .map(([tabId]) => tabId)
  return { hasDirty: dirtyTabIds.length > 0, dirtyTabIds }
}

export async function flushAllDirtyTabs(): Promise<{ ok: boolean; failedTabId?: string }> {
  return flushTabs(getDirtyState().dirtyTabIds)
}

// Expose close-guard helpers for the Electron main process quit/switch-workdir flow.
if (typeof window !== 'undefined') {
  ;(window as typeof window & {
    __topomindCloseGuard?: {
      getDirtyState: () => { hasDirty: boolean; dirtyTabIds: string[] }
      flushAllTabs: () => Promise<{ ok: boolean; failedTabId?: string }>
      flushAllDirtyTabs: () => Promise<{ ok: boolean; failedTabId?: string }>
    }
  }).__topomindCloseGuard = {
    getDirtyState,
    flushAllTabs,
    flushAllDirtyTabs,
  }
}
