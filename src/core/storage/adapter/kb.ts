import type { VaultRef } from './vault'
import type { KBListItem } from '../../../types'

export type KBRef = string

export interface IKBSStorage {
  /**
   * List the knowledge bases in the vault
   * @param vaultRef - The reference of the vault
   * @returns The list of knowledge bases
   */
  listKBS: (vaultRef: VaultRef) => Promise<KBListItem[]>

  /**
   * Create a new knowledge base
   * @param vaultRef - The reference of the vault
   * @param name - The name of the knowledge base
   * @param meta - The metadata of the knowledge base
   * @returns The reference of the knowledge base
   */
  createKB: (vaultRef: VaultRef, name: string) => Promise<KBRef>

  
  /**
   * Delete a knowledge base
   * @param kbRef - The reference of the knowledge base
   * @returns void
   */
  deleteKB: (kbRef: KBRef) => Promise<void>

  /**
   * Rename a knowledge base
   * @param kbRef - The reference of the knowledge base
   * @param newName - The new name of the knowledge base
   * @returns The reference of the knowledge base
   */
  renameKB: (kbRef: KBRef, newName: string) => Promise<void>

  /**
   * Import a knowledge base
   * @param targetVaultRef - The reference of the target vault
   * @param sourceKBRef - The reference of the source knowledge base
   * @returns The reference of the imported knowledge base
   */
  importKB: (targetVaultRef: VaultRef, sourceKBRef: KBRef) => Promise<KBRef>
}
