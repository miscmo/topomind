export type VaultRef = string

export interface VaultInfo {
  ref: VaultRef
  createdAt?: string
  updatedAt?: string
}

export interface IVaultStorage {
  /**
   * Create a new vault
   * @param vaultRef - The root reference of the vault
   * @returns The information of the vault
   */
  createVault: (vaultRef: VaultRef) => Promise<VaultInfo>

  /**
   * Check if the vault is valid
   * @param vaultRef - The root reference of the vault
   * @returns boolean of validity
   */
  isValidVault: (vaultRef: VaultRef) => Promise<boolean>

  /**
   * Get the information of the vault
   * @param vaultRef - The reference of the vault
   * @returns The information of the vault
   */
  getVaultInfo: (vaultRef: VaultRef) => Promise<VaultInfo>

  /**
   * Remove the vault
   * @param vaultRef - The reference of the vault
   * @returns The result of the removal
   */
  removeVault: (vaultRef: VaultRef) => Promise<void>
}
