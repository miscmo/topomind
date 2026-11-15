import React from 'react'
import { PANEL_LIST } from '../../../shared/ui/panelList'
import type { DocumentInlineEditState } from '../model/useDocumentSidebarModel'

interface DocumentInlineEditProps {
  level: number
  inlineEdit: DocumentInlineEditState
  inlineInputRef: React.RefObject<HTMLInputElement | null>
  isBusy?: boolean
  onChange: (value: string) => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export const DocumentInlineEdit: React.FC<DocumentInlineEditProps> = ({
  level,
  inlineEdit,
  inlineInputRef,
  isBusy,
  onChange,
  onBlur,
  onKeyDown,
}) => {
  return (
    <div
      className={`${PANEL_LIST.row} mb-[2px] border border-[var(--color-border-light)] bg-[var(--color-surface)]`}
      style={{ paddingLeft: `${level * 16 + 4}px` }}
    >
      <input
        ref={inlineInputRef}
        className="min-w-0 w-full flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-[12px] !text-[var(--color-text-primary)] font-inherit leading-[1.35] outline-none box-border transition-colors duration-75 focus:border-[var(--color-accent)] focus:shadow-[var(--shadow-focus-ring)] disabled:bg-[var(--color-bg-muted)] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed placeholder:!text-[var(--color-text-muted)]"
        value={inlineEdit.value}
        placeholder="输入文档名称"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={isBusy}
      />
    </div>
  )
}
