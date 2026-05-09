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
  // Image assets
  writeCardAsset: (assetPath: string, buffer: ArrayBuffer) => Promise<void>
  readCardAsset: (assetPath: string) => Promise<ArrayBuffer | null>

  // App config
  readAppConfig: () => Promise<unknown>
  writeAppConfig: (content: unknown) => Promise<void>
}