import type { StorageRef, VaultRef, KBRef } from './ref'

export interface KBInfo {
  ref: KBRef
  vaultRef: VaultRef
  name: string
  coverRef?: string | null
  childCount?: number
}

export interface IKBSStorage {
  listKBS: (vaultRef: VaultRef) => Promise<KBInfo[]>
  createKB: (vaultRef: VaultRef, name: string, meta?: object | null) => Promise<KBRef>
  deleteKB: (kbRef: KBRef) => Promise<unknown>
  renameKB: (kbRef: KBRef, newName: string) => Promise<KBRef>
  setKBCover: (kbRef: KBRef, coverRef: StorageRef | null) => Promise<unknown>
  importKB: (targetVaultRef: VaultRef, sourceKBRef: KBRef) => Promise<KBRef>
}
