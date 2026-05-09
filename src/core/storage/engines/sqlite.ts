import type { StorageAdapter } from '../adapter'

export const sqliteStorageAdapter: StorageAdapter = {
  // IVaultStorage
  createVault: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  isValidVault: async () => false,
  getVaultInfo: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  removeVault: async () => { throw new Error('sqliteStorageAdapter not implemented') },

  // IKBSStorage
  listKBS: async () => [],
  createKB: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  deleteKB: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  renameKB: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  importKB: async () => { throw new Error('sqliteStorageAdapter not implemented') },

  // ICardStorage
  listCards: async () => [],
  createCard: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  deleteCard: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  renameCard: async () => { throw new Error('sqliteStorageAdapter not implemented') },
  countSubCards: async () => 0,

  // IGraphStorage
  readCardLayout: async () => ({ nodes: {}, edges: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } }),
  writeCardLayout: async () => { throw new Error('sqliteStorageAdapter not implemented') },

  // ICardStorage: Markdown operations
  readCardMarkdown: async () => '',
  writeCardMarkdown: async () => { throw new Error('sqliteStorageAdapter not implemented') },

  // IVaultStorage: App config
  readAppConfig: async () => ({}),
  writeAppConfig: async () => { throw new Error('sqliteStorageAdapter not implemented') },
}