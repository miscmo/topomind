type Saver = () => Promise<void>

const tabSavers = new Map<string, Saver>()

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

// Expose close-guard helpers for the Electron main process quit/switch-workdir flow.
if (typeof window !== 'undefined') {
  ;(window as typeof window & {
    __topomindCloseGuard?: {
      flushAllTabs: () => Promise<{ ok: boolean; failedTabId?: string }>
    }
  }).__topomindCloseGuard = {
    flushAllTabs,
  }
}
