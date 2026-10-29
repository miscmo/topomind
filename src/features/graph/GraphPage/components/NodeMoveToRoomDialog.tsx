import { memo, useEffect, useMemo, useState } from 'react'
import { X, ArrowUp, ArrowUpFromLine, CornerDownRight } from 'lucide-react'
import { useStorage } from '../../../../core/storage'
import { joinRefs, normalizeRef } from '../../../../domain/graph/path-utils'

interface NodeMoveToRoomDialogProps {
  /** 要移动的节点 basename 列表（均为源房间的直接子节点） */
  nodeIds: string[]
  /** 源房间路径（相对 kbs） */
  sourceRoomPath: string
  /** KB 根房间路径（相对 kbs），用于面包屑导航起点 */
  kbPath: string
  onConfirm: (targetRoomPath: string) => void
  onClose: () => void
}

function parentRoom(roomPath: string, kbPath: string): string | null {
  if (roomPath === kbPath) return null
  const idx = roomPath.lastIndexOf('/')
  return idx <= 0 ? kbPath : roomPath.slice(0, idx)
}

/**
 * 跨房间移动节点的目标房间选择器。
 * - 「上一层房间」：移动到源房间的父房间；在 KB 根时禁用。
 * - 面包屑 + 子房间列表：下钻到任意子房间（下一层 / 指定房间）。
 * - 防环：目标等于任一被移动节点路径、或为其后代子房间时禁用。
 * - 预览：保留两端都在被移动集合内的内部连线，丢弃跨越边界（与源房间）的连线。
 */
