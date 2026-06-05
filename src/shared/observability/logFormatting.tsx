import React from 'react'

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
      <mark className="bg-[#fef08a] text-[#854d0e] rounded-[2px] px-[1px]">
        {text.slice(index, index + keyword.length)}
      </mark>
      {text.slice(index + keyword.length)}
    </React.Fragment>
  )
}

export function toDateStr(iso: string): string {
  try {
    const date = new Date(iso)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  } catch {
    return ''
  }
}
