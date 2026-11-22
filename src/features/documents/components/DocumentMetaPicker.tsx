import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DOCUMENT_COLOR_PRESETS, isValidHexColor } from './documentMeta'
import { EmojiPickerPanel } from '@/shared/ui/emoji/EmojiPickerPanel'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { TM_MOTION } from '@/shared/ui/motion'
import { DocumentStylePanel } from './DocumentStylePanel'
import type { TopoDocumentMetaPatch } from '../../../core/storage'

/**
 * 文档外观浮层外壳。
 * - icon / color：右键菜单「更换图标 / 修改字体颜色」的原有单用途入口，保持不变
 * - style：文档列表项 hover 快捷按钮打开的统一样式面板，图标 / 颜色 / 字体一次调完
 * 三种模式共用同一套 portal、视口钳制与外部点击关闭逻辑，避免视觉漂移。
 *
 * 定位与动效分层：外层 `.tm-popover-anchor` 只持坐标，内层 `.tm-popover-enter` 只播动画。
 * 位置在**渲染期同步钳制**，不再走 useEffect —— 旧实现首帧沿用上一次的 left/top
 * 挂载并立刻开播 CSS 动画，绘制后才被瞬移到本次坐标，同一个面板因此有时「从左侧
 * 飘出来」、有时原地淡入、有时干脆看不到动画。
 */
export interface DocumentMetaPickerState {
  mode: 'icon' | 'color' | 'style'
  x: number
  y: number
  targetId: string
  /** 样式面板预览用的文档标题 */
  title?: string
  /** 当前值，用于高亮/回显 */
  currentIcon?: string
  currentColor?: string
  currentFontSize?: number
  currentFontWeight?: 'normal' | 'bold'
  currentFontStyle?: 'normal' | 'italic'
}

interface DocumentMetaPickerProps {
  picker: DocumentMetaPickerState | null
  onClose: () => void
  onApply: (mode: 'icon' | 'color', targetId: string, value: string | null) => void
  /** 统一样式面板的批量写入；仅 style 模式使用 */
  onApplyPatch?: (targetId: string, patch: TopoDocumentMetaPatch) => void
}

const PICKER_MARGIN = 8
const PICKER_SIZE = {
  style: { width: 340, height: 460 },
  color: { width: 300, height: 280 },
} as const

/** 纯函数：与首帧一起提交，保证动画从最终坐标开始，不产生「先旧位置再瞬移」。 */
function clampPickerPosition(picker: DocumentMetaPickerState): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: picker.x, y: picker.y }
  const size = picker.mode === 'style' ? PICKER_SIZE.style : PICKER_SIZE.color
  return {
    x: Math.max(PICKER_MARGIN, Math.min(picker.x, window.innerWidth - size.width - PICKER_MARGIN)),
    y: Math.max(PICKER_MARGIN, Math.min(picker.y, window.innerHeight - size.height - PICKER_MARGIN)),
  }
}

export const DocumentMetaPicker: React.FC<DocumentMetaPickerProps> = ({ picker, onClose, onApply, onApplyPatch }) => {
  const [hexInput, setHexInput] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // 仅同步输入框回显。位置不在这里设置：useEffect 在 paint 之后执行，会让动画首帧
  // 落在上一次的坐标上（详见文件头注释）。
  useEffect(() => {
    if (!picker || (picker.mode !== 'color' && picker.mode !== 'style')) return
    setHexInput(picker.currentColor ?? '')
  }, [picker])

  // 表情面板自带外部点击 / Esc 关闭，这里只处理颜色 / 统一样式模式，避免双重监听。
  // style 面板里可能再开一层表情选择器：点到它内部不能把整块样式面板一起关掉。
  useEffect(() => {
    if (!picker || (picker.mode !== 'color' && picker.mode !== 'style')) return
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return
      if (e.target instanceof Element && e.target.closest('[data-tm-emoji-picker]:not([data-tm-exiting])')) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc 先交给二级表情面板处理，避免一次按键把两层一起关掉
      if (document.querySelector('[data-tm-emoji-picker]:not([data-tm-exiting])')) return
      onClose()
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

  if (picker.mode === 'icon') {
    return (
      <EmojiPickerPanel
        anchor={{ x: picker.x, y: picker.y }}
        title="更换图标"
        onClose={onClose}
        onRemove={() => onApply('icon', picker.targetId, null)}
        removeLabel="恢复默认图标"
        onSelect={(emoji) => onApply('icon', picker.targetId, emoji)}
      />
    )
  }

  const position = clampPickerPosition(picker)

  if (picker.mode === 'style') {
    return createPortal(
      <div
        ref={panelRef}
        className={TM_MOTION.anchor}
        data-tm-document-style-popover=""
        data-tm-keep-right-panel=""
        style={{ left: position.x, top: position.y, zIndex: 'var(--z-picker)' }}
      >
        <div
          className={tmUI(TM_UI.popover, 'flex w-[340px] max-w-[95vw] flex-col overflow-hidden', TM_MOTION.enter)}
          style={{ maxHeight: 'calc(100vh - 16px)' }}
        >
          <DocumentStylePanel
            title={picker.title ?? ''}
            anchor={{ x: position.x, y: position.y }}
            initial={{
              icon: picker.currentIcon || null,
              color: picker.currentColor || null,
              fontSize: picker.currentFontSize ?? null,
              fontWeight: picker.currentFontWeight ?? null,
              fontStyle: picker.currentFontStyle ?? null,
            }}
            onApply={(patch) => onApplyPatch?.(picker.targetId, patch)}
            onClose={onClose}
          />
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      ref={panelRef}
      className={TM_MOTION.anchor}
      data-tm-keep-right-panel=""
      style={{ left: position.x, top: position.y, zIndex: 'var(--z-picker)' }}
    >
      <div
        className={tmUI(
          TM_UI.popover,
          'flex max-w-[95vw] flex-col overflow-hidden',
          TM_MOTION.enter,
        )}
      >
        <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--color-border-subtle)] shrink-0">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">修改字体颜色</span>
          <button
            type="button"
            className="flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent cursor-pointer text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

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
              className="flex-1 h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
            />
            <button
              type="button"
              className="h-8 px-3 rounded-md border-none bg-[var(--color-primary)] text-[var(--color-text-inverse)] text-sm font-medium cursor-pointer disabled:opacity-40"
              disabled={!isValidHexColor(hexInput.trim())}
              onClick={() => onApply('color', picker.targetId, hexInput.trim())}
            >
              应用
            </button>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 h-8 px-2 rounded-md border-none bg-transparent cursor-pointer text-left text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]"
            onClick={() => onApply('color', picker.targetId, null)}
          >
            恢复默认颜色
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
