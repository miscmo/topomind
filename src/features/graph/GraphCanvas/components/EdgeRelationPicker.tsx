import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, CornerDownLeft, GitBranch, Link2, RotateCcw } from 'lucide-react'
import {
  useEdgeRelationEditorStore,
  useEdgeRelationPickerStore,
  type EdgePopupAnchor,
} from '../../../../stores/edgeRelationPickerStore'
import { orderEdgeRelationOptions } from '../../../../domain/graph/graphProfiles'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useGraphStore, useGraphStoreApi } from '../../../../stores/graphStore'
import { useGraphContext } from '../../../../contexts/GraphContext'
import {
  DEFAULT_EDGE_RELATION_ID,
  MAX_EDGE_RELATION_LABEL_LENGTH,
  SUBORDINATE_EDGE_RELATION_ID,
  describeEdgeSemantic,
  normalizeEdgeRelationDefinitions,
  normalizeEdgeRelationLabel,
  readEdgeRelationId,
} from '../../../../domain/graph/edgeRelations'
import type { EdgeRelation } from '../../../../types'

const POPUP_MARGIN = 8

/**
 * 连线关系浮层的公共外壳：portal 到 body、贴着事件坐标、视口内钳位。
 *
 * 【用户决策 2026-11-12】以前是「fixed inset-0 + 居中卡片」的模态：画完一条长线
 * 还要把鼠标从终点挪回屏幕中央。现在改成鼠标菜单形态：**没有遮罩、没有标题栏、
 * 不阻断画布**，Esc / 点击外部即关闭；浮层高度很小，靠近屏幕右下时自动回收。
 */
function CompactRelationPopup({
  anchor,
  onClose,
  attrs,
  ariaLabel,
  focusOnMount = false,
  onKeyDown,
  children,
}: {
  anchor: EdgePopupAnchor
  onClose: () => void
  attrs: Record<string, string>
  ariaLabel: string
  focusOnMount?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y })

  // 布局阶段就钳位，避免第一帧先画在屏幕外再跳回来。
  useLayoutEffect(() => {
    const element = panelRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const left = Math.max(POPUP_MARGIN, Math.min(anchor.x, window.innerWidth - rect.width - POPUP_MARGIN))
    const top = Math.max(POPUP_MARGIN, Math.min(anchor.y, window.innerHeight - rect.height - POPUP_MARGIN))
    setPosition({ left, top })
  }, [anchor.x, anchor.y])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
    }
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    // 捕获阶段：即使画布/其它菜单 stopPropagation 也能收到「点外面」。
    document.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onGlobalKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    if (focusOnMount) panelRef.current?.focus()
  }, [focusOnMount])

  // 层级契约：画布 isolate 0 < 右栏 30 < 右键菜单 50 < 轻量浮层 60 < 弹窗 10000 / 确认框 99999。
  // 改成鼠标菜单后不得再沿用居中模态的 99998，否则会盖住「关联文档」等弹窗。
  return createPortal(
    <div
      {...attrs}
      ref={panelRef}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      className="nodrag nopan fixed z-[60] w-[214px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-popover)] outline-none"
      style={{ left: position.left, top: position.top, pointerEvents: 'all' }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  )
}

function MenuCaption({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-0.5 text-[10px] leading-none text-[var(--color-text-muted)]">
      {children}
    </div>
  )
}

/**
 * 新建连线时的必选关系菜单，锚点 = 连线终点。
 *
 * - 两个选项恒为「关联 / 从属」，与 `edgeRelations.ts` 的两项内置定义同源；
 * - 从属不可用（唯一父 / 环 / 深度超限）时**禁用并说明原因**，而不是等落盘后失败；
 * - 取消 / Esc / 点击外部都只是关闭，不会创建任何边；
 * - 键盘：↑↓ 移动、Enter 选择、1/2 直选（画完线不用碰鼠标也能确认）。
 */
