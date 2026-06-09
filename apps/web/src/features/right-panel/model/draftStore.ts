import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface DraftState {
  documentDrafts: Record<string, unknown>
  documentEditModes: Record<string, boolean>
  setDocumentDraft: (documentKey: string, draft: unknown) => void
  setDocumentEditMode: (documentKey: string, editMode: boolean) => void
  clearDocumentDraft: (documentKey: string) => void

  cardRefDrafts: Record<string, string>
  cardRefEditModes: Record<string, boolean>
  setCardDraft: (cardRef: string, draft: string) => void
  setCardEditMode: (cardRef: string, editMode: boolean) => void
  clearCardDraft: (cardRef: string) => void
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      documentDrafts: {},
      documentEditModes: {},
      setDocumentDraft: (documentKey, draft) => set((state) => ({ documentDrafts: { ...state.documentDrafts, [documentKey]: draft } })),
      setDocumentEditMode: (documentKey, editMode) => set((state) => ({ documentEditModes: { ...state.documentEditModes, [documentKey]: editMode } })),
      clearDocumentDraft: (documentKey) => set((state) => {
        const { [documentKey]: _, ...restDrafts } = state.documentDrafts
        const { [documentKey]: __, ...restModes } = state.documentEditModes
        return { documentDrafts: restDrafts, documentEditModes: restModes }
      }),

      cardRefDrafts: {},
      cardRefEditModes: {},
      setCardDraft: (cardRef, draft) => set((state) => ({ cardRefDrafts: { ...state.cardRefDrafts, [cardRef]: draft } })),
      setCardEditMode: (cardRef, editMode) => set((state) => ({ cardRefEditModes: { ...state.cardRefEditModes, [cardRef]: editMode } })),
      clearCardDraft: (cardRef) => set((state) => {
        const { [cardRef]: _, ...restDrafts } = state.cardRefDrafts
        const { [cardRef]: __, ...restModes } = state.cardRefEditModes
        return { cardRefDrafts: restDrafts, cardRefEditModes: restModes }
      }),
    }),
    {
      name: 'topomind-draft-storage',
      storage: createJSONStorage(() => localStorage),
      // We only want to persist the drafts themselves, not the edit mode UI states
      partialize: (state) => ({
        documentDrafts: state.documentDrafts,
        cardRefDrafts: state.cardRefDrafts,
      }),
    }
  )
)
