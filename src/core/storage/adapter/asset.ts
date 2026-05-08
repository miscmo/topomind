import type { StorageRef } from './ref'

export interface IAssetStorage {
  writeCardAsset: (assetRef: StorageRef, buffer: ArrayBuffer) => Promise<unknown>
  readCardAsset: (assetRef: StorageRef) => Promise<ArrayBuffer | null>
}
