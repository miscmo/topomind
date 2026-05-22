/**
 * 日志性能监控页面
 * 通过菜单"视图 → 日志性能监控"打开的独立窗口
 */
import { useEffect, useCallback, useState } from 'react'
import { useMonitorStore, type LogEntry } from '../../stores/monitorStore'
import PerformanceTab from './PerformanceTab'
import {
  logGetBuffer,
  logQuery,
  logGetAvailableDates,
  logClear,
  logSubscribe,
  logUnsubscribe,
  logAction,
} from '../../core/log-backend'

// ============================================================
// 常量
// ============================================================
const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const
const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '#888',
  INFO: '#3498db',
  WARN: '#f39c12',
  ERROR: '#e74c3c',
}
const LEVEL_ORDER: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }

// ============================================================
// 工具函数
// ============================================================
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${yyyy}-${mm}-${dd} ${h}:${m}:${s}.${ms}`
  } catch {
    return iso
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function highlightText(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[#fef08a] text-[#854d0e] rounded-[2px] px-[1px]">{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </>
  )
}

function toDateStr(iso: string): string {
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  } catch {
    return ''
  }
}

// ============================================================
// 子组件
// ============================================================

/** 侧边栏 */
function Sidebar() {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const setActiveTab = useMonitorStore((s) => s.setActiveTab)
  const stats = useMonitorStore((s) => s.stats)

  const handleTabClick = (tab: 'log' | 'performance') => {
    logAction('监控页:切换Tab', 'MonitorPage', { tab, previousTab: activeTab })
    setActiveTab(tab)
  }

  return (
    <aside className="w-[220px] min-w-[220px] bg-[var(--color-surface)] border-r border-[var(--color-border-subtle)] flex flex-col text-[var(--color-text-secondary)]">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 text-[14px] font-semibold text-[var(--color-text-primary)] border-b border-[var(--color-border-subtle)] tracking-[0.3px]">
        <span className="text-[10px] text-[#3498db]">&#9673;</span>
        <span>TopoMind</span>
      </div>
      <nav className="flex flex-col py-2 gap-0.5">
        <button
          className={`flex items-center gap-2 py-2 px-4 bg-transparent border-none text-[var(--color-text-secondary)] text-[13px] cursor-pointer text-left transition-all duration-150 rounded-md h-auto w-[calc(100%-16px)] mx-2 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] ${activeTab === 'log' ? '!bg-[var(--color-selected-bg)] !text-[var(--color-primary)] font-semibold' : ''}`}
          onClick={() => handleTabClick('log')}
        >
          <span className="text-[14px] w-5 text-center shrink-0">&#9776;</span>
          <span>日志监控</span>
          {stats.error > 0 && (
            <span className="ml-auto bg-[#e74c3c] text-white text-[10px] font-semibold py-[1px] px-[5px] rounded-lg min-w-[18px] text-center" style={{ background: '#e74c3c' }}>
              {stats.error}
            </span>
          )}
        </button>
        <button
          className={`flex items-center gap-2 py-2 px-4 bg-transparent border-none text-[var(--color-text-secondary)] text-[13px] cursor-pointer text-left transition-all duration-150 rounded-md h-auto w-[calc(100%-16px)] mx-2 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)] ${activeTab === 'performance' ? '!bg-[var(--color-selected-bg)] !text-[var(--color-primary)] font-semibold' : ''}`}
          onClick={() => handleTabClick('performance')}
        >
          <span className="text-[14px] w-5 text-center shrink-0">&#9651;</span>
          <span>性能监控</span>
          <span className="ml-auto w-[18px]" />
        </button>
      </nav>
      <div className="mt-auto py-3 px-4 border-t border-white/10 bg-black/15">
        <div className="text-[10px] uppercase tracking-[0.8px] text-[#6b7280] mb-2 font-medium">统计</div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#888' }} />
          <span className="text-[#9aa5b1] flex-1">DEBUG</span>
          <span className="text-[#c8d0d8] font-mono text-[11px]">{stats.debug}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#3498db' }} />
          <span className="text-[#9aa5b1] flex-1">INFO</span>
          <span className="text-[#c8d0d8] font-mono text-[11px]">{stats.info}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#f39c12' }} />
          <span className="text-[#9aa5b1] flex-1">WARN</span>
          <span className="text-[#c8d0d8] font-mono text-[11px]">{stats.warn}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#e74c3c' }} />
          <span className="text-[#9aa5b1] flex-1">ERROR</span>
          <span className="text-[#c8d0d8] font-mono text-[11px]">{stats.error}</span>
        </div>
        <div className="mt-2 pt-1.5 border-t border-white/5 text-[11px] text-[#6b7280] text-center">共 {stats.total} 条</div>
      </div>
    </aside>
  )
}

/** 顶部过滤器栏 */
function FilterBar() {
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
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-[#e0e4ea] gap-3 shrink-0 flex-wrap">
      <div className="flex items-center gap-2.5 flex-wrap flex-1">
        {/* 关键词搜索 */}
        <div className="relative flex items-center">
          <span className="absolute left-2 text-[#999] text-[11px] pointer-events-none">&#9906;</span>
          <input
            className="h-7 pl-[26px] pr-[28px] border border-[#e0e4ea] rounded-md text-[12px] outline-none w-[220px] bg-[#f8f9fb] transition-all duration-150 focus:border-[#3498db] focus:bg-white focus:shadow-[0_0_0_2px_rgba(52,152,219,0.1)]"
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
            <button className="absolute right-1.5 bg-transparent border-none text-[#aaa] cursor-pointer text-[10px] p-0.5 flex items-center justify-center hover:text-[#e74c3c]" onClick={() => {
              logAction('监控:清除关键词', 'MonitorPage', { previousKeyword: keyword })
              setKeyword('')
            }}>
              &#10005;
            </button>
          )}
        </div>

        {/* 日期选择 */}
        <select
          className="h-7 px-2 border border-[#e0e4ea] rounded-md text-[12px] outline-none bg-[#f8f9fb] cursor-pointer text-[#2d3436] focus:border-[#3498db]"
          value={selectedDate}
          onChange={(e) => {
            logAction('监控:日期选择', 'MonitorPage', { previousDate: selectedDate || '全部', newDate: e.target.value || '全部' })
            setSelectedDate(e.target.value)
          }}
        >
          <option value="">全部日期</option>
          {availableDates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {/* 等级过滤 */}
        <div className="flex gap-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              className={`h-6 px-2 rounded font-semibold cursor-pointer border border-[#e0e4ea] bg-[#f8f9fb] text-[#888] transition-all duration-120 tracking-[0.3px] text-[10px] hover:bg-[#eee] ${
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
        <label className="flex items-center gap-1 cursor-pointer text-[12px] text-[#555] select-none [&>input]:accent-[#3498db]">
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

        <button className="w-7 h-7 flex items-center justify-center border border-[#e0e4ea] rounded-md bg-[#f8f9fb] text-[#555] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[#eee] hover:border-[#ccc]" onClick={handleRefresh} title="刷新">
          &#8635;
        </button>
        <button className={`w-7 h-7 flex items-center justify-center border border-[#e0e4ea] rounded-md bg-[#f8f9fb] text-[#555] cursor-pointer text-[13px] transition-all duration-120 hover:bg-[#eee] hover:border-[#ccc] hover:!bg-[#fee2e2] hover:!border-[#e74c3c] hover:!text-[#e74c3c]`} onClick={handleClear} title="清空">
          &#10005;
        </button>
      </div>
    </div>
  )
}

