import type { StorageAdapterExtended } from '../adapter'

export const remoteStorageAdapter: StorageAdapterExtended = {
  // IVaultStorage
  createVault: async () => { throw new Error('remoteStorageAdapter not implemented') },
  isValidVault: async () => false,
  getVaultInfo: async () => { throw new Error('remoteStorageAdapter not implemented') },
  removeVault: async () => { throw new Error('remoteStorageAdapter not implemented') },

  // IKBSStorage
  listKBS: async () => [],
  createKB: async () => { throw new Error('remoteStorageAdapter not implemented') },
  deleteKB: async () => { throw new Error('remoteStorageAdapter not implemented') },
  renameKB: async () => { throw new Error('remoteStorageAdapter not implemented') },
  importKB: async () => { throw new Error('remoteStorageAdapter not implemented') },

  // ICardStorage
  listCards: async () => [],
  createCard: async () => { throw new Error('remoteStorageAdapter not implemented') },
  deleteCard: async () => { throw new Error('remoteStorageAdapter not implemented') },
  renameCard: async () => { throw new Error('remoteStorageAdapter not implemented') },
  countSubCards: async () => 0,

  // IGraphStorage
  readCardLayout: async () => ({ nodes: {}, edges: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } }),
  writeCardLayout: async () => { throw new Error('remoteStorageAdapter not implemented') },

  // StorageAdapterExtended
  readCardMarkdown: async () => '',
  writeCardMarkdown: async () => { throw new Error('remoteStorageAdapter not implemented') },
  writeCardAsset: async () => { throw new Error('remoteStorageAdapter not implemented') },
  readCardAsset: async () => null as ArrayBuffer | null,
  readAppConfig: async () => ({}),
  writeAppConfig: async () => { throw new Error('remoteStorageAdapter not implemented') },
}