import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'

interface DraftState {
  detailDrafts: Record<string, unknown>
  detailEditModes: Record<string, boolean>
  setDetailDraft: (path: string, draft: unknown) => void
  setDetailEditMode: (path: string, editMode: boolean) => void
  clearDetailDraft: (path: string) => void

  cardDrafts: Record<string, string>
  cardEditModes: Record<string, boolean>
  setCardDraft: (path: string, draft: string) => void
  setCardEditMode: (path: string, editMode: boolean) => void
  clearCardDraft: (path: string) => void
}

type DraftPersistedState = Pick<DraftState, 'cardDrafts'>

const DRAFT_STORAGE_WRITE_DELAY_MS = 300

let persistTimer: number | null = null
let pendingPersistName: string | null = null
let pendingPersistValue: StorageValue<DraftPersistedState> | null = null
let pendingPersistRemove = false
let persistListenersRegistered = false
let persistFailureCount = 0
let lastPersistedValue: StorageValue<DraftPersistedState> | null = null
const pendingDirtyCardPaths = new Set<string>()

type DraftStorageIndex = {
  version: 3
  revision: number
  detailEntries: Record<string, string>
  cardEntries: Record<string, string>
}

type LegacyDraftStorageIndex = {
  version: 2
  detailKeys: string[]
  cardKeys: string[]
}

type AnyDraftStorageIndex = DraftStorageIndex | LegacyDraftStorageIndex

function getLegacyDraftStorageKey(name: string, kind: 'detail' | 'card', path: string) {
  return `${name}:${kind}:${encodeURIComponent(path)}`
}

function getDraftStorageKey(name: string, kind: 'detail' | 'card', path: string, revision: number) {
  return `${name}:${kind}:v${revision}:${encodeURIComponent(path)}`
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && Object.values(value).every((entry) => typeof entry === 'string')
}

function readDraftStorageIndex(name: string): AnyDraftStorageIndex | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(`${name}:index`)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed.version === 3
      && typeof parsed.revision === 'number'
      && isStringRecord(parsed.detailEntries)
      && isStringRecord(parsed.cardEntries)
    ) {
      return {
        version: 3,
        revision: parsed.revision,
        detailEntries: parsed.detailEntries,
        cardEntries: parsed.cardEntries,
      }
    }
    if (parsed.version === 2 && Array.isArray(parsed.detailKeys) && Array.isArray(parsed.cardKeys)) {
      return {
        version: 2,
        detailKeys: parsed.detailKeys.filter((key): key is string => typeof key === 'string'),
        cardKeys: parsed.cardKeys.filter((key): key is string => typeof key === 'string'),
      }
    }
    return null
  } catch {
    return null
  }
}

function getIndexedEntries(name: string, kind: 'detail' | 'card', index: AnyDraftStorageIndex | null) {
  if (!index) return {}
  if (index.version === 3) {
    return kind === 'detail' ? index.detailEntries : index.cardEntries
  }
  const paths = kind === 'detail' ? index.detailKeys : index.cardKeys
  return Object.fromEntries(paths.map((path) => [path, getLegacyDraftStorageKey(name, kind, path)]))
}

function readDraftEntries(entries: Record<string, string>) {
  if (typeof window === 'undefined') return {}
  return Object.fromEntries(Object.entries(entries).flatMap(([path, storageKey]) => {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    try {
      return [[path, JSON.parse(raw)]]
    } catch {
      return []
    }
  }))
}

export function flushPendingDraftPersist(): boolean {
  if (typeof window === 'undefined' || pendingPersistName === null) return true

  const name = pendingPersistName
  const value = pendingPersistValue
  const remove = pendingPersistRemove
  try {
    const previousIndex = readDraftStorageIndex(name)
    const previousCardEntries = getIndexedEntries(name, 'card', previousIndex)

    if (remove) {
      for (const storageKey of Object.values(previousCardEntries)) {
        window.localStorage.removeItem(storageKey)
      }
      window.localStorage.removeItem(`${name}:index`)
      window.localStorage.removeItem(name)
      lastPersistedValue = null
      pendingDirtyCardPaths.clear()
    } else if (value !== null) {
      const nextState = value.state
      const cardDrafts = nextState.cardDrafts ?? {}
      const revision = previousIndex?.version === 3 ? previousIndex.revision + 1 : 1
      const cardEntries: Record<string, string> = { ...previousCardEntries }
      const staleStorageKeys: string[] = []

      for (const path of pendingDirtyCardPaths) {
        const previousKey = previousCardEntries[path]
        if (!(path in cardDrafts)) {
          delete cardEntries[path]
          if (previousKey) staleStorageKeys.push(previousKey)
          continue
        }
        const storageKey = getDraftStorageKey(name, 'card', path, revision)
        window.localStorage.setItem(storageKey, JSON.stringify(cardDrafts[path]))
        cardEntries[path] = storageKey
        if (previousKey && previousKey !== storageKey) staleStorageKeys.push(previousKey)
      }

      const nextIndex: DraftStorageIndex = {
        version: 3,
        revision,
        detailEntries: {},
        cardEntries,
      }
      window.localStorage.setItem(`${name}:index`, JSON.stringify(nextIndex))

      for (const storageKey of new Set(staleStorageKeys)) {
        window.localStorage.removeItem(storageKey)
      }
      window.localStorage.removeItem(name)
      lastPersistedValue = value
      pendingDirtyCardPaths.clear()
    }
    persistFailureCount = 0
    pendingPersistName = null
    pendingPersistValue = null
    pendingPersistRemove = false
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer)
      persistTimer = null
    }
    return true
  } catch (error) {
    persistFailureCount += 1
    // Keep the snapshot for a later retry. Do not clear it in a finally block:
    // quota/security failures must not silently lose the user's local draft.
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer)
      persistTimer = null
    }
    if (persistFailureCount <= 3) {
      persistTimer = window.setTimeout(() => {
        flushPendingDraftPersist()
      }, DRAFT_STORAGE_WRITE_DELAY_MS * persistFailureCount)
    }
    console.warn('[draftStore] 本地草稿持久化失败，已保留待重试快照', error)
    return false
  }
}

