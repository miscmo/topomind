import { Search, X, RefreshCw, Download, Package } from 'lucide-react'
import React, { useCallback } from 'react'
import { useMonitorStore, type LogEntry } from '@/plugins/public/monitorStore'
import { listCategoryFilters } from '@/shared/observability/eventCatalog'

import { LEVELS, LEVEL_COLORS } from '../constants'
import { useMonitorHost } from '../hostContext'
import { downloadDiagnosticBundle } from '../utils/bundleExport'

/** v3：类别下拉由事件目录自动生成，新增类别无需改组件。 */
const CATEGORY_FILTERS = listCategoryFilters()

/**
 * 原始日志视图的工具条。v3 P4 把「等级阈值 / 实时流」上移到全局 ControlBar，
 * 这里只保留与单视图相关的查询、过滤与导出，避免两处都能改同一个状态。
 */
export function FilterBar() {
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedDate = useMonitorStore((s) => s.selectedDate)
  const availableDates = useMonitorStore((s) => s.availableDates)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedCategories = useMonitorStore((s) => s.selectedCategories)
  const selectedSessionId = useMonitorStore((s) => s.selectedSessionId)
  const setKeyword = useMonitorStore((s) => s.setKeyword)
  const setSelectedDate = useMonitorStore((s) => s.setSelectedDate)
  const setSelectedLevels = useMonitorStore((s) => s.setSelectedLevels)
  const setSelectedCategories = useMonitorStore((s) => s.setSelectedCategories)
  const setSelectedSessionId = useMonitorStore((s) => s.setSelectedSessionId)
  const setSelectedTraceId = useMonitorStore((s) => s.setSelectedTraceId)
  const setReplayCursor = useMonitorStore((s) => s.setReplayCursor)
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
    if (isActive) setSelectedLevels(selectedLevels.filter((l) => l !== level))
    else setSelectedLevels([...selectedLevels, level])
  }

  const handleRefresh = useCallback(async () => {
    log.info('refresh monitor logs', {
      date: selectedDate || 'all',
      levels: selectedLevels.length > 0 ? selectedLevels : 'all',
      hasSessionFilter: Boolean(selectedSessionId),
    })
    // v3 P4：把统一控制条的 session 选择下推到主进程，避免只做本地过滤却扫全量磁盘。
    const results = (await logs.query({
      date: selectedDate || undefined,
      keyword: keyword || undefined,
      levels: selectedLevels.length > 0 ? selectedLevels : undefined,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      sessionId: selectedSessionId || undefined,
    })) as LogEntry[]
    setEntries(results)
  }, [keyword, log, logs, selectedDate, selectedLevels, selectedCategories, selectedSessionId, setEntries])

  /** 导出当日（或指定日期）原始 JSONL；导出前提示可能包含路径信息（规范 §3.10）。 */
  const handleExport = useCallback(async () => {
    if (!logs.exportJsonl) return
    if (!window.confirm('导出的日志可能包含文件路径、文档路径等信息，分享前请先检查。是否继续导出？')) return
    const date = selectedDate ?? undefined
    log.info('export monitor logs', { date: date ?? 'today' })
    const content = await logs.exportJsonl(date)
    if (!content) return
    const blob = new Blob([content], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `topomind-logs-${date ?? 'latest'}.jsonl`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [log, logs, selectedDate])

  /** P3：一键诊断包；与「异常与崩溃」视图共用唯一导出实现。 */
  const handleExportBundle = useCallback(async () => {
    await downloadDiagnosticBundle(logs, log)
  }, [log, logs])

  const handleClear = useCallback(async () => {
    log.info('reset monitor filters', { bufferSizeBefore: entries.length })
    setKeyword('')
    setSelectedDate(null)
    setSelectedLevels([])
    setSelectedCategories([])
    setSelectedSessionId(null)
    setSelectedTraceId(null)
    setReplayCursor(null)
    setSelectedEntry(null)
    const results = (await logs.getBuffer()) as LogEntry[]
    setEntries(results)
  }, [entries.length, log, logs, setEntries, setKeyword, setSelectedDate, setSelectedCategories, setSelectedEntry, setSelectedLevels, setSelectedSessionId, setSelectedTraceId, setReplayCursor])

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--titlebar-bg)] border-b border-[var(--color-border-subtle)] gap-3 shrink-0 flex-wrap">
      <div className="flex items-center gap-2.5 flex-wrap flex-1">
        {/* 关键词搜索 */}
        <div className="relative flex items-center">
          <Search className="absolute left-2 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" />
          <input
              className="h-7 pl-[26px] pr-[28px] border border-[var(--color-border)] rounded-md text-[12px] outline-none w-[220px] bg-[var(--color-bg-muted)] transition-all duration-75 focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:shadow-[var(--shadow-focus-ring)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              type="text"
              placeholder="搜索关键词..."
            value={keyword}
            onChange={(e) => {
              const newKeyword = e.target.value
              // 用户输入只记长度，不把搜索词原样写进日志（规范 §3.5 / v3 D3）。
              log.info('monitor keyword changed', { keywordLength: newKeyword.length })
              setKeyword(newKeyword)
            }}
          />
          {keyword && (
              <button className="absolute right-[3px] w-5 h-5 flex items-center justify-center border-none bg-transparent cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] rounded-sm hover:bg-[var(--color-hover-bg)]" onClick={() => {
              log.info('monitor keyword cleared', { previousKeywordLength: keyword.length })
              setKeyword('')
            }}>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 日期选择 */}
        <select
          className="h-7 px-2 border border-[var(--color-border)] rounded-md text-[12px] outline-none bg-[var(--color-bg-muted)] cursor-pointer text-[var(--color-text-primary)] focus:border-[var(--color-accent)]"
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

        {/* v3 一级分类筛选：选项由事件目录自动生成，保留期与分类同源 */}
        <label className="flex items-center gap-1" title="按日志类别筛选（用户 / 内部 / 性能 / 异常）">
          类别
          <select
            className="h-7 px-2 border border-[var(--color-border)] rounded-md outline-none bg-[var(--color-bg-muted)] cursor-pointer text-[var(--color-text-primary)] focus:border-[var(--color-accent)]"
            value={selectedCategories[0] || ''}
            onChange={(e) => {
              const next = e.target.value ? [e.target.value] : []
              log.info('monitor category filter changed', { categories: next })
              setSelectedCategories(next)
            }}
          >
            <option value="" className="text-[var(--color-text-primary)] bg-[var(--color-surface)]">全部类别</option>
            {CATEGORY_FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id} className="text-[var(--color-text-primary)] bg-[var(--color-surface)]">
                {filter.label}（{filter.eventCount}）
              </option>
            ))}
          </select>
        </label>

        {/* 等级过滤（仅本地显示，不影响采集阈值；阈值在顶部统一控制条） */}
          <div className="flex gap-1 bg-[var(--color-bg-muted)] rounded-md p-0.5 border border-[var(--color-border-subtle)]">
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
        <button className="w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]" onClick={() => void handleExport()} disabled={!logs.exportJsonl} title="导出当日 JSONL（可能包含文件路径）">
          <Download className="h-3.5 w-3.5" />
        </button>
        <button className="w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]" onClick={() => void handleExportBundle()} disabled={!logs.exportBundle} title="导出诊断包（四类日志 + 错误指纹 + 环境 + dump 引用，已二次脱敏）">
          <Package className="h-3.5 w-3.5" />
        </button>
        <button className="w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]" onClick={handleRefresh} title="刷新（按当前筛选下推主进程查询）">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button className="w-7 h-7 flex items-center justify-center border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] hover:!bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] hover:!border-[var(--color-danger)] hover:!text-[var(--color-danger)]" onClick={handleClear} title="重置过滤">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
