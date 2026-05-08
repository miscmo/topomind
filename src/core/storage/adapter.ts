export type { VaultRef, VaultInfo, IVaultStorage } from './adapter/vault'
export type { KBRef, KBInfo, IKBSStorage } from './adapter/kb'
export type { CardRef, CardInfo, ICardStorage } from './adapter/card'
export type { GraphMeta, IGraphStorage } from './adapter/graph'

export type StorageAdapter =
  & import('./adapter/vault').IVaultStorage
  & import('./adapter/kb').IKBSStorage
  & import('./adapter/card').ICardStorage
  & import('./adapter/graph').IGraphStorage

/**
 * Extended StorageAdapter interface used by service.ts.
 * Includes all methods the business layer needs that go beyond the core
 * engine-agnostic StorageAdapter (Vault/KB/Card/Graph interfaces).
 */
export interface StorageAdapterExtended extends StorageAdapter {
  // Vault operations (workspace)
  setVault: (dirPath: string) => Promise<{ valid: boolean; nodePath: string | null; path?: string; error?: string }>
  selectVaultCandidate: () => Promise<{ valid: boolean; nodePath: string | null; path?: string; error?: string }>
  getVaultRoot: () => Promise<string | null>
  clearVault: () => Promise<void>

  // KB operations not in IKBSStorage
  setKnowledgeBaseOrder: (kbRef: string, order: number) => Promise<void>
  saveKnowledgeBaseCover: (kbRef: string, coverPath: string | null) => Promise<void>

  // Last opened KB
  getLastOpenedKnowledgeBase: () => Promise<string | null>
  setLastOpenedKnowledgeBase: (kbPath: string | null) => Promise<void>

  // Card operations not in ICardStorage
  ensureCard: (cardPath: string) => Promise<void>
  openCardLocation: (cardPath: string) => Promise<void>
  readCardMarkdown: (cardPath: string) => Promise<string>
  writeCardMarkdown: (cardPath: string, content: string) => Promise<void>

  // Image assets
  writeCardAsset: (assetPath: string, buffer: ArrayBuffer) => Promise<void>
  readCardAsset: (assetPath: string) => Promise<ArrayBuffer | null>

  // App config
  readAppConfig: () => Promise<unknown>
  writeAppConfig: (content: unknown) => Promise<void>
}