/** 日志条目行 */
interface LogRowProps {
  entry: { id?: string; timestamp: string; level: string; module?: string; action?: string; message: string; params?: unknown }
  selected: boolean
  onClick: () => void
  keyword: string
}

function LogRow({ entry, selected, onClick, keyword }: LogRowProps) {
  const level = entry.level || 'INFO'
  const levelColor = LEVEL_COLORS[level] || '#888'

  return (
    <div
      className={`flex items-center px-3 py-1 border-b border-[#f0f2f5] cursor-pointer transition-colors duration-80 min-w-0 gap-0 hover:bg-[#f8f9fb] ${selected ? '!bg-[#e8f4fd] border-l-2 border-l-[#3498db] !pl-[10px]' : ''} ${
        level === 'ERROR' ? 'bg-[#fef5f5] hover:!bg-[#fee2e2]' : level === 'WARN' ? 'bg-[#fffbf0] hover:!bg-[#fef3e2]' : ''
      }`}
      onClick={onClick}
    >
      <span className="w-[90px] min-w-[90px] shrink-0 font-mono text-[11px] text-[#6b7280]">{formatTimestamp(entry.timestamp)}</span>
      <span className="w-[52px] min-w-[52px] shrink-0 text-[10px] font-bold tracking-[0.3px]" style={{ color: levelColor }}>
        {level.padEnd(5)}
      </span>
      <span className="w-[100px] min-w-[80px] shrink-0 text-[11px] font-medium text-[#1a3a5c] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.module || 'Unknown', keyword)}</span>
      <span className="w-[140px] min-w-[100px] shrink-0 text-[11px] text-[#8b5cf6] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.action || '—', keyword)}</span>
      <span className="flex-1 min-w-0 text-[12px] text-[#374151] overflow-hidden text-ellipsis whitespace-nowrap">{highlightText(entry.message || '', keyword)}</span>
    </div>
  )
}

