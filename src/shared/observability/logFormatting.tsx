import React from 'react'
import { logDayKey } from './logContract'

export function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    const ms = String(date.getMilliseconds()).padStart(3, '0')
    return `${yyyy}-${mm}-${dd} ${h}:${m}:${s}.${ms}`
  } catch {
    return iso
  }
}

export function formatDate(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function highlightText(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text
  const index = text.toLowerCase().indexOf(keyword.toLowerCase())
  if (index < 0) return text

  return (
    <React.Fragment>
      {text.slice(0, index)}
      <mark className="bg-[var(--color-search-match)] text-[var(--color-text-inverse)] rounded-sm px-[1px]">
        {text.slice(index, index + keyword.length)}
      </mark>
      {text.slice(index + keyword.length)}
    </React.Fragment>
  )
}

/** 与主进程分片名同口径（本地日）；无效时间戳返回空串而不是 NaN-NaN-NaN。 */
export function toDateStr(iso: string): string {
  return iso ? logDayKey(iso) : ''
}
