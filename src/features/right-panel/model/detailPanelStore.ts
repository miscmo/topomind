import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { FSBTrashTopoDocumentItem } from '../../../core/fs-backend'
import type { TopoDocumentManifestItem } from '../../../core/storage'
import type { DetailSidebarTab } from '../../documents/types/workspaceTypes'

interface DetailPanelStore {
  activeDocumentPathsByNodeId: Record<string, string>
  detailSidebarTabsByNodeId: Record<string, DetailSidebarTab>
  documentListsByNodePath: Record<string, TopoDocumentManifestItem[]>
  trashDocumentListsByNodePath: Record<string, FSBTrashTopoDocumentItem[]>
  setActiveDocumentPathForNode: (nodeId: string, path: string) => void
  setDetailSidebarTabForNode: (nodeId: string, tab: DetailSidebarTab) => void
  setDocumentListForNodePath: (nodePath: string, documents: TopoDocumentManifestItem[]) => void
  setTrashDocumentListForNodePath: (nodePath: string, documents: FSBTrashTopoDocumentItem[]) => void
  clearNodeDocumentCache: (nodePath: string) => void
}

export const useDetailPanelStore = create<DetailPanelStore>()(
  persist(
    (set) => ({
      activeDocumentPathsByNodeId: {},
      detailSidebarTabsByNodeId: {},
      documentListsByNodePath: {},
      trashDocumentListsByNodePath: {},
      setActiveDocumentPathForNode: (nodeId, path) => {
        if (!nodeId) return
        set((state) => ({
          activeDocumentPathsByNodeId: {
            ...state.activeDocumentPathsByNodeId,
            [nodeId]: path,
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
      setDocumentListForNodePath: (nodePath, documents) => {
        if (!nodePath) return
        set((state) => ({
          documentListsByNodePath: {
            ...state.documentListsByNodePath,
            [nodePath]: documents,
          },
        }))
      },
      setTrashDocumentListForNodePath: (nodePath, documents) => {
        if (!nodePath) return
        set((state) => ({
          trashDocumentListsByNodePath: {
            ...state.trashDocumentListsByNodePath,
            [nodePath]: documents,
          },
        }))
      },
      clearNodeDocumentCache: (nodePath) => {
        if (!nodePath) return
        set((state) => {
          const { [nodePath]: _documents, ...restDocuments } = state.documentListsByNodePath
          const { [nodePath]: _trashDocuments, ...restTrashDocuments } = state.trashDocumentListsByNodePath
          return {
            documentListsByNodePath: restDocuments,
            trashDocumentListsByNodePath: restTrashDocuments,
          }
        })
      },
    }),
    {
      name: 'topomind-detail-panel-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeDocumentPathsByNodeId: state.activeDocumentPathsByNodeId,
        detailSidebarTabsByNodeId: state.detailSidebarTabsByNodeId,
      }),
    }
  )
)
