import React, { useCallback } from 'react'
import { useMonitorStore, type LogEntry } from '../model/monitorStore'

import { LEVELS, LEVEL_COLORS } from '../constants'
import { useMonitorHost } from '../hostContext'

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
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const entries = useMonitorStore((s) => s.entries)
  const { logs, log } = useMonitorHost()

  const handleLevelToggle = (level: string) => {
    const isActive = selectedLevels.includes(level)
    log.info(isActive ? 'monitor level filter removed' : 'monitor level filter added', {
      level,
      currentLevels: selectedLevels,
    })
    if (selectedLevels.includes(level)) {
      setSelectedLevels(selectedLevels.filter((l) => l !== level))
    } else {
      setSelectedLevels([...selectedLevels, level])
    }
  }

  const handleRefresh = useCallback(async () => {
    log.info('refresh monitor logs', {
      date: selectedDate || 'all',
      levels: selectedLevels.length > 0 ? selectedLevels : 'all',
    })
    const results = (await logs.query({
      date: selectedDate || undefined,
      keyword: keyword || undefined,
      levels: selectedLevels.length > 0 ? selectedLevels : undefined,
    })) as LogEntry[]
    setEntries(results)
  }, [keyword, log, logs, selectedDate, selectedLevels, setEntries])

  const handleClear = useCallback(async () => {
    log.info('reset monitor filters', { bufferSizeBefore: entries.length })
    setKeyword('')
    setSelectedDate(null)
    setSelectedLevels([])
    setSelectedEntry(null)
    const results = (await logs.getBuffer()) as LogEntry[]
    setEntries(results)
  }, [entries.length, log, logs, setEntries, setKeyword, setSelectedDate, setSelectedEntry, setSelectedLevels])

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
              log.info('monitor keyword changed', { previousKeyword: keyword, newKeyword })
              setKeyword(newKeyword)
            }}
          />
          {keyword && (
              <button className="absolute right-[3px] w-5 h-5 flex items-center justify-center border-none bg-transparent cursor-pointer text-[#aaa] text-[10px] hover:text-[var(--color-text-primary)] rounded-[4px] hover:bg-[var(--color-hover-bg)]" onClick={() => {
              log.info('monitor keyword cleared', { previousKeyword: keyword })
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
            log.info('monitor date selected', {
              previousDate: selectedDate || 'all',
              newDate: e.target.value || 'all',
            })
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
              log.info('monitor streaming toggled', { previousStreaming: streaming, newStreaming })
              setStreaming(newStreaming)
            }}
          />
          <span>实时</span>
        </label>

        <button className="w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]" onClick={handleRefresh} title="刷新">
          &#8635;
        </button>
        <button className={`w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] hover:!bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] hover:!border-[var(--color-danger)] hover:!text-[var(--color-danger)]`} onClick={handleClear} title="重置过滤">
          &#10005;
        </button>
      </div>
    </div>
  )
}
