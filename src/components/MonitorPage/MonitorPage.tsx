/**
 * 日志性能监控页面
 * 通过菜单"视图 → 日志性能监控"打开的独立窗口
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { useMonitorStore, type LogEntry } from '../../stores/monitorStore'
import {
  logGetBuffer,
  logQuery,
  logGetAvailableDates,
  logClear,
  logSubscribe,
  logUnsubscribe,
  logAction,
} from '../../core/log-backend'
import { COLORS } from '../../types'
import styles from './MonitorPage.module.css'

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
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${h}:${m}:${s}.${ms}`
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
      <mark className={styles.highlight}>{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </>
  )
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
    <aside className={styles.sidebar}>
      <div className={styles.sidebarLogo}>
        <span className={styles.logoIcon}>&#9673;</span>
        <span>TopoMind</span>
      </div>
      <nav className={styles.sidebarNav}>
        <button
          className={`${styles.navItem} ${activeTab === 'log' ? styles.navItemActive : ''}`}
          onClick={() => handleTabClick('log')}
        >
          <span className={styles.navIcon}>&#9776;</span>
          <span>日志监控</span>
          {stats.error > 0 && (
            <span className={styles.badge} style={{ background: '#e74c3c' }}>
              {stats.error}
            </span>
          )}
        </button>
        <button
          className={`${styles.navItem} ${activeTab === 'performance' ? styles.navItemActive : ''}`}
          onClick={() => handleTabClick('performance')}
        >
          <span className={styles.navIcon}>&#9651;</span>
          <span>性能监控</span>
          <span className={styles.badgePlaceholder} />
        </button>
      </nav>
      <div className={styles.sidebarStats}>
        <div className={styles.statTitle}>统计</div>
        <div className={styles.statRow}>
          <span className={styles.statDot} style={{ background: '#888' }} />
          <span className={styles.statLabel}>DEBUG</span>
          <span className={styles.statValue}>{stats.debug}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statDot} style={{ background: '#3498db' }} />
          <span className={styles.statLabel}>INFO</span>
          <span className={styles.statValue}>{stats.info}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statDot} style={{ background: '#f39c12' }} />
          <span className={styles.statLabel}>WARN</span>
          <span className={styles.statValue}>{stats.warn}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statDot} style={{ background: '#e74c3c' }} />
          <span className={styles.statLabel}>ERROR</span>
          <span className={styles.statValue}>{stats.error}</span>
        </div>
        <div className={styles.statTotal}>共 {stats.total} 条</div>
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
  const appendEntries = useMonitorStore((s) => s.appendEntries)
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
      levels: selectedLevels.length > 0 ? selectedLevels : undefined,
    })) as LogEntry[]
    // Append results instead of replacing to avoid wiping logs when query returns empty
    appendEntries(results)
  }, [selectedDate, selectedLevels, appendEntries])

  const handleClear = useCallback(async () => {
    logAction('监控:清空', 'MonitorPage', { bufferSizeBefore: entries.length })
    await logClear()
    setEntries([])
  }, [setEntries, entries])

  return (
    <div className={styles.filterBar}>
      <div className={styles.filterLeft}>
        {/* 关键词搜索 */}
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>&#9906;</span>
          <input
            className={styles.searchInput}
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
            <button className={styles.searchClear} onClick={() => {
              logAction('监控:清除关键词', 'MonitorPage', { previousKeyword: keyword })
              setKeyword('')
            }}>
              &#10005;
            </button>
          )}
        </div>

        {/* 日期选择 */}
        <select
          className={styles.dateSelect}
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
        <div className={styles.levelFilters}>
          {LEVELS.map((l) => (
            <button
              key={l}
              className={`${styles.levelBtn} ${
                selectedLevels.length === 0 || selectedLevels.includes(l)
                  ? styles.levelBtnActive
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

      <div className={styles.filterRight}>
        {/* 实时流开关 */}
        <label className={styles.streamToggle}>
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

        <button className={styles.actionBtn} onClick={handleRefresh} title="刷新">
          &#8635;
        </button>
        <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleClear} title="清空">
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
      className={`${styles.logRow} ${selected ? styles.logRowSelected : ''} ${
        level === 'ERROR' ? styles.logRowError : level === 'WARN' ? styles.logRowWarn : ''
      }`}
      onClick={onClick}
    >
      <span className={styles.logTime}>{formatTimestamp(entry.timestamp)}</span>
      <span className={styles.logLevel} style={{ color: levelColor }}>
        {level.padEnd(5)}
      </span>
      <span className={styles.logModule}>{highlightText(entry.module || 'Unknown', keyword)}</span>
      <span className={styles.logAction}>{highlightText(entry.action || '—', keyword)}</span>
      <span className={styles.logMessage}>{highlightText(entry.message || '', keyword)}</span>
    </div>
  )
}

/** 日志列表 */
function LogList() {
  const entries = useMonitorStore((s) => s.entries)
  const keyword = useMonitorStore((s) => s.keyword)
  const selectedLevels = useMonitorStore((s) => s.selectedLevels)
  const selectedEntry = useMonitorStore((s) => s.selectedEntry)
  const setSelectedEntry = useMonitorStore((s) => s.setSelectedEntry)
  const listRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  // 过滤
  const filtered = entries.filter((e) => {
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
    <div className={styles.logList} ref={listRef}>
      <div className={styles.logHeader}>
        <span className={styles.colTime}>时间</span>
        <span className={styles.colLevel}>等级</span>
        <span className={styles.colModule}>模块</span>
        <span className={styles.colAction}>动作</span>
        <span className={styles.colMessage}>消息</span>
      </div>
      <div className={styles.logBody}>
        {sorted.length === 0 ? (
          <div className={styles.emptyState}>
            {entries.length === 0 ? (
              <>
                <span className={styles.emptyIcon}>&#128269;</span>
                <p>暂无日志</p>
                <p className={styles.emptyHint}>在主应用中操作，知识将实时显示在这里</p>
              </>
            ) : (
              <>
                <span className={styles.emptyIcon}>&#8987;</span>
                <p>没有匹配的日志</p>
                <p className={styles.emptyHint}>尝试调整筛选条件</p>
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
                logAction('监控:选择日志', 'MonitorPage', {
                  entryId: entry.id,
                  entryLevel: entry.level,
                  entryAction: entry.action,
                  entryMessage: entry.message,
                })
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
      <div className={styles.detailPanel}>
        <div className={styles.detailEmpty}>选中一条日志查看详情</div>
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
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <span
          className={styles.detailLevel}
          style={{ color: LEVEL_COLORS[selectedEntry.level || 'INFO'] }}
        >
          {selectedEntry.level || 'INFO'}
        </span>
        <span className={styles.detailTitle}>
          {selectedEntry.action || selectedEntry.module || '日志条目'}
        </span>
        <div className={styles.detailActions}>
          <button className={styles.detailBtn} onClick={handleCopy}>
            {copied ? '已复制!' : '复制'}
          </button>
          <button className={styles.detailBtn} onClick={() => {
            logAction('监控:关闭详情', 'MonitorPage', { closedEntryId: selectedEntry.id })
            setSelectedEntry(null)
          }}>
            &#10005;
          </button>
        </div>
      </div>
      <div className={styles.detailBody}>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>时间</span>
          <span className={styles.detailValue}>{formatDate(selectedEntry.timestamp || '')}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>ID</span>
          <span className={styles.detailValue} style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {selectedEntry.id || '—'}
          </span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>模块</span>
          <span className={styles.detailValue}>{selectedEntry.module || '—'}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>动作</span>
          <span className={styles.detailValue}>{selectedEntry.action || '—'}</span>
        </div>
        {selectedEntry.func && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>函数</span>
            <span className={styles.detailValue} style={{ fontFamily: 'monospace' }}>
              {selectedEntry.file}:{selectedEntry.line} {selectedEntry.func}
            </span>
          </div>
        )}
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>消息</span>
          <span className={styles.detailValue}>{selectedEntry.message || '—'}</span>
        </div>
        {selectedEntry.params && (
          <div className={styles.detailRow} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className={styles.detailLabel}>参数</span>
            <pre className={styles.detailParams}>
              {typeof selectedEntry.params === 'string'
                ? selectedEntry.params
                : JSON.stringify(selectedEntry.params, null, 2)}
            </pre>
          </div>
        )}
        {(selectedEntry.traceId || selectedEntry.spanId || selectedEntry.parentId) && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>链路</span>
            <span className={styles.detailValue} style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {selectedEntry.traceId && `trace=${selectedEntry.traceId}`}
              {selectedEntry.spanId && ` span=${selectedEntry.spanId}`}
              {selectedEntry.parentId && ` parent=${selectedEntry.parentId}`}
            </span>
          </div>
        )}
        {selectedEntry.meta && (
          <div className={styles.detailRow} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className={styles.detailLabel}>元数据</span>
            <pre className={styles.detailParams}>
              {JSON.stringify(selectedEntry.meta, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

/** 性能监控页面（预留） */
function PerformanceTab() {
  return (
    <div className={styles.perfContainer}>
      <div className={styles.perfPlaceholder}>
        <span className={styles.emptyIcon}>&#9651;</span>
        <p>性能监控</p>
        <p className={styles.emptyHint}>预留功能，后续版本将集成性能指标可视化</p>
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
  const setAvailableDates = useMonitorStore((s) => s.setAvailableDates)
  const setLoaded = useMonitorStore((s) => s.setLoaded)

  // 初始化：加载缓冲区 + 订阅实时流
  useEffect(() => {
    logAction('页面:进入监控', 'MonitorPage', { timestamp: new Date().toISOString() })
    let mounted = true

    const init = async () => {
      // 加载内存缓冲区
      const [buffer, dates] = await Promise.all([logGetBuffer(), logGetAvailableDates()])
      if (!mounted) return
      appendEntries(buffer as LogEntry[])
      setAvailableDates(dates)
      setLoaded(true)
    }

    init()

    // 订阅实时日志
    const handleEntry = (entry: unknown) => {
      if (!mounted) return
      appendEntries([entry as Parameters<typeof appendEntries>[0][0]])
    }
    logSubscribe(handleEntry)

    return () => {
      mounted = false
      logUnsubscribe(handleEntry)
    }
  }, [appendEntries, setAvailableDates, setLoaded])

  return (
    <div className={styles.monitorRoot}>
      <Sidebar />
      <div className={styles.mainArea}>
        {activeTab === 'log' ? (
          <>
            <FilterBar />
            <div className={styles.contentArea}>
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
