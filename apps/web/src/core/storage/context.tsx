import { createContext, useContext, useMemo } from 'react'
import { createRemoteStorageBackend } from './remote'
import { createStore, type Store as StoreType, type StorageBackend } from './service'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const StorageContext = createContext<StoreType | null>(null)

const WORKSPACE_NOT_READY_ERROR = '当前云端工作区尚未就绪，请稍后重试'

function createWorkspacePendingBackend(): StorageBackend {
  const unsupported = async (): Promise<never> => {
    throw new Error(WORKSPACE_NOT_READY_ERROR)
  }
  return {
    createVault: unsupported,
    isValidVault: async () => ({ valid: false, error: WORKSPACE_NOT_READY_ERROR }),
    listKBs: async () => [],
    listTrashKBs: async () => [],
    restoreTrashKB: unsupported,
    clearTrashKBs: unsupported,
    createKB: unsupported,
    deleteKB: unsupported,
    renameKB: unsupported,
    importKB: unsupported,
    listCards: async () => [],
    createCard: unsupported,
    deleteCard: unsupported,
    renameCard: unsupported,
    listTopoDocuments: async () => [],
    createTopoDocument: unsupported,
    readTopoDocument: unsupported,
    writeTopoDocument: unsupported,
    renameTopoDocument: unsupported,
    deleteTopoDocument: unsupported,
    listTrashTopoDocuments: async () => [],
    restoreTrashTopoDocument: unsupported,
    clearTrashTopoDocuments: unsupported,
    moveTopoDocument: unsupported,
    repairTopoDocuments: async () => ({
      repaired: false,
      corrupted: false,
      added: 0,
      removed: 0,
      documents: [],
    }),
    exportTopoDocument: unsupported,
    openTopoDocumentFolder: async () => false,
    listAttachments: async () => [],
    importAttachment: unsupported,
    deleteAttachment: unsupported,
    listTrashAttachments: async () => [],
    restoreTrashAttachment: unsupported,
    clearTrashAttachments: unsupported,
    openAttachment: async () => false,
    showAttachmentInFolder: async () => false,
    getAttachmentAbsoluteUrl: async () => null,
    writeAttachmentBase64: unsupported,
    downloadAttachment: unsupported,
    readAttachmentDataUrl: unsupported,
    readLayout: async () => ({
      nodes: {},
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    }),
    writeLayout: unsupported,
    readConfig: async () => ({}),
    writeConfig: unsupported,
  }
}

export interface StorageProviderProps {
  children: React.ReactNode
  backend?: StorageBackend
}

export function StorageProvider({ children, backend }: StorageProviderProps) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const resolvedBackend = useMemo(() => {
    if (backend) {
      return backend
    }
    if (currentWorkspaceId) {
      return createRemoteStorageBackend(currentWorkspaceId)
    }
    return createWorkspacePendingBackend()
  }, [backend, currentWorkspaceId])

  const store = useMemo(() => createStore(resolvedBackend), [resolvedBackend])
  return <StorageContext.Provider value={store}>{children}</StorageContext.Provider>
}

export function useStorage() {
  const store = useContext(StorageContext)
  if (!store) throw new Error('useStorage must be used within StorageProvider')
  return store
}
