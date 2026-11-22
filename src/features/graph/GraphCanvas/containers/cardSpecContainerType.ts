/**
 * 把 CardSpec 知识卡片载荷注册进领域层容器注册表。
 *
 * 这是「新增一种容器」唯一的领域侧改动：外层关系树、图谱映射、生命周期搬运
 * 都不认识 cardspec，只按 container.type 查表。
 */
import { registerContainerType } from '../../../../domain/container/containerTypes'
import {
  CARDSPEC_CONTAINER_TYPE,
  CARDSPEC_DOCUMENT_SCHEMA,
  CARDSPEC_DOCUMENT_VERSION,
  cardSpecContentVersion,
  createEmptyCardSpecContent,
  normalizeCardSpecContent,
  serializeCardSpecContent,
  type CardSpecContent,
} from '../../../documents/CardSpecDocument/cardSpecTypes'

export const CARDSPEC_CONTAINER_SPEC = {
  id: CARDSPEC_CONTAINER_TYPE,
  documentType: 'cardspec',
  schema: CARDSPEC_DOCUMENT_SCHEMA,
  version: CARDSPEC_DOCUMENT_VERSION,
  createEmpty: (title: string) => createEmptyCardSpecContent(title),
  normalize: (raw: unknown, title: string) => normalizeCardSpecContent(raw, title),
  serialize: (value: CardSpecContent) => serializeCardSpecContent(value),
  getSceneVersion: (value: CardSpecContent) => cardSpecContentVersion(value),
} as const

registerContainerType(CARDSPEC_CONTAINER_SPEC)
