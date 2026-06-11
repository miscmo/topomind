type Saver = () => Promise<void>
type DirtyChecker = () => boolean

interface CloseGuardRequestMessage {
  requestId: string
  type: 'get-dirty-state' | 'flush-all-tabs' | 'flush-dirty-tabs'
}

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

export async function flushTabs(tabIds: string[]): Promise<{ ok: boolean; failedTabId?: string; error?: string }> {
  for (const tabId of tabIds) {
    const entries = tabSavers.get(tabId)
    if (!entries) continue
    for (const entry of entries) {
      try {
        await entry.saver()
      } catch (e) {
        console.error(`[close-guard] flush error on tab ${tabId}`, e)
        return { ok: false, failedTabId: tabId, error: e instanceof Error ? e.message : String(e) }
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

function isCloseGuardRequestMessage(value: unknown): value is CloseGuardRequestMessage {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<CloseGuardRequestMessage>
  return typeof request.requestId === 'string'
    && (request.type === 'get-dirty-state' || request.type === 'flush-all-tabs' || request.type === 'flush-dirty-tabs')
}

async function handleCloseGuardRequest(message: CloseGuardRequestMessage) {
  if (!window.electronAPI) return

  try {
    if (message.type === 'get-dirty-state') {
      window.electronAPI.send('app:close-guard:response', {
        requestId: message.requestId,
        type: message.type,
        result: getDirtyState(),
      })
      return
    }

    const result = message.type === 'flush-all-tabs'
      ? await flushAllTabs()
      : await flushAllDirtyTabs()

    window.electronAPI.send('app:close-guard:response', {
      requestId: message.requestId,
      type: message.type,
      result,
    })
  } catch (error) {
    window.electronAPI.send('app:close-guard:response', {
      requestId: message.requestId,
      type: message.type,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

if (typeof window !== 'undefined' && window.electronAPI) {
  window.electronAPI.on('app:close-guard:request', (message: unknown) => {
    if (!isCloseGuardRequestMessage(message)) return
    void handleCloseGuardRequest(message)
  })
}
