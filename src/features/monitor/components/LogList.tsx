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
