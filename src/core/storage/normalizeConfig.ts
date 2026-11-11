import { normalizeStyleConfig } from '../../domain/style/normalizeStyleConfig.ts'
import { normalizeEdgeRelationDefinitions } from '../../domain/graph/edgeRelations.ts'
import { normalizeRoomProfiles } from '../../domain/graph/graphProfiles.ts'
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
    // 关系定义必须在这里显式重建：normalizeConfig 会丢弃所有未列出的字段，
    // 漏一个就会让自定义关系写进 _config.json 后读回来凭空消失（字段白名单铁律）。
    edgeRelations: normalizeEdgeRelationDefinitions(c.edgeRelations),
    showEdgeRelationLabels: typeof c.showEdgeRelationLabels === 'boolean' ? c.showEdgeRelationLabels : true,
    // 房间图型必须显式重建：normalizeConfig 会丢弃所有未列出的字段（字段白名单铁律）。
    roomProfiles: normalizeRoomProfiles(c.roomProfiles),
    kbCovers,
    kbCoverOffsets,
    kbOrder,
  }
}
