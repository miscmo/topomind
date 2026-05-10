import type { VaultRef } from './vault'

export type KBRef = string

export interface KBInfo {
  ref: KBRef
  name: string
}

export interface IKBSStorage {
  /**
   * List the knowledge bases in the vault
   * @param vaultRef - The reference of the vault
   * @returns The list of knowledge bases
   */
  listKBS: (vaultRef: VaultRef) => Promise<KBInfo[]>

  /**
   * Create a new knowledge base
   * @param vaultRef - The reference of the vault
   * @param name - The name of the knowledge base
   * @param meta - The metadata of the knowledge base
   * @returns The reference of the knowledge base
   */
  createKB: (vaultRef: VaultRef, name: string) => Promise<KBInfo>

  
  /**
   * Delete a knowledge base
   * @param kbRef - The reference of the knowledge base
   * @returns void
   */
  deleteKB: (kbInfo: KBInfo) => Promise<void>

  /**
   * Rename a knowledge base
   * @param kbRef - The reference of the knowledge base
   * @param newName - The new name of the knowledge base
   * @returns The reference of the knowledge base
   */
  renameKB: (kbInfo: KBInfo, newName: string) => Promise<void>

  /**
   * Import a knowledge base
   * @param targetVaultRef - The reference of the target vault
   * @param sourceKBInfo - The information of the source knowledge base
   * @returns The information of the imported knowledge base
   */
  importKB: (targetVaultRef: VaultRef, sourceKBInfo: KBInfo) => Promise<KBInfo>
}
