import { create } from 'zustand'

interface CardContentEntry {
  content: unknown
  loading: boolean
  error: string | null
}

interface CardContentStore {
  documentContentEntries: Record<string, CardContentEntry>
  setDocumentContent: (documentKey: string, content: unknown) => void
  clearDocumentContent: (documentKey: string) => void
}

export const useCardContentStore = create<CardContentStore>((set) => ({
  documentContentEntries: {},
  setDocumentContent: (documentKey, content) => {
    if (!documentKey) return
    set((state) => ({
      documentContentEntries: {
        ...state.documentContentEntries,
        [documentKey]: { content, loading: false, error: null },
      },
    }))
  },
  clearDocumentContent: (documentKey) => {
    if (!documentKey) return
    set((state) => {
      const { [documentKey]: _, ...restEntries } = state.documentContentEntries
      return { documentContentEntries: restEntries }
    })
  },
}))
