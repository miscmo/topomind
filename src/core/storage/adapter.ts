export type { VaultRef, VaultInfo, IVaultStorage } from './adapter/vault'
export type { KBRef, KBInfo, IKBSStorage } from './adapter/kb'
export type { CardRef, CardInfo, ICardStorage } from './adapter/card'
export type { GraphMeta, IGraphStorage } from './adapter/graph'

export type StorageAdapter =
  & import('./adapter/vault').IVaultStorage
  & import('./adapter/kb').IKBSStorage
  & import('./adapter/card').ICardStorage
  & import('./adapter/graph').IGraphStorage
