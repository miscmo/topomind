export type { StorageRef, VaultRef, KBRef, CardRef } from './adapter/ref'
export type { StorageDialogResult, VaultInfo, IVaultStorage } from './adapter/vault'
export type { KBInfo, IKBSStorage } from './adapter/kb'
export type { CardInfo, ICardStorage } from './adapter/card'
export type { StorageGraphMeta, IGraphStorage } from './adapter/graph'
export type { IDocumentStorage } from './adapter/document'
export type { IAssetStorage } from './adapter/asset'
export type { IConfigStorage } from './adapter/config'
export type { ILogStorage } from './adapter/log'

export type StorageAdapter =
  & import('./adapter/vault').IVaultStorage
  & import('./adapter/kb').IKBSStorage
  & import('./adapter/card').ICardStorage
  & import('./adapter/document').IDocumentStorage
  & import('./adapter/graph').IGraphStorage
  & import('./adapter/asset').IAssetStorage
  & import('./adapter/config').IConfigStorage
  & import('./adapter/log').ILogStorage