export function EdgeRelationPicker({
  recommendedRelation = null,
}: { recommendedRelation?: EdgeRelation | null }) {
  const pending = useEdgeRelationPickerStore((s) => s.pending)
  const close = useEdgeRelationPickerStore((s) => s.close)
  const configured = useGraphUiStore((s) => s.edgeRelations)
  const [focused, setFocused] = useState(0)

  const definitions = useMemo(
    () => normalizeEdgeRelationDefinitions(configured),
    [configured],
  )
  const nameOf = useCallback((id: EdgeRelation) => (
    definitions.find((item) => item.id === id)?.name ?? id
  ), [definitions])

  useEffect(() => { setFocused(0) }, [pending])

  if (!pending) return null

  const choose = (relation: EdgeRelation) => {
    const current = pending
    close()
    current.onConfirm(relation)
  }

  const baseOptions: Array<{
    id: EdgeRelation
    icon: typeof Link2
    hint: string
    blocked: boolean
  }> = [
    {
      id: DEFAULT_EDGE_RELATION_ID,
      icon: Link2,
      hint: '弱关系 · 连线上必须写明关系名，未写默认显示「关联」',
      blocked: false,
    },
    {
      id: SUBORDINATE_EDGE_RELATION_ID,
      icon: GitBranch,
      hint: pending.subordinateBlockedReason
        ?? '强关系 · 父 → 子，构成层级树（唯一父、无环）',
      blocked: pending.subordinateBlockedReason !== null,
    },
  ]
  // 图型只影响排序与「推荐」标记；两个选项仍然必须显式点选才会落盘。
  const options = orderEdgeRelationOptions(
    baseOptions.map((item) => item.id),
    recommendedRelation,
  ).map((id) => ({
    ...baseOptions.find((item) => item.id === id)!,
    recommended: id === recommendedRelation,
  }))

  const moveFocus = (delta: number) => {
    const next = (focused + delta + options.length) % options.length
    setFocused(next)
  }

  return (
    <CompactRelationPopup
      anchor={pending.anchor}
      onClose={close}
      focusOnMount
      ariaLabel="选择连线关系"
      attrs={{
        'data-tm-edge-relation-picker': '',
        'data-tm-edge-relation-inline': 'true',
        'data-tm-edge-relation-anchor-x': String(Math.round(pending.anchor.x)),
        'data-tm-edge-relation-anchor-y': String(Math.round(pending.anchor.y)),
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          moveFocus(event.key === 'ArrowDown' ? 1 : -1)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const option = options[focused]
          if (option && !option.blocked) choose(option.id)
        } else if (event.key === '1' || event.key === '2') {
          const option = options[Number(event.key) - 1]
          if (option && !option.blocked) choose(option.id)
        }
      }}
    >
      <MenuCaption><span>连线关系</span><span>Esc 取消</span></MenuCaption>
      {options.map((option, index) => {
        const Icon = option.icon
        return (
          <button
            key={option.id}
            type="button"
            tabIndex={-1}
            data-tm-edge-relation-choice={option.id}
            data-tm-edge-relation-mandatory={option.id === DEFAULT_EDGE_RELATION_ID ? 'true' : undefined}
            data-tm-edge-relation-recommended={option.recommended ? 'true' : undefined}
            title={option.hint}
            disabled={option.blocked}
            onMouseEnter={() => setFocused(index)}
            onClick={() => choose(option.id)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
              option.blocked
                ? 'cursor-not-allowed text-[var(--color-text-muted)] opacity-55'
                : focused === index
                  ? 'bg-[var(--color-selected-bg)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]'
            }`}
          >
            <Icon size={14} className="shrink-0 opacity-80" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{nameOf(option.id)}</span>
            {option.recommended && (
              <span className="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 text-[9px] font-medium text-[var(--color-accent)]">
                推荐
              </span>
            )}
            {!option.blocked && focused === index && (
              <CornerDownLeft size={11} className="shrink-0 opacity-60" aria-hidden="true" />
            )}
          </button>
        )
      })}
      {pending.subordinateBlockedReason && (
        <div
          className="mt-1 border-t border-[var(--color-border-light)] px-2 pt-1.5 text-[10px] leading-[1.5] text-[var(--color-text-muted)]"
          data-tm-edge-relation-blocked-reason=""
        >
          {pending.subordinateBlockedReason}
        </div>
      )}
    </CompactRelationPopup>
  )
}

/**
 * 双击已有连线弹出的轻量关系编辑器，锚点 = 双击位置。
 *
 * 【用户决策 2026-11-12】「关联」边支持写本条边自己的关系名（如「前置知识」），
 * 留空 / 恢复默认则回落到全局关系定义名；同时可直接切换关联 / 从属。
 * 写入统一走 useGraph 的只读闸门，缩小镜头时不会假编辑。
 */
export function EdgeRelationQuickEditor() {
  const editing = useEdgeRelationEditorStore((s) => s.editing)
  const close = useEdgeRelationEditorStore((s) => s.close)
  const relations = useGraphUiStore((s) => s.edgeRelations)
  const edge = useGraphStore((s) => (
    editing ? s.edges.find((item) => item.id === editing.edgeId) ?? null : null
  ))
  const graphStoreApi = useGraphStoreApi()
  const { updateEdgeRelationLabel, updateEdgeRelation, onPaneClick } = useGraphContext()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 只在「打开 / 换一条边」时重置草稿；输入过程中 store 变化不覆盖正在打的字。
  useEffect(() => {
    if (!editing) return
    const current = graphStoreApi.getState().edges.find((item) => item.id === editing.edgeId)
    setDraft(current?.data?.relationLabel ?? '')
    setError('')
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editing, graphStoreApi])

  if (!editing) return null

  const definitions = normalizeEdgeRelationDefinitions(relations)
  const semantic = describeEdgeSemantic(edge?.data?.relation, definitions, edge?.data?.relationLabel)
  const currentRelation = readEdgeRelationId(edge?.data?.relation)

  const commit = (value: string) => {
    const normalized = normalizeEdgeRelationLabel(value)
    void updateEdgeRelationLabel(editing.edgeId, normalized ?? null)
    close()
    // 双击自带两次 click 会选中这条边；不取消选中，中点会被快捷工具栏占住，
    // 用户刚写完的关系名反而看不见。这里复用「点画布空白」的清选中语义。
    onPaneClick()
  }

  const switchRelation = (relation: EdgeRelation) => {
    if (relation === currentRelation) {
      close()
      return
    }
    void updateEdgeRelation(editing.edgeId, relation).then((accepted) => {
      if (!accepted) {
        setError('无法切换为「从属」：唯一父、无环、深度 1~100')
        return
      }
      close()
      onPaneClick()
    })
  }

  return (
    <CompactRelationPopup
      anchor={editing.anchor}
      onClose={close}
      ariaLabel="编辑连线关系"
      attrs={{
        'data-tm-edge-relation-editor': '',
        'data-tm-edge-relation-inline': 'true',
        'data-tm-edge-relation-anchor-x': String(Math.round(editing.anchor.x)),
        'data-tm-edge-relation-anchor-y': String(Math.round(editing.anchor.y)),
      }}
    >
      <MenuCaption><span>自定义关系名</span><span>Enter 保存</span></MenuCaption>
      <div className="flex items-center gap-1 px-1 pb-1">
        <input
          ref={inputRef}
          data-tm-edge-relation-label-input=""
          value={draft}
          maxLength={MAX_EDGE_RELATION_LABEL_LENGTH}
          placeholder={semantic.label}
          aria-label="自定义连线关系名"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(draft)
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          data-tm-edge-relation-label-save=""
          title="保存（Enter）"
          onClick={() => commit(draft)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-accent)] hover:bg-[var(--color-hover-bg)]"
        >
          <Check size={14} aria-hidden="true" />
        </button>
      </div>
      {edge?.data?.relationLabel && (
        <button
          type="button"
          data-tm-edge-relation-label-reset=""
          onClick={() => commit('')}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
        >
          <RotateCcw size={12} aria-hidden="true" />
          <span>恢复默认名（{definitions.find((item) => item.id === currentRelation)?.name ?? semantic.label}）</span>
        </button>
      )}
      <div className="my-1 h-px bg-[var(--color-border-light)]" />
      <MenuCaption><span>关系类型</span><span>切换即套用样式</span></MenuCaption>
      {definitions.map((item) => (
        <button
          key={item.id}
          type="button"
          data-tm-edge-relation-editor-choice={item.id}
          aria-pressed={item.id === currentRelation}
          onClick={() => switchRelation(item.id as EdgeRelation)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
            item.id === currentRelation
              ? 'bg-[var(--color-selected-bg)] text-[var(--color-accent)]'
              : 'text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]'
          }`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: item.style.color }}
          />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {item.id === currentRelation && <Check size={12} className="shrink-0" aria-hidden="true" />}
        </button>
      ))}
      {error && (
        <div
          className="mt-1 border-t border-[var(--color-border-light)] px-2 pt-1.5 text-[10px] leading-[1.5] text-[var(--color-danger)]"
          data-tm-edge-relation-editor-error=""
        >
          {error}
        </div>
      )}
    </CompactRelationPopup>
  )
}
