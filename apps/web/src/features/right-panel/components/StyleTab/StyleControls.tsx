import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'

const COLOR_PRESETS = ['#7f8c8d', '#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6']

interface RecentColorsStore {
  recentColors: string[]
  addColor: (c: string) => void
}

const useRecentColorsStore = create<RecentColorsStore>((set) => ({
  recentColors: (() => {
    try {
      const stored = localStorage.getItem('topomind_recent_colors')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })(),
  addColor: (color) => set((state) => {
    const filtered = state.recentColors.filter(c => c !== color)
    const next = [color, ...filtered].slice(0, 10)
    localStorage.setItem('topomind_recent_colors', JSON.stringify(next))
    return { recentColors: next }
  })
}))

export function StyleCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-xl p-0 shadow-[var(--shadow-sm)] overflow-hidden">
      {children}
    </div>
  )
}

export function CollapsibleBlock({
  title,
  hint,
  defaultExpanded = false,
  expandedKey,
  expandedState,
  onToggle,
  children
}: {
  title: string
  hint?: string
  defaultExpanded?: boolean
  expandedKey: string
  expandedState: Record<string, boolean>
  onToggle: (key: string) => void
  children: ReactNode
}) {
  const isExpanded = expandedState[expandedKey] ?? defaultExpanded

  return (
    <div className="border-b border-[var(--color-border-subtle)] last-of-type:border-none">
      <div
        className="text-[13px] font-semibold text-[var(--color-text-primary)] m-0 flex items-center justify-between cursor-pointer select-none px-4 py-3 bg-transparent transition-colors duration-75 hover:bg-[var(--color-hover-bg)]"
        onClick={() => onToggle(expandedKey)}
      >
        <span>{title}</span>
        <span className={`text-[10px] leading-none text-[var(--color-text-muted)] transition-all duration-75 inline-flex items-center justify-center self-center w-6 h-6 rounded-md hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-secondary)] ${!isExpanded ? '-rotate-90' : ''}`}>▼</span>
      </div>
      <div className={`px-4 pb-4 min-h-0 ${!isExpanded ? 'hidden' : ''}`}>
        {hint && <div className="text-[12px] text-[var(--color-text-muted)] m-0 mb-4 leading-[1.4] bg-[var(--color-bg)] py-2 px-3 rounded-md border-l-[3px] border-[var(--color-accent)]">{hint}</div>}
        {children}
      </div>
    </div>
  )
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const recentColors = useRecentColorsStore(s => s.recentColors)
  const addColor = useRecentColorsStore(s => s.addColor)
  const [textValue, setTextValue] = useState(value || '')

  useEffect(() => {
    setTextValue(value || '')
  }, [value])

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    addColor(e.target.value)
  }

  const handleChange = (v: string) => {
    onChange(v)
    addColor(v)
  }

  const commitTextValue = () => {
    const next = textValue.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(next)) {
      handleChange(next)
      return
    }
    setTextValue(value || '')
  }

  return (
    <div className="flex flex-col gap-[6px] w-full">
      <div className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-md p-[2px] h-8 box-border w-full">
        <div className="w-[26px] h-[26px] rounded border border-black/10 overflow-hidden relative" style={{ backgroundColor: value || '#ffffff' }}>
          <input className="absolute -top-2.5 -left-2.5 w-[50px] h-[50px] p-0 border-none cursor-pointer opacity-0" type="color"
            value={value || '#ffffff'}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
          />
        </div>
        <input
          className="font-mono text-[11px] text-[var(--color-text-secondary)] flex-1 uppercase bg-transparent border-none outline-none min-w-0"
          value={textValue}
          placeholder="#FFFFFF"
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitTextValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTextValue()
            if (e.key === 'Escape') setTextValue(value || '')
          }}
        />
      </div>

      <div className="flex items-center flex-wrap gap-[6px]">
        <div className="flex items-center flex-wrap gap-1">
          {COLOR_PRESETS.slice(0, 6).map(c => (
            <button
              key={c}
              className="w-4 h-4 rounded border border-black/10 cursor-pointer p-0 transition-all duration-100 hover:scale-[1.15] hover:shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
              style={{ backgroundColor: c }}
              onClick={() => handleChange(c)}
              title={c}
            />
          ))}
        </div>
        {recentColors.length > 0 && (
          <>
            <div className="w-px h-3 bg-[var(--color-border-strong)] mx-[2px]" />
            <div className="flex items-center flex-wrap gap-1">
              {recentColors.slice(0, 6).map(c => (
                <button
                  key={c}
                  className="w-4 h-4 rounded border border-black/10 cursor-pointer p-0 transition-all duration-100 hover:scale-[1.15] hover:shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
                  style={{ backgroundColor: c }}
                  onClick={() => handleChange(c)}
                  title={`最近使用: ${c}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  className = '',
}: {
  label: string
  unit?: string
  value: number | string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-[6px] mb-0 ${className}`}>
      <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">
        {label} {unit && <span className="text-[10px] text-[var(--color-text-muted)]">{unit}</span>}
      </label>
      <input
        className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export function SegmentedControl({
  options,
  value,
  onChange
}: {
  options: { label: string; value: string | number | boolean }[]
  value: string | number | boolean
  onChange: (v: string | number | boolean) => void
}) {
  return (
    <div className="flex bg-[var(--color-bg-muted)] rounded-md p-[2px] w-full box-border">
      {options.map((opt, i) => (
        <button
          key={i}
          className={`flex-1 border-none py-1 text-[12px] font-medium rounded cursor-pointer transition-all duration-75 text-center ${value === opt.value ? 'bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function ToggleGroup({
  options,
  value,
  onChange
}: {
  options: { label: string; value: string | number | boolean }[]
  value: string | number | boolean
  onChange: (v: string | number | boolean) => void
}) {
  return (
    <div className="flex gap-2 w-full">
      {options.map((opt, i) => (
        <button
          key={i}
          className={`flex-1 flex items-center justify-center gap-[6px] h-8 border rounded-md text-[12px] font-medium cursor-pointer transition-all duration-75 ${value === opt.value ? 'bg-[var(--color-selected-bg)] border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]'}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function ToggleButton({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex-1 flex items-center justify-center gap-[6px] h-8 border rounded-md text-[12px] font-medium cursor-pointer transition-all duration-75 ${active ? 'bg-[var(--color-selected-bg)] border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]'}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

export function PresetButtonGrid<T extends { label: string }>({
  presets,
  onApply,
}: {
  presets: T[]
  onApply: (preset: T) => void
}) {
  return (
    <div className="col-span-full flex flex-col gap-[6px]">
      <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">风格预设</label>
      <div className="grid grid-cols-3 gap-2">
        {presets.map((preset) => (
          <button key={preset.label} type="button" className="h-8 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]" onClick={() => onApply(preset)}>{preset.label}</button>
        ))}
      </div>
    </div>
  )
}