export const NodeMoveToRoomDialog = memo(function NodeMoveToRoomDialog({
  nodeIds,
  sourceRoomPath,
  kbPath,
  onConfirm,
  onClose,
}: NodeMoveToRoomDialogProps) {
  const storage = useStorage()
  const [navPath, setNavPath] = useState(kbPath)
  const [sourceInfo, setSourceInfo] = useState<{ names: Record<string, string>; kept: number; dropped: number } | null>(null)
  const [rooms, setRooms] = useState<Array<{ basename: string; name: string; path: string; childCount: number; disabled: boolean; reason?: string }>>([])

  // 源房间：节点名 + 连线边界预览
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const meta = await storage.readLayout(sourceRoomPath)
        const names: Record<string, string> = {}
        Object.values(meta.nodes ?? {}).forEach((n) => { names[n.id] = n.card?.name || n.id })
        const keptSet = new Set(nodeIds.map(normalizeRef))
        let kept = 0
        let dropped = 0
        ;(meta.edges ?? []).forEach((e) => {
          const s = normalizeRef(e.source.ref)
          const t = normalizeRef(e.target.ref)
          if (keptSet.has(s) && keptSet.has(t)) kept += 1
          else if (keptSet.has(s) || keptSet.has(t)) dropped += 1
        })
        if (!cancelled) setSourceInfo({ names, kept, dropped })
      } catch {
        /* 忽略读取错误，预览留空 */
      }
    })()
    return () => { cancelled = true }
  }, [storage, sourceRoomPath, nodeIds])

  // 导航房间列表 + 防环
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const meta = await storage.readLayout(navPath)
        const children = Object.values(meta.nodes ?? {}).map((n) => ({
          basename: n.id,
          name: n.card?.name || n.id,
        }))
        const paths = children.map((c) => joinRefs(navPath, c.basename))
        const summaries = await storage.readRoomNodeSummaries(paths)
        const movedPaths = nodeIds.map((id) => joinRefs(sourceRoomPath, id))
        const list = children.map((c, i) => {
          const path = paths[i]
          let disabled = false
          let reason = ''
          if (path === sourceRoomPath) {
            disabled = true
            reason = '源房间'
          } else {
            for (const mp of movedPaths) {
              if (path === mp || path.indexOf(mp + '/') === 0) {
                disabled = true
                reason = '会成环'
                break
              }
            }
          }
          return {
            basename: c.basename,
            name: c.name,
            path,
            childCount: summaries[path]?.childCount ?? 0,
            disabled,
            reason,
          }
        })
        if (!cancelled) setRooms(list)
      } catch {
        if (!cancelled) setRooms([])
      }
    })()
    return () => { cancelled = true }
  }, [storage, navPath, sourceRoomPath, nodeIds])

  const upPath = parentRoom(sourceRoomPath, kbPath)
  const navUpPath = parentRoom(navPath, kbPath)
  const breadcrumb = navPath.split('/')
  const movedPaths = useMemo(() => nodeIds.map((id) => joinRefs(sourceRoomPath, id)), [nodeIds, sourceRoomPath])
  const navDisabled = navPath === sourceRoomPath || movedPaths.some((mp) => navPath === mp || navPath.indexOf(mp + '/') === 0)

  const titlePreview = useMemo(() => {
    if (!sourceInfo) return ''
    const labels = nodeIds.map((id) => sourceInfo.names[id] || id)
    const head = labels.slice(0, 3).join('、')
    return labels.length > 3 ? `${head} 等 ${labels.length} 个` : head
  }, [sourceInfo, nodeIds])

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        className="w-[400px] max-w-[92vw] max-h-[82vh] flex flex-col bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">移动节点到房间</div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 text-[12px] leading-snug text-[var(--color-text-muted)]">
          移动：<span className="text-[var(--color-text-primary)]">{titlePreview || '选中的节点'}</span>
        </div>

        {/* 快捷：上一层房间 */}
        <div className="px-3 pb-2">
          <button
            type="button"
            disabled={!upPath}
            onClick={() => upPath && onConfirm(upPath)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-[13px] bg-[var(--color-bg-muted)] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUpFromLine className="w-4 h-4 text-[var(--color-text-muted)]" />
            移动到上一层房间{upPath ? `（${upPath.split('/').pop()}）` : '（已在顶层）'}
          </button>
        </div>

        {/* 面包屑 */}
        <div className="flex items-center gap-1 px-4 py-2 border-y border-[var(--color-border-subtle)] text-[12px]">
          {breadcrumb.map((seg, i) => {
            const prefix = breadcrumb.slice(0, i + 1).join('/')
            return (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[var(--color-text-muted)]">/</span>}
                <button type="button" onClick={() => setNavPath(prefix)} className="px-1 py-0.5 rounded hover:bg-[var(--color-bg-muted)] text-[var(--color-accent)]">
                  {seg}
                </button>
              </span>
            )
          })}
          {navUpPath && (
            <button type="button" onClick={() => setNavPath(navUpPath)} className="ml-auto flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
              <ArrowUp className="w-3.5 h-3.5" /> 上翻
            </button>
          )}
        </div>

        {/* 子房间列表 */}
        <div className="flex-1 overflow-y-auto py-1 min-h-[120px]">
          {rooms.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--color-text-muted)]">该房间没有子房间</div>
          ) : (
            rooms.map((r) => (
              <div key={r.path} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-bg-muted)]">
                <CornerDownRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                <button
                  type="button"
                  onClick={() => !r.disabled && setNavPath(r.path)}
                  disabled={r.disabled}
                  className="truncate flex-1 text-left text-[13px] text-[var(--color-text-primary)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                >
                  {r.name}
                  {r.childCount > 0 && <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">{r.childCount} 子</span>}
                </button>
                {r.disabled ? (
                  <span className="text-[11px] text-[var(--color-text-muted)]">{r.reason}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConfirm(r.path)}
                    className="text-[12px] px-2 py-1 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
                  >
                    移动到此
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* 底部：连线预览 + 确认当前房间 */}
        <div className="px-4 py-3 border-t border-[var(--color-border-subtle)]">
          {sourceInfo && (
            <div className="text-[12px] text-[var(--color-text-muted)] mb-2">
              保留 {sourceInfo.kept} 条内部连线，丢弃 {sourceInfo.dropped} 条边界连线（与源房间的连线不保留）。
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">
              取消
            </button>
            <button
              type="button"
              disabled={navDisabled}
              onClick={() => onConfirm(navPath)}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              移动到「{navPath.split('/').pop()}」
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
