import { create } from 'zustand'

interface CardContentEntry {
  content: string
  loading: boolean
  error: string | null
}

interface CardContentStore {
  detailEntries: Record<string, CardContentEntry>
  setDetailContent: (path: string, content: string) => void
  clearDetailContent: (path: string) => void
}

export const useCardContentStore = create<CardContentStore>((set) => ({
  detailEntries: {},
  setDetailContent: (path, content) => {
    if (!path) return
    set((state) => ({
      detailEntries: {
        ...state.detailEntries,
        [path]: { content, loading: false, error: null },
      },
    }))
  },
  clearDetailContent: (path) => {
    if (!path) return
    set((state) => {
      const { [path]: _, ...restEntries } = state.detailEntries
      return { detailEntries: restEntries }
    })
  },
}))
