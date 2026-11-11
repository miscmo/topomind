import { memo } from 'react'
import { Check, FileText } from 'lucide-react'
import type { FSBDocumentCandidate } from '../../../core/fs-backend'

interface DocumentCandidateRowProps {
  candidate: FSBDocumentCandidate
  /** 两套选择器各自的诊断属性名（保留旧契约，便于回归与自动化）。 */
  idAttribute: string
  pathAttribute: string
  pathLabelAttribute: string
  selected?: boolean
  active?: boolean
  showCheckbox?: boolean
  isSelf?: boolean
  onPick: () => void
  onMouseEnter?: () => void
}

/**
 * 搜索结果行：树形浏览之外的「跨层直达」通道。
 * 与树里的文档行共用同一份候选 DTO 和同一套消歧信息（面包屑 + 节点内文档路径）。
 */
export const DocumentCandidateRow = memo(function DocumentCandidateRow({
  candidate,
  idAttribute,
  pathAttribute,
  pathLabelAttribute,
  selected = false,
  active = false,
  showCheckbox = false,
  isSelf = false,
  onPick,
  onMouseEnter,
}: DocumentCandidateRowProps) {
  return (
    <button
      type="button"
      data-tm-unified-search-item=""
      {...{
        [idAttribute]: candidate.docId,
        [pathAttribute]: candidate.documentPathLabel,
      }}
      className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
        selected ? 'bg-[var(--color-accent-soft)]'
          : active ? 'bg-[var(--color-hover-bg)]' : 'hover:bg-[var(--color-hover-bg)]'
      }`}
      onMouseEnter={onMouseEnter}
      onClick={onPick}
    >
      {showCheckbox ? (
        <span className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          selected
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-text-inverse)]'
            : 'border-[var(--color-border)]'
        }`}>
          {selected ? <Check className="h-3 w-3" /> : null}
        </span>
      ) : (
        <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-[var(--color-text-primary)]">{candidate.title}</span>
        <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
          {isSelf ? '本节点 · ' : ''}{candidate.breadcrumb}
        </span>
        {candidate.documentPathLabel ? (
          <span
            className="block truncate text-[11px] text-[var(--color-text-secondary)]"
            title={`节点内文档路径：${candidate.documentPathLabel}`}
            {...{ [pathLabelAttribute]: '' }}
          >
            ↳ {candidate.documentPathLabel}
          </span>
        ) : null}
      </span>
    </button>
  )
})
