import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DOCUMENT_COLOR_PRESETS, isValidHexColor } from './documentMeta'

/**
 * 文档图标/标题颜色选择器（通过右键菜单"更换图标 / 修改字体颜色"打开）。
 * - 图标：复用项目已有的 @emoji-mart 选择器（KnowledgeCard 同款用法）
 * - 颜色：内置主题色板，支持 hex 输入与清除（恢复默认）
 */
export interface DocumentMetaPickerState {
  mode: 'icon' | 'color'
  x: number
  y: number
  targetId: string
  /** 当前值，用于高亮/回显 */
  currentIcon?: string
  currentColor?: string
}

interface DocumentMetaPickerProps {
  picker: DocumentMetaPickerState | null
  onClose: () => void
  onApply: (mode: 'icon' | 'color', targetId: string, value: string | null) => void
}

export const DocumentMetaPicker: React.FC<DocumentMetaPickerProps> = ({ picker, onClose, onApply }) => {
  const [pickerPosition, setPickerPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [hexInput, setHexInput] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [emojiPicker, setEmojiPicker] = useState<{ Picker: React.ComponentType<any>; data: unknown } | null>(null)

  // 异步加载 emoji 选择器（避免增大首屏包体积）
  useEffect(() => {
    let cancelled = false
    if (picker?.mode === 'icon') {
      Promise.all([
        import('@emoji-mart/react'),
        import('@emoji-mart/data'),
      ]).then(([reactModule, dataModule]) => {
        if (cancelled) return
        setEmojiPicker({ Picker: reactModule.default, data: dataModule.default })
      }).catch(() => {
        // 加载失败时静默降级：点击菜单外关闭即可
      })
      return () => { cancelled = true }
    }
    setEmojiPicker(null)
    return () => { cancelled = true }
  }, [picker?.mode])

  // 面板打开时定位：优先放在菜单附近，超出视口则自动向内收缩
  // 注意：emoji-mart Picker 是 Web Component，宽度写死在 Shadow DOM（约 350px），
  // 不认 width 属性，因此面板宽度改为自适应 picker 自然宽度（见下方 style），
  // 这里只用估算值做视口钳制，避免弹出时超出屏幕。
  useEffect(() => {
    if (!picker) return
    const panelWidth = 360
    const panelHeight = picker.mode === 'icon' ? 560 : 320
    const margin = 8
    setPickerPosition({
      x: Math.max(margin, Math.min(picker.x, window.innerWidth - panelWidth - margin)),
      y: Math.max(margin, Math.min(picker.y, window.innerHeight - panelHeight - margin)),
    })
    setHexInput(picker.currentColor ?? '')
  }, [picker])

  // 点击面板外 / Esc 关闭
  useEffect(() => {
    if (!picker) return
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [picker, onClose])

  if (!picker) return null

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[1300] bg-[var(--titlebar-menu-bg)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 flex flex-col max-w-[95vw]"
      style={{ left: pickerPosition.x, top: pickerPosition.y, boxSizing: 'content-box' }}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--color-border-subtle)] shrink-0">
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
          {picker.mode === 'icon' ? '更换图标' : '修改字体颜色'}
        </span>
        <button
          type="button"
          className="flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent cursor-pointer text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {picker.mode === 'icon' ? (
        <div className="overflow-hidden flex-1 flex flex-col">
          <button
            type="button"
            className="flex items-center gap-1.5 h-8 px-3 shrink-0 border-b border-[var(--color-border-subtle)] bg-transparent cursor-pointer text-left text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={() => onApply('icon', picker.targetId, null)}
          >
            恢复默认图标
          </button>
          <div className="flex-1 overflow-hidden">
            {emojiPicker ? (
              <emojiPicker.Picker
                data={emojiPicker.data}
                theme="auto"
                previewPosition="none"
                searchPosition="static"
                emojiSize={20}
                maxSearchResults={40}
                onEmojiSelect={(emoji: { native?: string; id?: string }) => {
                  if (emoji?.native) onApply('icon', picker.targetId, emoji.native)
                }}
                onClickOutside={() => {}}
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-[12px] text-[var(--color-text-muted)]">
                加载图标选择器中…
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-3">
          <div className="grid grid-cols-6 gap-1.5">
            {DOCUMENT_COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                className={`w-8 h-8 rounded-lg border-none cursor-pointer transition-transform hover:scale-110 ${
                  picker.currentColor?.toLowerCase() === color ? 'ring-2 ring-offset-1 ring-[var(--color-primary)]' : ''
                }`}
                style={{ backgroundColor: color }}
                onClick={() => onApply('color', picker.targetId, color)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValidHexColor(hexInput.trim())) {
                  onApply('color', picker.targetId, hexInput.trim())
                }
              }}
              placeholder="#e74c3c"
              className="flex-1 h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
            />
            <button
              type="button"
              className="h-8 px-3 rounded-md border-none bg-[var(--color-primary)] text-white text-[12px] font-medium cursor-pointer disabled:opacity-40"
              disabled={!isValidHexColor(hexInput.trim())}
              onClick={() => onApply('color', picker.targetId, hexInput.trim())}
            >
              应用
            </button>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 h-8 px-2 rounded-md border-none bg-transparent cursor-pointer text-left text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={() => onApply('color', picker.targetId, null)}
          >
            恢复默认颜色
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
