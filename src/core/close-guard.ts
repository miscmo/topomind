type Saver = () => Promise<void>
type DirtyChecker = () => boolean

interface SaverEntry {
  id: symbol
  saver: Saver
  isDirty: DirtyChecker
}

const tabSavers = new Map<string, SaverEntry[]>()

export function registerTabSaver(tabId: string, saver: Saver, isDirty: DirtyChecker = () => true) {
  const entry: SaverEntry = { id: Symbol(tabId), saver, isDirty }
  const entries = tabSavers.get(tabId) ?? []
  entries.push(entry)
  tabSavers.set(tabId, entries)
  return () => {
    const current = tabSavers.get(tabId)
    if (!current) return
    const next = current.filter((item) => item.id !== entry.id)
    if (next.length === 0) {
      tabSavers.delete(tabId)
    } else {
      tabSavers.set(tabId, next)
    }
  }
}

export async function flushTabs(tabIds: string[]): Promise<{ ok: boolean; failedTabId?: string }> {
  for (const tabId of tabIds) {
    const entries = tabSavers.get(tabId)
    if (!entries) continue
    for (const entry of entries) {
      try {
        await entry.saver()
      } catch {
        return { ok: false, failedTabId: tabId }
      }
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
    .filter(([, entries]) => entries.some((entry) => entry.isDirty()))
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
