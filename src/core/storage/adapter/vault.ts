export type VaultRef = string

export interface VaultValidationResult {
  valid: boolean
  error?: string
}

export interface IVaultStorage {
  /**
   * Create a new vault
   * @param vaultRef - The root reference of the vault
   */
  createVault: (vaultRef: VaultRef) => Promise<void>

  /**
   * Check if the vault is valid
   * @param vaultRef - The root reference of the vault
   * @returns validation result
   */
  isValidVault: (vaultRef: VaultRef) => Promise<VaultValidationResult>

  /**
   * Remove the vault
   * @param vaultRef - The reference of the vault
   * @returns The result of the removal
   */
  removeVault: (vaultRef: VaultRef) => Promise<void>

  /**
   * Read the app config of the vault
   * @returns The app config
   */
  readAppConfig: () => Promise<unknown>

  /**
   * Write the app config of the vault
   * @param content - The app config content
   * @returns void
   */
  writeAppConfig: (content: unknown) => Promise<void>
}
