import { normalizeStyleConfig } from '../../domain/style/normalizeStyleConfig'
import type { VaultConfig } from './types'

export function normalizeConfig(configRaw: unknown): VaultConfig {
  const c = (configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw)) ? configRaw as Record<string, unknown> : {}
  const styleConfig = normalizeStyleConfig(c)
  
  const covers = (c.kbCovers && typeof c.kbCovers === 'object' && !Array.isArray(c.kbCovers)) ? c.kbCovers as Record<string, unknown> : {}
  const kbCovers: Record<string, string> = {}
  for (const [k, v] of Object.entries(covers)) {
    if (typeof v === 'string') kbCovers[k] = v
  }

  const offsets = (c.kbCoverOffsets && typeof c.kbCoverOffsets === 'object' && !Array.isArray(c.kbCoverOffsets)) ? c.kbCoverOffsets as Record<string, unknown> : {}
  const kbCoverOffsets: Record<string, number> = {}
  for (const [k, v] of Object.entries(offsets)) {
    if (typeof v === 'number') kbCoverOffsets[k] = v
  }

  const kbOrder = Array.isArray(c.kbOrder) ? c.kbOrder.filter(item => typeof item === 'string') : undefined

  return {
    ...styleConfig,
    kbCovers,
    kbCoverOffsets,
    kbOrder,
  }
}
