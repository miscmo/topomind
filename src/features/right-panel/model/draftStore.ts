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

type DraftPersistedState = Pick<DraftState, 'detailDrafts' | 'cardDrafts'>

const DRAFT_STORAGE_WRITE_DELAY_MS = 300

let persistTimer: number | null = null
let pendingPersistName: string | null = null
let pendingPersistValue: StorageValue<DraftPersistedState> | null = null
let pendingPersistRemove = false
let persistListenersRegistered = false
let persistFailureCount = 0
let lastPersistedValue: StorageValue<DraftPersistedState> | null = null
const pendingDirtyDetailPaths = new Set<string>()
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
    const previousDetailEntries = getIndexedEntries(name, 'detail', previousIndex)
    const previousCardEntries = getIndexedEntries(name, 'card', previousIndex)

    if (remove) {
      for (const storageKey of Object.values(previousDetailEntries)) {
        window.localStorage.removeItem(storageKey)
      }
      for (const storageKey of Object.values(previousCardEntries)) {
        window.localStorage.removeItem(storageKey)
      }
      window.localStorage.removeItem(`${name}:index`)
      window.localStorage.removeItem(name)
      lastPersistedValue = null
      pendingDirtyDetailPaths.clear()
      pendingDirtyCardPaths.clear()
    } else if (value !== null) {
      const nextState = value.state
      const detailDrafts = nextState.detailDrafts ?? {}
      const cardDrafts = nextState.cardDrafts ?? {}
      const revision = previousIndex?.version === 3 ? previousIndex.revision + 1 : 1
      const detailEntries: Record<string, string> = { ...previousDetailEntries }
      const cardEntries: Record<string, string> = { ...previousCardEntries }
      const staleStorageKeys: string[] = []

      for (const path of pendingDirtyDetailPaths) {
        const previousKey = previousDetailEntries[path]
        if (!(path in detailDrafts)) {
          delete detailEntries[path]
          if (previousKey) staleStorageKeys.push(previousKey)
          continue
        }
        const storageKey = getDraftStorageKey(name, 'detail', path, revision)
        window.localStorage.setItem(storageKey, JSON.stringify(detailDrafts[path]))
        detailEntries[path] = storageKey
        if (previousKey && previousKey !== storageKey) staleStorageKeys.push(previousKey)
      }
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
        detailEntries,
        cardEntries,
      }
      window.localStorage.setItem(`${name}:index`, JSON.stringify(nextIndex))

      for (const storageKey of new Set(staleStorageKeys)) {
        window.localStorage.removeItem(storageKey)
      }
      window.localStorage.removeItem(name)
      lastPersistedValue = value
      pendingDirtyDetailPaths.clear()
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
    const nextDetailDrafts = nextState.detailDrafts ?? {}
    const previousDetailDrafts = previousState?.detailDrafts ?? {}
    const nextCardDrafts = nextState.cardDrafts ?? {}
    const previousCardDrafts = previousState?.cardDrafts ?? {}

    for (const path of new Set([
      ...Object.keys(nextDetailDrafts),
      ...Object.keys(previousDetailDrafts),
    ])) {
      if (nextDetailDrafts[path] !== previousDetailDrafts[path]) {
        pendingDirtyDetailPaths.add(path)
      }
    }
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
      && pendingDirtyDetailPaths.size === 0
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

const draftPersistStorage: PersistStorage<DraftPersistedState> = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null
    const index = readDraftStorageIndex(name)
    if (index) {
      const value = {
        state: {
          detailDrafts: readDraftEntries(getIndexedEntries(name, 'detail', index)),
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
      // We only want to persist the drafts themselves, not the edit mode UI states
      partialize: (state) => ({
        detailDrafts: state.detailDrafts,
        cardDrafts: state.cardDrafts,
      }),
    }
  )
)
