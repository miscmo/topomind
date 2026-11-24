import { FileText, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'

import { toDateStr } from '@/shared/observability/logFormatting'
import { LOG_LIMITS } from '@/shared/observability/logContract'

import { useMonitorStore } from '@/plugins/public/monitorStore'
import { LEVEL_ORDER } from '../constants'
import { LogRow } from './LogRow'
import { EmptyState } from '@/shared/ui/EmptyState'

/** 渐进分页：一次只渲染一页，避免 2000 条缓冲全量挂载 DOM（规范 §3.10）。 */
const PAGE_SIZE = LOG_LIMITS.defaultQueryLimit

export function LogList() {
  const entries = useMonitorStore((s) => s.entries)
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedDate = useMonitorStore((s) => s.selectedDate)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedCategories = useMonitorStore((s) => s.selectedCategories)
  const selectedEntry = useMonitorStore((s) => s.selectedEntry)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE)

  // 筛选条件变化时回到第一页；实时流追加条目不重置，避免打断正在浏览的用户。
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [keyword, selectedDate, selectedLevels, selectedCategories])

  // 过滤
  const filtered = entries.filter((e) => {
    if (selectedDate && toDateStr(e.timestamp || '') !== selectedDate) return false
    if (selectedLevels.length > 0 && !selectedLevels.includes(e.level || 'INFO')) return false
    if (selectedCategories.length > 0 && !selectedCategories.includes(e.category || 'internal')) return false
    if (keyword) {
      const k = keyword.toLowerCase()
      const searchable = [
        e.message,
        e.action,
        e.module,
        e.error,
        typeof e.params === 'string' ? e.params : JSON.stringify(e.params),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!searchable.includes(k)) return false
    }
    return true
  })

  // 按等级排序（ERROR > WARN > INFO > DEBUG）
  const sorted = [...filtered].sort((a, b) => {
    const aO = LEVEL_ORDER[a.level || 'INFO'] ?? 2
    const bO = LEVEL_ORDER[b.level || 'INFO'] ?? 2
    return aO - bO
  })

  const visible = sorted.slice(0, visibleCount)

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-bg-app)]">
      <div className="flex items-center px-3 py-1.5 bg-[var(--color-bg-muted)] border-b border-[var(--color-border-subtle)] text-[11px] font-semibold text-[var(--color-text-secondary)] tracking-[0.3px] shrink-0 select-none sticky top-0 z-10">
        <span className="w-[90px] min-w-[90px] shrink-0">时间</span>
        <span className="w-[52px] min-w-[52px] shrink-0 text-[10px] font-bold tracking-[0.3px]">等级</span>
        <span className="w-[64px] min-w-[64px] shrink-0">类别</span>
        <span className="w-[100px] min-w-[80px] shrink-0">模块</span>
        <span className="w-[140px] min-w-[100px] shrink-0">动作</span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">消息</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-border-strong)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-text-muted)] [&::-webkit-scrollbar-thumb]:rounded-full relative">
        {sorted.length === 0 ? (
          entries.length === 0 ? (
            <EmptyState
              size="md"
              icon={<FileText className="h-6 w-6" />}
              title="暂无日志数据"
            />
          ) : (
            <EmptyState
              size="md"
              icon={<SearchX className="h-6 w-6" />}
              title="没有匹配的日志记录"
              action={
                <button
                  className="px-3 py-1.5 rounded-md border border-[var(--color-border-strong)] text-[12px] text-[var(--color-text-secondary)] cursor-pointer transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
                  onClick={() => {
                    useMonitorStore.setState({ keyword: '', selectedLevels: [], selectedCategories: [], selectedDate: null });
                  }}
                >
                  清除过滤器
                </button>
              }
            />
          )
        ) : (
          <>
            {visible.map((entry, index) => (
              <LogRow
                key={entry.id ?? `${entry.timestamp ?? ''}-${index}`}
                entry={entry}
                selected={selectedEntry?.id === entry.id}
                onClick={() => {
                  setSelectedEntry(entry)
                }}
                keyword={keyword}
              />
            ))}
            <div className="flex items-center justify-center gap-2 py-2 text-[var(--color-text-muted)]" style={{ fontSize: 'var(--font-size-sm)' }}>
              <span>已显示 {visible.length} / {sorted.length} 条</span>
              {visible.length < sorted.length && (
                <button
                  className="px-2 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-surface)] cursor-pointer hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >
                  加载更多
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
