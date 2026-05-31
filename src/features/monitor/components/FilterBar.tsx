import React, { useCallback } from 'react'
import { useMonitorStore, type LogEntry } from '../model/monitorStore'

import { logQuery, logClear, logAction } from '../../../core/log-backend'
import { LEVELS, LEVEL_COLORS } from '../constants'

export function FilterBar() {
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedDate = useMonitorStore((s) => s.selectedDate)
  const availableDates = useMonitorStore((s) => s.availableDates)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const streaming = useMonitorStore((s) => s.streaming)
  const setKeyword = useMonitorStore((s) => s.setKeyword)
  const setSelectedDate = useMonitorStore((s) => s.setSelectedDate)
  const setSelectedLevels = useMonitorStore((s) => s.setSelectedLevels)
  const setStreaming = useMonitorStore((s) => s.setStreaming)
  const setEntries = useMonitorStore((s) => s.setEntries)
  const entries = useMonitorStore((s) => s.entries)

  const handleLevelToggle = (level: string) => {
    const isActive = selectedLevels.includes(level)
    logAction(isActive ? '监控:过滤级别移除' : '监控:过滤级别添加', 'MonitorPage', { level, currentLevels: selectedLevels })
    if (selectedLevels.includes(level)) {
      setSelectedLevels(selectedLevels.filter((l) => l !== level))
    } else {
      setSelectedLevels([...selectedLevels, level])
    }
  }

  const handleRefresh = useCallback(async () => {
    logAction('监控:刷新', 'MonitorPage', { dateStr: selectedDate || '全部', levels: selectedLevels.length > 0 ? selectedLevels : '全部' })
    const dateStr = selectedDate || undefined
    const results = (await logQuery({
      dateStr,
      keyword: keyword || undefined,
      levels: selectedLevels.length > 0 ? selectedLevels : undefined,
    })) as LogEntry[]
    setEntries(results)
  }, [keyword, selectedDate, selectedLevels, setEntries])

  const handleClear = useCallback(async () => {
    logAction('监控:清空', 'MonitorPage', { bufferSizeBefore: entries.length })
    await logClear()
    setEntries([])
  }, [setEntries, entries])

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--titlebar-bg)] border-b border-[var(--color-border-subtle)] gap-3 shrink-0 flex-wrap">
      <div className="flex items-center gap-2.5 flex-wrap flex-1">
        {/* 关键词搜索 */}
        <div className="relative flex items-center">
          <span className="absolute left-2 text-[#999] text-[11px] pointer-events-none">&#9906;</span>
          <input
              className="h-7 pl-[26px] pr-[28px] border border-[var(--color-border)] rounded-md text-[12px] outline-none w-[220px] bg-[var(--color-bg-muted)] transition-all duration-75 focus:border-[var(--color-primary)] focus:bg-[var(--color-surface)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              type="text"
              placeholder="搜索关键词..."
            value={keyword}
            onChange={(e) => {
              const newKeyword = e.target.value
              logAction('监控:关键词变化', 'MonitorPage', { previousKeyword: keyword, newKeyword })
              setKeyword(newKeyword)
            }}
          />
          {keyword && (
              <button className="absolute right-[3px] w-5 h-5 flex items-center justify-center border-none bg-transparent cursor-pointer text-[#aaa] text-[10px] hover:text-[var(--color-text-primary)] rounded-[4px] hover:bg-[var(--color-hover-bg)]" onClick={() => {
              logAction('监控:清除关键词', 'MonitorPage', { previousKeyword: keyword })
              setKeyword('')
            }}>
              &#10005;
            </button>
          )}
        </div>

        {/* 日期选择 */}
        <select
          className="h-7 px-2 border border-[var(--color-border)] rounded-md text-[12px] outline-none bg-[var(--color-bg-muted)] cursor-pointer text-[var(--color-text-primary)] focus:border-[var(--color-primary)]"
          value={selectedDate || ''}
          onChange={(e) => {
            logAction('监控:日期选择', 'MonitorPage', { previousDate: selectedDate || '全部', newDate: e.target.value || '全部' })
            setSelectedDate(e.target.value || null)
          }}
        >
          <option value="" className="text-[var(--color-text-primary)] bg-[var(--color-surface)]">全部日期</option>
          {availableDates.map((d) => (
            <option key={d} value={d} className="text-[var(--color-text-primary)] bg-[var(--color-surface)]">
              {d}
            </option>
          ))}
        </select>

        {/* 等级过滤 */}
          <div className="flex gap-1 bg-[var(--color-bg-muted)] rounded-[6px] p-0.5 border border-[var(--color-border-subtle)]">
            {LEVELS.map((l) => (
              <button
                key={l}
                className={`h-6 px-2 rounded font-semibold cursor-pointer border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-all duration-120 tracking-[0.3px] text-[10px] hover:bg-[var(--color-hover-bg)] ${
                  selectedLevels.length === 0 || selectedLevels.includes(l)
                    ? 'bg-[color-mix(in_srgb,var(--level-color)_12%,transparent)] border-[var(--level-color)] text-[var(--level-color)]'
                    : ''
                }`}
              style={
                {
                  '--level-color': LEVEL_COLORS[l],
                } as React.CSSProperties
              }
              onClick={() => handleLevelToggle(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* 实时流开关 */}
        <label className="flex items-center gap-1 cursor-pointer text-[12px] text-[var(--color-text-muted)] select-none [&>input]:accent-[var(--color-primary)]">
          <input
            type="checkbox"
            checked={streaming}
            onChange={(e) => {
              const newStreaming = e.target.checked
              logAction('监控:实时流开关', 'MonitorPage', { previousStreaming: streaming, newStreaming })
              setStreaming(newStreaming)
            }}
          />
          <span>实时</span>
        </label>

        <button className="w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]" onClick={handleRefresh} title="刷新">
          &#8635;
        </button>
        <button className={`w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] hover:!bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] hover:!border-[var(--color-danger)] hover:!text-[var(--color-danger)]`} onClick={handleClear} title="清空">
          &#10005;
        </button>
      </div>
    </div>
  )
}
