import { create } from 'zustand'

interface MarkdownStorage {
  readCardMarkdown: (cardPath: string) => Promise<string>
}

interface CardContentEntry {
  content: string
  loading: boolean
  error: string | null
}

interface CardContentStore {
  entries: Record<string, CardContentEntry>
  loadCardMarkdown: (path: string, storage: MarkdownStorage) => Promise<void>
  setCardMarkdown: (path: string, content: string) => void
}

export const useCardContentStore = create<CardContentStore>((set, get) => ({
  entries: {},
  loadCardMarkdown: async (path, storage) => {
    if (!path) return
    const existing = get().entries[path]
    if (existing?.loading || (existing && existing.error === null)) return

    set((state) => ({
      entries: {
        ...state.entries,
        [path]: { content: existing?.content ?? '', loading: true, error: null },
      },
    }))

    try {
      const content = await storage.readCardMarkdown(path)
      set((state) => ({
        entries: {
          ...state.entries,
          [path]: { content, loading: false, error: null },
        },
      }))
    } catch {
      set((state) => ({
        entries: {
          ...state.entries,
          [path]: {
            content: '',
            loading: false,
            error: null,
          },
        },
      }))
    }
  },
  setCardMarkdown: (path, content) => {
    if (!path) return
    set((state) => ({
      entries: {
        ...state.entries,
        [path]: { content, loading: false, error: null },
      },
    }))
  },
}))
