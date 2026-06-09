import React from 'react'
import type { TrashTopoDocumentItem } from '../../../core/storage'
import { topoDocumentTypeIcon } from '../types/documentTypes'

interface DocumentTrashItemProps {
  item: TrashTopoDocumentItem
  isBusy?: boolean
  onRestore: (trashName: string) => void
}

export const DocumentTrashItem: React.FC<DocumentTrashItemProps> = ({ item, isBusy, onRestore }) => {
  return (
    <div className="group w-full flex items-center gap-2 mb-[2px] py-[7px] px-2.5 border-none rounded-lg bg-transparent text-left transition-colors duration-75 hover:bg-[var(--color-hover-bg)]">
      <span className="w-5 h-5 flex items-center justify-center shrink-0 text-sm">
        {topoDocumentTypeIcon(item.type)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis text-[var(--color-text-primary)]" title={item.title}>
          {item.title}
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap overflow-hidden text-ellipsis">
          {new Date(item.deletedAt).toLocaleString('zh-CN')}
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 h-6 px-2 rounded-md border border-[var(--color-border)] bg-transparent text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => onRestore(item.trashName)}
        disabled={isBusy}
      >
        恢复
      </button>
    </div>
  )
}
