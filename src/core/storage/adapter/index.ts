export type { VaultRef, VaultInfo, IVaultStorage } from './vault'
export type { KBRef, KBInfo, IKBSStorage } from './kb'
export type { CardRef, CardInfo, ICardStorage } from './card'
export type { GraphMeta, IGraphStorage } from './graph'

export type StorageAdapter =
  & import('./vault').IVaultStorage
  & import('./kb').IKBSStorage
  & import('./card').ICardStorage
  & import('./graph').IGraphStorage
