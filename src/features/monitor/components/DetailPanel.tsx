import React, { useState } from 'react'
import { useMonitorStore } from '../model/monitorStore'
import { logAction } from '../../../core/log-backend'
import { LEVEL_COLORS } from '../constants'
import { formatDate } from '../utils/formatters'

export function DetailPanel() {
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
