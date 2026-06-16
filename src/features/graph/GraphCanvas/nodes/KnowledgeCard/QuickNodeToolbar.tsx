import { memo, useState, useRef, useEffect } from 'react'
import { Bold, Italic, ChevronDown, Type, Maximize2, PaintBucket, PaintRoller } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickNodeToolbarProps {
  autoWidth: boolean
  fontSize: number
  backgroundColor: string
  bold: boolean
  italic: boolean
  isFormatPainterActive: boolean
  onToggleAutoWidth: () => void
  onBackgroundColorChange: (value: string) => void
  onFontSizeChange: (value: number) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleFormatPainter: () => void
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation()
}

function QuickNodeToolbar({
  autoWidth,
  fontSize,
  backgroundColor,
  bold,
  italic,
  isFormatPainterActive,
  onToggleAutoWidth,
  onBackgroundColorChange,
  onFontSizeChange,
  onToggleBold,
  onToggleItalic,
  onToggleFormatPainter,
}: QuickNodeToolbarProps) {
  const [isFontSizeMenuOpen, setIsFontSizeMenuOpen] = useState(false)
  const fontSizeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isFontSizeMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (fontSizeMenuRef.current && !fontSizeMenuRef.current.contains(e.target as Node)) {
        setIsFontSizeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isFontSizeMenuOpen])

  return (
    <div
      className="absolute left-1/2 -top-[60px] z-[60] flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-1.5 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12),0_4px_10px_rgba(0,0,0,0.06)] backdrop-blur-xl pointer-events-auto nodrag nowheel transition-all"
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onDoubleClick={stopEvent}
    >
      <button
        type="button"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
          autoWidth
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
        )}
        onClick={onToggleAutoWidth}
        title={autoWidth ? "取消自适应宽高" : "启用自适应宽高"}
      >
        <Maximize2 className="h-4 w-4" strokeWidth={2} />
      </button>

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border)]/50" />

      <div 
        className="relative flex h-7 w-7 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)] transition-all duration-200 cursor-pointer"
        title="更改背景色"
      >
        <PaintBucket className="h-[15px] w-[15px] absolute opacity-40" strokeWidth={2} />
        <div 
          className="h-3.5 w-3.5 rounded-full border-[1.5px] border-[var(--color-surface)] shadow-sm z-10"
          style={{ backgroundColor: backgroundColor || '#ffffff' }}
        />
        <input
          type="color"
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer z-20"
          value={backgroundColor || '#ffffff'}
          onChange={(event) => onBackgroundColorChange(event.target.value)}
        />
      </div>

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border)]/50" />

      <div 
        className="relative flex h-7 items-center justify-center rounded-xl px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)] transition-all duration-200 cursor-pointer"
        title="更改字号"
        ref={fontSizeMenuRef}
        onClick={() => setIsFontSizeMenuOpen(!isFontSizeMenuOpen)}
      >
        <Type className="mr-1 h-3.5 w-3.5" strokeWidth={2.5} />
        <span className="text-[13px] font-medium min-w-[16px] text-center tracking-tight">{fontSize}</span>
        <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-50" strokeWidth={2.5} />
        {isFontSizeMenuOpen && (
          <div className="absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 min-w-[90px] p-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12),0_4px_10px_rgba(0,0,0,0.06)] z-[70] flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
            {[10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32].map((size) => (
              <button
                key={size}
                type="button"
                className={cn(
                  "flex items-center justify-between w-full h-7 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none",
                  fontSize === size 
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" 
                    : "bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)]"
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onFontSizeChange(size)
                  setIsFontSizeMenuOpen(false)
                }}
              >
                <span>{size}px</span>
                {fontSize === size && <span className="text-[var(--color-accent)] text-[11px]">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border)]/50" />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
            bold
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
          )}
          onClick={onToggleBold}
          title="粗体"
        >
          <Bold className="h-4 w-4" strokeWidth={bold ? 3 : 2} />
        </button>

        <button
          type="button"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
            italic
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
          )}
          onClick={onToggleItalic}
          title="斜体"
        >
          <Italic className="h-4 w-4" strokeWidth={italic ? 2.5 : 2} />
        </button>
      </div>

      <div className="mx-0.5 h-4 w-[1px] bg-[var(--color-border)]/50" />

      <button
        type="button"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200",
          isFormatPainterActive
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text)]"
        )}
        onClick={onToggleFormatPainter}
        title={isFormatPainterActive ? "取消格式刷 (Esc)" : "格式刷"}
      >
        <PaintRoller className="h-4 w-4" strokeWidth={isFormatPainterActive ? 2.5 : 2} />
      </button>
    </div>
  )
}

export default memo(QuickNodeToolbar)
