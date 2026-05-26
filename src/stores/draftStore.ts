import { create } from 'zustand'

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

export const useDraftStore = create<DraftState>((set) => ({
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
}))