function scheduleDraftPersist(
  name: string,
  value: StorageValue<DraftPersistedState> | null,
  remove = false,
) {
  if (!remove && value !== null) {
    const nextState = value.state
    const previousState = lastPersistedValue?.state
    const nextCardDrafts = nextState.cardDrafts ?? {}
    const previousCardDrafts = previousState?.cardDrafts ?? {}

    for (const path of new Set([
      ...Object.keys(nextCardDrafts),
      ...Object.keys(previousCardDrafts),
    ])) {
      if (nextCardDrafts[path] !== previousCardDrafts[path]) {
        pendingDirtyCardPaths.add(path)
      }
    }

    if (
      lastPersistedValue
      && pendingDirtyCardPaths.size === 0
    ) {
      return
    }
  }

  pendingPersistName = name
  pendingPersistValue = value
  pendingPersistRemove = remove

  if (typeof window === 'undefined') return

  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
  }

  persistTimer = window.setTimeout(() => {
    flushPendingDraftPersist()
  }, DRAFT_STORAGE_WRITE_DELAY_MS)
}

if (typeof window !== 'undefined' && !persistListenersRegistered) {
  window.addEventListener('beforeunload', flushPendingDraftPersist)
  window.addEventListener('pagehide', flushPendingDraftPersist)
  persistListenersRegistered = true
}

// Older builds persisted full document bodies as detail drafts in localStorage.
// That is unbounded (documents can embed base64 images) and is what made the app
// freeze on startup once enough had accumulated. Detail drafts are now kept in
// memory only and re-seeded from the authoritative topo copy, so drop the legacy
// blobs here. Idempotent and safe: the saved content always lives in topo, and
// the close-guard flushes any dirty draft to topo before the app quits.
function cleanupLegacyDetailDrafts(name: string) {
  if (typeof window === 'undefined') return
  const detailPrefix = `${name}:detail:`
  const toRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (!key) continue
    if (key.startsWith(detailPrefix) || key === name) {
      toRemove.push(key)
    }
  }
  for (const key of toRemove) window.localStorage.removeItem(key)
  const indexRaw = window.localStorage.getItem(`${name}:index`)
  if (indexRaw) {
    try {
      const index = JSON.parse(indexRaw) as AnyDraftStorageIndex
      if (index && index.version === 3) {
        const cleaned: DraftStorageIndex = { ...index, detailEntries: {} }
        window.localStorage.setItem(`${name}:index`, JSON.stringify(cleaned))
      }
    } catch {
      // ignore malformed index
    }
  }
}

const draftPersistStorage: PersistStorage<DraftPersistedState> = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null
    cleanupLegacyDetailDrafts(name)
    const index = readDraftStorageIndex(name)
    if (index) {
      const value = {
        state: {
          cardDrafts: readDraftEntries(getIndexedEntries(name, 'card', index)),
        },
        version: 0,
      } as StorageValue<DraftPersistedState>
      lastPersistedValue = value
      return value
    }

    const rawValue = window.localStorage.getItem(name)
    if (!rawValue) return null
    try {
      const value = JSON.parse(rawValue) as StorageValue<DraftPersistedState>
      lastPersistedValue = value
      return value
    } catch {
      window.localStorage.removeItem(name)
      return null
    }
  },
  setItem: (name, value) => {
    scheduleDraftPersist(name, value)
  },
  removeItem: (name) => {
    scheduleDraftPersist(name, null, true)
  },
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      detailDrafts: {},
      detailEditModes: {},
      setDetailDraft: (path, draft) => set((state) => (
        state.detailDrafts[path] === draft
          ? state
          : { detailDrafts: { ...state.detailDrafts, [path]: draft } }
      )),
      setDetailEditMode: (path, editMode) => set((state) => ({ detailEditModes: { ...state.detailEditModes, [path]: editMode } })),
      clearDetailDraft: (path) => set((state) => {
        const { [path]: _, ...restDrafts } = state.detailDrafts
        const { [path]: __, ...restModes } = state.detailEditModes
        return { detailDrafts: restDrafts, detailEditModes: restModes }
      }),

      cardDrafts: {},
      cardEditModes: {},
      setCardDraft: (path, draft) => set((state) => (
        state.cardDrafts[path] === draft
          ? state
          : { cardDrafts: { ...state.cardDrafts, [path]: draft } }
      )),
      setCardEditMode: (path, editMode) => set((state) => ({ cardEditModes: { ...state.cardEditModes, [path]: editMode } })),
      clearCardDraft: (path) => set((state) => {
        const { [path]: _, ...restDrafts } = state.cardDrafts
        const { [path]: __, ...restModes } = state.cardEditModes
        return { cardDrafts: restDrafts, cardEditModes: restModes }
      }),
    }),
    {
      name: 'topomind-draft-storage',
      storage: draftPersistStorage,
      // We only want to persist the drafts themselves, not the edit mode UI states.
      // Detail drafts are intentionally NOT persisted: they are full document bodies
      // (which may embed base64 images) and would unboundedly bloat localStorage,
      // freezing startup. They live in memory and are re-seeded from the authoritative
      // topo copy on open; card drafts are small text snippets and safe to persist.
      partialize: (state) => ({
        cardDrafts: state.cardDrafts,
      }),
    }
  )
)
