import { create } from 'zustand'

interface MarkdownStorage {
  readMarkdown: (cardPath: string) => Promise<string>
  readCardMarkdown: (cardPath: string) => Promise<string>
}

interface CardContentEntry {
  content: string
  loading: boolean
  error: string | null
}

interface CardContentStore {
  entries: Record<string, CardContentEntry>
  detailEntries: Record<string, CardContentEntry>
  loadCardMarkdown: (path: string, storage: MarkdownStorage) => Promise<void>
  loadDetailMarkdown: (path: string, storage: Pick<MarkdownStorage, 'readMarkdown'>) => Promise<void>
  setCardMarkdown: (path: string, content: string) => void
  setDetailMarkdown: (path: string, content: string) => void
  clearDetailMarkdown: (path: string) => void
}

export const useCardContentStore = create<CardContentStore>((set, get) => ({
  entries: {},
  detailEntries: {},
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
  loadDetailMarkdown: async (path, storage) => {
    if (!path) return
    const existing = get().detailEntries[path]
    if (existing?.loading || (existing && existing.error === null)) return

    set((state) => ({
      detailEntries: {
        ...state.detailEntries,
        [path]: { content: existing?.content ?? '', loading: true, error: null },
      },
    }))

    try {
      const content = await storage.readMarkdown(path)
      set((state) => ({
        detailEntries: {
          ...state.detailEntries,
          [path]: { content, loading: false, error: null },
        },
      }))
    } catch {
      set((state) => ({
        detailEntries: {
          ...state.detailEntries,
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
