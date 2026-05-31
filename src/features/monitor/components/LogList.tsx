import React from 'react'

import { useMonitorStore } from '../model/monitorStore'
import { LEVEL_ORDER } from '../constants'
import { toDateStr } from '../utils/formatters'
import { LogRow } from './LogRow'

export function LogList() {
  const entries = useMonitorStore((s) => s.entries)
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedDate = useMonitorStore((s) => s.selectedDate)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedEntry = useMonitorStore((s) => s.selectedEntry)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)

  // 过滤
  const filtered = entries.filter((e) => {
    if (selectedDate && toDateStr(e.timestamp || '') !== selectedDate) return false
    if (selectedLevels.length > 0 && !selectedLevels.includes(e.level || 'INFO')) return false
    if (keyword) {
      const k = keyword.toLowerCase()
      const searchable = [
        e.message,
        e.action,
        e.module,
        e.func,
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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-bg-app)]">
      <div className="flex items-center px-3 py-1.5 bg-[var(--color-bg-muted)] border-b border-[var(--color-border-subtle)] text-[11px] font-semibold text-[var(--color-text-secondary)] tracking-[0.3px] shrink-0 select-none sticky top-0 z-10">
        <span className="w-[90px] min-w-[90px] shrink-0">时间</span>
        <span className="w-[52px] min-w-[52px] shrink-0 text-[10px] font-bold tracking-[0.3px]">等级</span>
        <span className="w-[100px] min-w-[80px] shrink-0">模块</span>
        <span className="w-[140px] min-w-[100px] shrink-0">动作</span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">消息</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-border-strong)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-text-muted)] [&::-webkit-scrollbar-thumb]:rounded-full relative">
        {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-[60px] px-5 text-[var(--color-text-muted)] text-[14px] text-center">
            {entries.length === 0 ? (
              <>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-30">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <span>暂无日志数据</span>
              </>
            ) : (
              <>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-30">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <span>没有匹配的日志记录</span>
                <button 
                    className="mt-3 px-3 py-1.5 bg-transparent border border-[var(--color-border-strong)] rounded-[6px] text-[12px] text-[var(--color-text-secondary)] cursor-pointer transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
                    onClick={() => {
                      useMonitorStore.setState({ keyword: '', selectedLevels: [], selectedDate: null });
                    }}
                  >
                  清除过滤器
                </button>
              </>
            )}
          </div>
        ) : (
          sorted.map((entry) => (
            <LogRow
              key={entry.id}
              entry={entry}
              selected={selectedEntry?.id === entry.id}
              onClick={() => {
                setSelectedEntry(entry)
              }}
              keyword={keyword}
            />
          ))
        )}
      </div>
    </div>
  )
}
