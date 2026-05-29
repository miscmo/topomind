import React from 'react'
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
      className="w-full flex items-center justify-between mb-[2px] border-none rounded-lg text-left cursor-default transition-colors duration-75 hover:bg-[#f5f8fb] py-1 px-2 bg-white/22 border border-[var(--color-border-light)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]"
      style={{ paddingLeft: `${level * 16 + 10}px` }}
    >
      <input
        ref={inlineInputRef}
        className="flex-1 w-full min-h-[calc(1.35em+10px)] py-1 px-2.5 border border-transparent !border-[var(--color-border-light)] rounded-lg bg-white/22 !bg-[color-mix(in_srgb,var(--color-surface)_22%,transparent)] text-[#1e293b] !text-[var(--color-text-primary)] font-inherit leading-[1.35] outline-none box-border transition-all duration-75 focus:bg-white/44 focus:!bg-[color-mix(in_srgb,var(--color-surface)_44%,transparent)] focus:border-[#94a3b847] focus:!border-[var(--color-border)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] focus:!shadow-[0_0_0_2px_var(--color-accent-soft)] disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:!text-[var(--color-text-muted)] disabled:cursor-not-allowed placeholder:text-[#94a3b8] placeholder:font-medium placeholder:!text-[var(--color-text-muted)]"
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
