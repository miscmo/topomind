/**
 * 容器载荷指针（节点 → 自身 _docs/ 下的一份文档）。
 *
 * 纯领域模块：无 React / 无 IO / 无 IPC，可被 esbuild 打包后真跑。
 * 读写两侧共用同一个归一化边界，避免 normalizeGraphMeta 与 core/storage/file.ts
 * 出现两套不一致的白名单。
 */
import type { ContainerRef } from '../../types'

const MAX_TYPE_LENGTH = 64
const MAX_DOCUMENT_ID_LENGTH = 128

/**
 * 只放行结构完整的指针，其余一律回落 undefined（等价普通知识节点，旧档零迁移）。
 * type 保持 string 而不做枚举校验：新增容器类型只加注册项，不改这里。
 * 未知字段不落盘，避免脏 payload 随 _graph.json 扩散。
 */
export function normalizeContainerRef(value: unknown): ContainerRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.type !== 'string' || typeof raw.documentId !== 'string') return undefined
  const type = raw.type.trim().slice(0, MAX_TYPE_LENGTH)
  const documentId = raw.documentId.trim().slice(0, MAX_DOCUMENT_ID_LENGTH)
  if (!type || !documentId) return undefined
  return { type, documentId }
}
