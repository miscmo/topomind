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

function flushPendingDraftPersist() {
  if (typeof window === 'undefined' || pendingPersistName === null) return

  try {
    if (pendingPersistRemove) {
      window.localStorage.removeItem(pendingPersistName)
    } else if (pendingPersistValue !== null) {
      window.localStorage.setItem(pendingPersistName, JSON.stringify(pendingPersistValue))
    }
  } finally {
    pendingPersistName = null
    pendingPersistValue = null
    pendingPersistRemove = false
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer)
      persistTimer = null
    }
  }
}

function scheduleDraftPersist(
  name: string,
  value: StorageValue<DraftPersistedState> | null,
  remove = false,
) {
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
    const rawValue = window.localStorage.getItem(name)
    if (!rawValue) return null
    try {
      return JSON.parse(rawValue) as StorageValue<DraftPersistedState>
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
      setDetailDraft: (path, draft) => set((state) => ({ detailDrafts: { ...state.detailDrafts, [path]: draft } })),
      setDetailEditMode: (path, editMode) => set((state) => ({ detailEditModes: { ...state.detailEditModes, [path]: editMode } })),
      clearDetailDraft: (path) => set((state) => {
        const { [path]: _, ...restDrafts } = state.detailDrafts
        const { [path]: __, ...restModes } = state.detailEditModes
        return { detailDrafts: restDrafts, detailEditModes: restModes }
      }),

      cardDrafts: {},
      cardEditModes: {},
      setCardDraft: (path, draft) => set((state) => ({ cardDrafts: { ...state.cardDrafts, [path]: draft } })),
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
