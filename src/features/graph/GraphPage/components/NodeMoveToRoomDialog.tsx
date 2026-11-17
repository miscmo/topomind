import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { X, ArrowUp, ArrowUpFromLine, CornerDownRight, FolderTree, Search, SearchX } from 'lucide-react'
import { useStorage } from '../../../../core/storage'
import type { FSBRoomNodeTarget } from '../../../../core/fs-backend'
import { joinRefs, normalizeRef } from '../../../../domain/graph/path-utils'
import {
  modalOverlayBaseClassName,
  modalOverlayEnterClassName,
  modalPanelEnterClassName,
} from '../../../../shared/ui/modal'
import { EmptyState } from '../../../../shared/ui/EmptyState'

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

interface TargetRow extends FSBRoomNodeTarget {
  disabled: boolean
  reason: string
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
 * - 搜索节点：打开时拉一次全库节点清单，本地按名称 / 面包屑过滤，直接定位目标房间，
 *   支持上下键 + 回车，无需逐层下钻。
 * - 防环：目标等于源房间、任一被移动节点路径或其后代子房间时禁用。
 * - 预览：保留两端都在被移动集合内的内部连线（相对布局不变），丢弃跨边界连线。
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
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<FSBRoomNodeTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [targetsError, setTargetsError] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 键盘可达性：打开时把焦点移入搜索框（仍在 overlay 内，Esc 能冒泡到 overlay），
  // 关闭时把焦点还给触发元素 —— 与 ConfirmModal 的行为保持一致。
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchInputRef.current?.focus()
    return () => { previous?.focus() }
  }, [])

  // 全库目标节点：对话框生命周期内只拉一次，后续输入纯本地过滤，无 IPC、无重复扫描。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await storage.listRoomNodeTargets()
        if (!cancelled) setTargets(Array.isArray(list) ? list : [])
      } catch {
        if (!cancelled) setTargetsError(true)
      } finally {
        if (!cancelled) setTargetsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [storage])

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

  const searching = query.trim().length > 0
  const searchResults = useMemo<TargetRow[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const rows: TargetRow[] = []
    for (const t of targets) {
      if (!t || typeof t.path !== 'string' || !t.path) continue
      const hay = `${t.name || ''} ${t.breadcrumb || ''} ${t.path}`.toLowerCase()
      if (!hay.includes(q)) continue
      let reason = ''
      if (t.path === sourceRoomPath) reason = '源房间'
      else if (movedPaths.some((mp) => t.path === mp || t.path.startsWith(mp + '/'))) reason = '会成环'
      rows.push({ ...t, disabled: Boolean(reason), reason })
      if (rows.length >= 200) break
    }
    // 可用目标排在前面，回车 / 底部按钮默认命中第一个可用结果。
    rows.sort((a, b) => Number(a.disabled) - Number(b.disabled))
    return rows.slice(0, 60)
  }, [query, targets, sourceRoomPath, movedPaths])

  useEffect(() => { setSelectedIndex(0) }, [query])

  const activeResult = useMemo(() => {
    const picked = searchResults[selectedIndex]
    if (picked && !picked.disabled) return picked
    return searchResults.find((r) => !r.disabled) ?? null
  }, [searchResults, selectedIndex])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeResult) onConfirm(activeResult.path)
    }
  }

  return (
    // 层级必须高于标题栏 chrome（z-[3000]~z-[3002]），否则半透明遮罩盖不住标题栏、
    // 标题栏按钮在模态打开时仍可点击。与其他模态保持一致：KB 四件套 10000。
    <div
      className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`}
      onMouseDown={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <div
        className={`w-[440px] max-w-[92vw] max-h-[82vh] flex flex-col bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl overflow-hidden ${modalPanelEnterClassName}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-move-to-room-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <div id="node-move-to-room-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">移动节点到房间</div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 text-[12px] leading-snug text-[var(--color-text-muted)]">
          移动：<span className="text-[var(--color-text-primary)]">{titlePreview || '选中的节点'}</span>
          {nodeIds.length > 1 && <span className="ml-1">（共 {nodeIds.length} 个）</span>}
        </div>

        {/* 搜索节点：全库节点清单本地过滤，直接定位目标房间 */}
        <div className="flex items-center gap-2 mx-3 mb-2 px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-muted)]">
          <Search className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜索节点，直接定位目标房间…"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="p-0.5 rounded hover:bg-[var(--color-hover-bg)] text-[var(--color-text-muted)]" aria-label="清空搜索">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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

        {/* 列表：搜索模式显示全库匹配结果，否则显示当前房间的子房间 */}
        <div className="flex-1 overflow-y-auto py-1 min-h-[120px]">
          {searching ? (
            targetsLoading ? (
              <EmptyState size="sm" className="min-h-[120px] justify-center" icon={<Search className="h-4 w-4" />} title="正在加载全库节点…" />
            ) : targetsError ? (
              <EmptyState size="sm" className="min-h-[120px] justify-center" icon={<SearchX className="h-4 w-4" />} title="节点列表加载失败，可用面包屑逐层下钻" />
            ) : searchResults.length === 0 ? (
              <EmptyState size="sm" className="min-h-[120px] justify-center" icon={<SearchX className="h-4 w-4" />} title="没有匹配的节点" />
            ) : (
              searchResults.map((r, i) => (
                <div
                  key={r.path}
                  className={`flex items-center gap-2 px-3 py-1.5 ${i === selectedIndex ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-bg-muted)]'}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  {r.isRoot
                    ? <FolderTree className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                    : <CornerDownRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />}
                  <button
                    type="button"
                    disabled={r.disabled}
                    onClick={() => { setQuery(''); setNavPath(r.path) }}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                    title={r.path}
                  >
                    <span className="block truncate text-[13px] text-[var(--color-text-primary)]">{r.name}</span>
                    {r.breadcrumb && <span className="block truncate text-[11px] text-[var(--color-text-muted)]">{r.breadcrumb}</span>}
                  </button>
                  {r.disabled ? (
                    <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">{r.reason}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onConfirm(r.path)}
                      className="shrink-0 text-[12px] px-2 py-1 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)]"
                    >
                      移动到此
                    </button>
                  )}
                </div>
              ))
            )
          ) : rooms.length === 0 ? (
            <EmptyState size="sm" className="min-h-[120px] justify-center" icon={<FolderTree className="h-4 w-4" />} title="该房间没有子房间" />
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
                    className="text-[12px] px-2 py-1 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)]"
                  >
                    移动到此
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* 底部：连线预览 + 确认 */}
        <div className="px-4 py-3 border-t border-[var(--color-border-subtle)]">
          {sourceInfo && (
            <div className="text-[12px] text-[var(--color-text-muted)] mb-2">
              保留 {sourceInfo.kept} 条内部连线（相对布局不变），丢弃 {sourceInfo.dropped} 条边界连线；节点放入目标房间空白区域。
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">
              取消
            </button>
            <button
              type="button"
              disabled={searching ? !activeResult : navDisabled}
              onClick={() => {
                if (searching) { if (activeResult) onConfirm(activeResult.path) }
                else onConfirm(navPath)
              }}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-[var(--color-text-inverse)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {searching ? `移动到「${activeResult?.name ?? '搜索结果'}」` : `移动到「${navPath.split('/').pop()}」`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