/** 日志列表 */
function LogList() {
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
      <div className="flex items-center px-3 py-1.5 bg-[#f8f9fb] border-b border-[#e0e4ea] text-[11px] font-semibold text-[#6b7280] tracking-[0.3px] shrink-0 select-none">
        <span className="w-[90px] min-w-[90px] shrink-0">时间</span>
        <span className="w-[52px] min-w-[52px] shrink-0 text-[10px] font-bold tracking-[0.3px]">等级</span>
        <span className="w-[100px] min-w-[80px] shrink-0">模块</span>
        <span className="w-[140px] min-w-[100px] shrink-0">动作</span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">消息</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#f0f2f5] [&::-webkit-scrollbar-thumb]:bg-[#d0d4da] [&::-webkit-scrollbar-thumb]:rounded-[3px] hover:[&::-webkit-scrollbar-thumb]:bg-[#aaa]">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-[60px] px-5 text-[#aaa] text-[14px] text-center">
            {entries.length === 0 ? (
              <>
                <span className="text-[40px] mb-3 block opacity-40">&#128269;</span>
                <p>暂无日志</p>
                <p className="text-[12px] text-[#bbb] mt-1">在主应用中操作，知识将实时显示在这里</p>
              </>
            ) : (
              <>
                <span className="text-[40px] mb-3 block opacity-40">&#8987;</span>
                <p>没有匹配的日志</p>
                <p className="text-[12px] text-[#bbb] mt-1">尝试调整筛选条件</p>
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

/** 日志详情面板 */
function DetailPanel() {
  const selectedEntry = useMonitorStore((s) => s.selectedEntry)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const [copied, setCopied] = useState(false)

  if (!selectedEntry) {
    return (
      <div className="border-t border-[#e0e4ea] bg-white max-h-[280px] overflow-y-auto shrink-0 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-[#f0f2f5] [&::-webkit-scrollbar-thumb]:bg-[#d0d4da] [&::-webkit-scrollbar-thumb]:rounded-[3px]">
        <div className="p-6 text-[#aaa] text-[12px] text-center">选中一条日志查看详情</div>
      </div>
    )
  }

  const handleCopy = () => {
    logAction('监控:复制日志', 'MonitorPage', { entryId: selectedEntry.id, entryLevel: selectedEntry.level })
    navigator.clipboard.writeText(JSON.stringify(selectedEntry, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="border-t border-[#e0e4ea] bg-white max-h-[280px] overflow-y-auto shrink-0 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-[#f0f2f5] [&::-webkit-scrollbar-thumb]:bg-[#d0d4da] [&::-webkit-scrollbar-thumb]:rounded-[3px]">
      <div className="flex items-center px-4 py-2 bg-[#f8f9fb] border-b border-[#e0e4ea] gap-2 sticky top-0">
        <span
          className="text-[11px] font-bold tracking-[0.5px]"
          style={{ color: LEVEL_COLORS[selectedEntry.level || 'INFO'] }}
        >
          {selectedEntry.level || 'INFO'}
        </span>
        <span className="flex-1 text-[12px] font-semibold text-[#2d3436] overflow-hidden text-ellipsis whitespace-nowrap">
          {selectedEntry.action || selectedEntry.module || '日志条目'}
        </span>
        <div className="flex gap-1 shrink-0">
          <button className="h-6 px-2 border border-[#e0e4ea] rounded bg-white text-[11px] cursor-pointer text-[#555] transition-all duration-120 hover:bg-[#f0f2f5]" onClick={handleCopy}>
            {copied ? '已复制!' : '复制'}
          </button>
          <button className="h-6 px-2 border border-[#e0e4ea] rounded bg-white text-[11px] cursor-pointer text-[#555] transition-all duration-120 hover:bg-[#f0f2f5]" onClick={() => {
            logAction('监控:关闭详情', 'MonitorPage', { closedEntryId: selectedEntry.id })
            setSelectedEntry(null)
          }}>
            &#10005;
          </button>
        </div>
      </div>
      <div className="p-3 px-4 flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">时间</span>
          <span className="text-[12px] text-[#374151] break-all">{formatDate(selectedEntry.timestamp || '')}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">ID</span>
          <span className="text-[12px] text-[#374151] break-all" style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {selectedEntry.id || '—'}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">模块</span>
          <span className="text-[12px] text-[#374151] break-all">{selectedEntry.module || '—'}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">动作</span>
          <span className="text-[12px] text-[#374151] break-all">{selectedEntry.action || '—'}</span>
        </div>
        {selectedEntry.func && (
          <div className="flex items-start gap-3">
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">函数</span>
            <span className="text-[12px] text-[#374151] break-all" style={{ fontFamily: 'monospace' }}>
              {selectedEntry.file}:{selectedEntry.line} {selectedEntry.func}
            </span>
          </div>
        )}
        <div className="flex items-start gap-3">
          <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">消息</span>
          <span className="text-[12px] text-[#374151] break-all">{selectedEntry.message || '—'}</span>
        </div>
        {selectedEntry.params && (
          <div className="flex items-start gap-3" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">参数</span>
            <pre className="mt-1 p-2 bg-[#f8f9fb] rounded-md font-mono text-[11px] text-[#374151] leading-[1.6] overflow-x-auto whitespace-pre w-full border border-[#e8ecf0]">
              {typeof selectedEntry.params === 'string'
                ? selectedEntry.params
                : JSON.stringify(selectedEntry.params, null, 2)}
            </pre>
          </div>
        )}
        {(selectedEntry.traceId || selectedEntry.spanId || selectedEntry.parentId) && (
          <div className="flex items-start gap-3">
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">链路</span>
            <span className="text-[12px] text-[#374151] break-all" style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {selectedEntry.traceId && `trace=${selectedEntry.traceId}`}
              {selectedEntry.spanId && ` span=${selectedEntry.spanId}`}
              {selectedEntry.parentId && ` parent=${selectedEntry.parentId}`}
            </span>
          </div>
        )}
        {selectedEntry.meta && (
          <div className="flex items-start gap-3" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="w-[50px] min-w-[50px] text-[11px] font-semibold text-[#888] uppercase tracking-[0.5px] pt-[1px] shrink-0">元数据</span>
            <pre className="mt-1 p-2 bg-[#f8f9fb] rounded-md font-mono text-[11px] text-[#374151] leading-[1.6] overflow-x-auto whitespace-pre w-full border border-[#e8ecf0]">
              {JSON.stringify(selectedEntry.meta, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 主组件
// ============================================================
export default function MonitorPage() {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const streaming = useMonitorStore((s) => s.streaming)
  const appendEntries = useMonitorStore((s) => s.appendEntries)
  const setEntries = useMonitorStore((s) => s.setEntries)
  const setAvailableDates = useMonitorStore((s) => s.setAvailableDates)
  const setLoaded = useMonitorStore((s) => s.setLoaded)

  // 初始化：加载缓冲区 + 可用日期
  useEffect(() => {
    logAction('页面:进入监控', 'MonitorPage', { timestamp: new Date().toISOString() })
    let mounted = true

    const init = async () => {
      const [buffer, dates] = await Promise.all([logGetBuffer(), logGetAvailableDates()])
      if (!mounted) return
      setEntries(buffer as LogEntry[])
      setAvailableDates(dates)
      setLoaded(true)
    }

    init()

    return () => {
      mounted = false
    }
  }, [setAvailableDates, setEntries, setLoaded])

  // 实时订阅：仅在 streaming=true 时接收新日志
  useEffect(() => {
    if (!streaming) return

    const handleEntry = (entry: unknown) => {
      appendEntries([entry as Parameters<typeof appendEntries>[0][0]])
    }

    logSubscribe(handleEntry)
    return () => {
      logUnsubscribe(handleEntry)
    }
  }, [appendEntries, streaming])

  return (
    <div className="flex w-full h-full bg-[var(--color-bg-app)] font-sans text-[13px] text-[var(--color-text-primary)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {activeTab === 'log' ? (
          <>
            <FilterBar />
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <LogList />
              <DetailPanel />
            </div>
          </>
        ) : (
          <PerformanceTab />
        )}
      </div>
    </div>
  )
}
