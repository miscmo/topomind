import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link2, GitBranch, X } from 'lucide-react'
import { useEdgeRelationPickerStore } from '../../../../stores/edgeRelationPickerStore'
import { orderEdgeRelationOptions } from '../../../../domain/graph/graphProfiles'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import {
  DEFAULT_EDGE_RELATION_ID,
  SUBORDINATE_EDGE_RELATION_ID,
  normalizeEdgeRelationDefinitions,
} from '../../../../domain/graph/edgeRelations'
import type { EdgeRelation } from '../../../../types'

/**
 * 新建连线时强制选择关系类型的浮层（portal 到 document.body）。
 *
 * - 两个选项恒为「关联 / 从属」，与 `edgeRelations.ts` 的两项内置定义同源；
 * - 从属不可用（唯一父 / 环 / 深度超限）时**禁用并说明原因**，而不是等落盘后失败；
 * - 取消 / Esc / 点击外部都只是关闭，不会创建任何边。
 */
export function EdgeRelationPicker({
  recommendedRelation = null,
}: { recommendedRelation?: EdgeRelation | null }) {
  const pending = useEdgeRelationPickerStore((s) => s.pending)
  const close = useEdgeRelationPickerStore((s) => s.close)
  const configured = useGraphUiStore((s) => s.edgeRelations)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const definitions = useMemo(
    () => normalizeEdgeRelationDefinitions(configured),
    [configured],
  )
  const nameOf = useCallback((id: EdgeRelation) => (
    definitions.find((item) => item.id === id)?.name ?? id
  ), [definitions])

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) close()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [pending, close])

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

  return createPortal(
    <div
      className="fixed inset-0 z-[99998] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-text-primary)_28%,transparent)]"
      data-tm-edge-relation-picker=""
      role="dialog"
      aria-modal="true"
      aria-label="选择连线关系"
    >
      <div
        ref={panelRef}
        className="w-[360px] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-popover)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">选择连线关系</div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              新建连线必须指定关系，未选择不会创建
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="取消新建连线"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {options.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                data-tm-edge-relation-choice={option.id}
                data-tm-edge-relation-mandatory={option.id === DEFAULT_EDGE_RELATION_ID ? 'true' : undefined}
                data-tm-edge-relation-recommended={option.recommended ? 'true' : undefined}
                disabled={option.blocked}
                onClick={() => choose(option.id)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  option.blocked
                    ? 'cursor-not-allowed border-[var(--color-border-light)] opacity-55'
                    : 'border-[var(--color-border-strong)] hover:border-[var(--color-accent)] hover:bg-[var(--color-hover-bg)]'
                }`}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-hover-bg)] text-[var(--color-accent)]">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{nameOf(option.id)}</span>
                    {option.recommended && (
                      <span className="rounded bg-[var(--color-accent-soft)] px-1 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                        推荐
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[1.5] text-[var(--color-text-muted)]">{option.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
