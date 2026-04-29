/**
 * useStorage — React hook entry for the storage service.
 *
 * Keep this layer intentionally thin: React code depends on the stable Store API,
 * while Store owns business-level validation, normalization, caching and debounce logic.
 */
import { Store } from '../core/storage'

export function useStorage() {
  return Store
}
