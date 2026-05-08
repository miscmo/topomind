import type { StorageRef, VaultRef } from './ref'

export interface StorageDialogResult {
  valid: boolean
  nodePath?: string | null
  path?: string
  error?: string
}

export interface VaultInfo {
  ref: VaultRef
  createdAt?: string
  updatedAt?: string
}

export interface IVaultStorage {
  createVault: (rootRef: StorageRef) => Promise<StorageDialogResult>
  isVaildVault: (rootRef: StorageRef) => Promise<boolean>
  getVaultInfo: (vaultRef: VaultRef) => Promise<VaultInfo>
  removeVault: (vaultRef: VaultRef) => Promise<unknown>
}
