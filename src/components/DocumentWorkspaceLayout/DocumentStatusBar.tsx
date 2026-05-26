import { memo } from 'react'
import type { DocumentSaveStatus } from './workspaceTypes'

interface DocumentStatusBarProps {
  stats: {
    characters: number
    words: number
    blocks: number
  } | null
  lastSavedAt?: number | null
  saveStatus?: DocumentSaveStatus
  saveError?: string | null
}

export const DocumentStatusBar = memo(function DocumentStatusBar({
  stats,
  lastSavedAt,
  saveStatus = 'idle',
  saveError
}: DocumentStatusBarProps) {
  const statusView = saveStatus === 'saving'
    ? { dot: 'bg-[var(--color-primary)] animate-pulse', text: '保存中...', textClass: 'text-[var(--color-primary)]' }
    : saveStatus === 'error'
      ? { dot: 'bg-[var(--color-danger)]', text: `保存失败${saveError ? `：${saveError}` : ''}`, textClass: 'text-[var(--color-danger)]' }
      : saveStatus === 'dirty'
        ? { dot: 'bg-[var(--color-warning)]', text: '未保存', textClass: 'text-[var(--color-warning)]' }
        : lastSavedAt
          ? { dot: 'bg-[var(--color-success)] opacity-70', text: `已保存于 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`, textClass: '' }
          : { dot: 'bg-[var(--color-border-strong)]', text: '就绪', textClass: '' }

  return (
    <div className="flex items-center justify-between h-8 px-4 border-t border-[var(--color-border-light)] bg-gradient-to-r from-[var(--color-surface)] to-[color-mix(in_srgb,var(--color-surface)_90%,transparent)] text-[12px] text-[var(--color-text-muted)] select-none shrink-0 z-10 relative shadow-[0_-1px_2px_rgba(15,23,42,0.02)]">
      {/* 左侧区域：保存状态 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 transition-all duration-200">
          <div className={`w-1.5 h-1.5 rounded-full ${statusView.dot}`} />
          <span className={`max-w-[280px] truncate ${statusView.textClass}`} title={statusView.text}>{statusView.text}</span>
        </div>
      </div>

      {/* 右侧区域：文档统计 */}
      <div className="flex items-center gap-4">
        {stats && (
          <div className="flex items-center gap-4 opacity-90 transition-opacity hover:opacity-100">
            <div className="flex items-center gap-1.5" title="文档块数量">
              <span className="font-medium text-[var(--color-text-secondary)]">{stats.blocks}</span>
              <span className="scale-90">块</span>
            </div>
            <div className="w-px h-3 bg-[var(--color-border)] opacity-60" />
            <div className="flex items-center gap-1.5" title="单词数 (中文按字，英文按词)">
              <span className="font-medium text-[var(--color-text-secondary)]">{stats.words}</span>
              <span className="scale-90">词</span>
            </div>
            <div className="w-px h-3 bg-[var(--color-border)] opacity-60" />
            <div className="flex items-center gap-1.5" title="字符数 (不含空格)">
              <span className="font-medium text-[var(--color-text-secondary)]">{stats.characters}</span>
              <span className="scale-90">字符</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
