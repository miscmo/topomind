import { create } from 'zustand'

interface CardContentEntry {
  content: string
  loading: boolean
  error: string | null
}

interface CardContentStore {
  detailEntries: Record<string, CardContentEntry>
  setDetailMarkdown: (path: string, content: string) => void
  clearDetailMarkdown: (path: string) => void
}

export const useCardContentStore = create<CardContentStore>((set) => ({
  detailEntries: {},
  setDetailMarkdown: (path, content) => {
    if (!path) return
    set((state) => ({
      detailEntries: {
        ...state.detailEntries,
        [path]: { content, loading: false, error: null },
      },
    }))
  },
  clearDetailMarkdown: (path) => {
    if (!path) return
    set((state) => {
      const { [path]: _, ...restEntries } = state.detailEntries
      return { detailEntries: restEntries }
    })
  },
}))
