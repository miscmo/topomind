import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TopoDocumentManifestItem, TrashTopoDocumentItem } from '../../../core/storage'
import type { DetailSidebarTab } from '../../documents/types/workspaceTypes'

interface DetailPanelStore {
  activeDocumentKeysByNodeId: Record<string, string>
  detailSidebarTabsByNodeId: Record<string, DetailSidebarTab>
  documentListsByCardRef: Record<string, TopoDocumentManifestItem[]>
  trashDocumentListsByCardRef: Record<string, TrashTopoDocumentItem[]>
  setActiveDocumentKeyForNode: (nodeId: string, documentKey: string) => void
  setDetailSidebarTabForNode: (nodeId: string, tab: DetailSidebarTab) => void
  setDocumentListForCardRef: (cardRef: string, documents: TopoDocumentManifestItem[]) => void
  setTrashDocumentListForCardRef: (cardRef: string, documents: TrashTopoDocumentItem[]) => void
  clearCardDocumentCache: (cardRef: string) => void
}

export const useDetailPanelStore = create<DetailPanelStore>()(
  persist(
    (set) => ({
      activeDocumentKeysByNodeId: {},
      detailSidebarTabsByNodeId: {},
      documentListsByCardRef: {},
      trashDocumentListsByCardRef: {},
      setActiveDocumentKeyForNode: (nodeId, documentKey) => {
        if (!nodeId) return
        set((state) => ({
          activeDocumentKeysByNodeId: {
            ...state.activeDocumentKeysByNodeId,
            [nodeId]: documentKey,
          },
        }))
      },
      setDetailSidebarTabForNode: (nodeId, tab) => {
        if (!nodeId) return
        set((state) => ({
          detailSidebarTabsByNodeId: {
            ...state.detailSidebarTabsByNodeId,
            [nodeId]: tab,
          },
        }))
      },
      setDocumentListForCardRef: (cardRef, documents) => {
        if (!cardRef) return
        set((state) => ({
          documentListsByCardRef: {
            ...state.documentListsByCardRef,
            [cardRef]: documents,
          },
        }))
      },
      setTrashDocumentListForCardRef: (cardRef, documents) => {
        if (!cardRef) return
        set((state) => ({
          trashDocumentListsByCardRef: {
            ...state.trashDocumentListsByCardRef,
            [cardRef]: documents,
          },
        }))
      },
      clearCardDocumentCache: (cardRef) => {
        if (!cardRef) return
        set((state) => {
          const { [cardRef]: _documents, ...restDocuments } = state.documentListsByCardRef
          const { [cardRef]: _trashDocuments, ...restTrashDocuments } = state.trashDocumentListsByCardRef
          return {
            documentListsByCardRef: restDocuments,
            trashDocumentListsByCardRef: restTrashDocuments,
          }
        })
      },
    }),
    {
      name: 'topomind-detail-panel-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeDocumentKeysByNodeId: state.activeDocumentKeysByNodeId,
        detailSidebarTabsByNodeId: state.detailSidebarTabsByNodeId,
      }),
    }
  )
)
