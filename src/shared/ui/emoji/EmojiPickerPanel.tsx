/**
 * 统一表情选择器面板。
 *
 * 四个入口（画布右键添加、点击卡片已有表情、文档树图标、文档右键/面包屑）
 * 全部复用这一个面板：同一个中文词库、同一套 Fluent Emoji Flat 字形、
 * 同一份最近使用、同一个定位与关闭逻辑，不再各自动态加载一整套 emoji-mart。
 *
 * 交互骨架（虚拟滚动、键盘导航、ARIA、肤色、搜索、分类）交给成熟的
 * emoji-picker-react v5；外观与数据由本项目持有。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import EmojiPicker, {
  SkinTonePickerLocation,
  type EmojiClickData,
  type EmojiRenderProps,
} from 'emoji-picker-react'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { X } from 'lucide-react'
import { TM_UI } from '@/shared/ui/controlStyles'
import { TM_MOTION } from '@/shared/ui/motion'
import { EMOJI_DATA_ZH, emojiLabel } from './emojiData'
import { EmojiGlyph } from './EmojiGlyph'
import { pushRecentEmoji, suggestedEmojiUnifieds } from './emojiRecent'
import './emojiPicker.css'

export interface EmojiPickerAnchor {
  x: number
  y: number
}

export interface EmojiPickerPanelProps {
  /** 触发元素的屏幕坐标，floating-ui 负责翻转与视口钳制 */
  anchor: EmojiPickerAnchor
  title?: string
  onSelect: (emoji: string) => void
  onClose: () => void
  /** 编辑已有表情时提供「移除」操作 */
  onRemove?: () => void
  removeLabel?: string
  autoFocus?: boolean
}

const PICKER_LABELS = {
  searchPlaceholder: '搜索表情，支持中文 / 拼音',
  searchLabel: '搜索表情',
  searchClear: '清除搜索',
  searchResultsNone: '没有找到相关表情，试试中文或拼音',
  searchResultsOne: '找到 1 个表情',
  searchResultsMany: '找到 %n 个表情',
  categoryNavigation: '表情分类',
  loading: '正在加载表情…',
  loadingError: '表情加载失败',
  retryLoading: '重试',
  skinToneNeutral: '默认肤色',
  skinToneLight: '较浅肤色',
  skinToneMediumLight: '中等偏浅肤色',
  skinToneMedium: '中等肤色',
  skinToneMediumDark: '中等偏深肤色',
  skinToneDark: '较深肤色',
}

export const EmojiPickerPanel: React.FC<EmojiPickerPanelProps> = ({
  anchor,
  title = '选择表情',
  onSelect,
  onClose,
  onRemove,
  removeLabel = '移除此表情',
  autoFocus = true,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState<{ unified: string; char: string } | null>(null)
  const suggested = useMemo(() => suggestedEmojiUnifieds(), [])

  const { refs, floatingStyles, isPositioned } = useFloating({
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node
    refs.setFloating(node)
  }, [refs])

  // 触发点是坐标而非 DOM 元素，包一个 virtual element 给 floating-ui
  useEffect(() => {
    const rect = {
      width: 0, height: 0,
      x: anchor.x, y: anchor.y,
      top: anchor.y, left: anchor.x, right: anchor.x, bottom: anchor.y,
    }
    refs.setReference({ getBoundingClientRect: () => rect, contextElement: document.body })
  }, [refs, anchor.x, anchor.y])

  // 外部点击 / Esc 关闭。右键菜单项属于「打开面板」的操作，不能顺手把面板关掉。
  useEffect(() => {
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Element | null
      if (panelRef.current?.contains(target as Node)) return
      if (target?.closest?.('[data-context-menu-item]:not([data-tm-exiting])')) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('touchstart', handleOutside, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('touchstart', handleOutside, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  const handleEmojiClick = useCallback((data: EmojiClickData) => {
    pushRecentEmoji(data.unifiedWithoutSkinTone || data.unified)
    onSelect(data.emoji)
    onClose()
  }, [onSelect, onClose])

  // 自定义格子：用本地 Fluent Emoji Flat 统一字形，同时上报 hover/focus 给底部预览条。
  // 库管理的 props（位置、tabIndex、aria-label、data-epr-*）必须原样 spread 回 button，
  // 虚拟滚动与键盘导航都依赖它们。
  const EmojiCell = useCallback((props: EmojiRenderProps) => {
    const { emoji, ...buttonProps } = props
    const report = () => setActive({ unified: emoji.unified, char: emoji.emoji })
    return (
      <button
        {...buttonProps}
        className={`${buttonProps.className ?? ''} tm-emoji-cell`}
        onMouseEnter={(event) => { buttonProps.onMouseEnter?.(event); report() }}
        onFocus={(event) => { buttonProps.onFocus?.(event); report() }}
      >
        <EmojiGlyph char={emoji.emoji} unified={emoji.unified} size={22} />
      </button>
    )
  }, [])

  // 分层：外层只承接 floating-ui 的定位 transform，内层才播入场动画。
  // 若同一元素既用 transform 定位又播 transform 动画，@keyframes 会覆盖定位，
  // 面板就会「从屏幕左上角滑过来」。isPositioned 之前先隐藏，避免首帧闪现在 (0,0)。
  return createPortal(
    <div
      ref={setPanelRef}
      className={TM_MOTION.anchor}
      data-tm-emoji-picker=""
      style={{
        ...floatingStyles,
        zIndex: 'var(--z-picker)',
        visibility: isPositioned ? 'visible' : 'hidden',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className={`tm-emoji-picker ${isPositioned ? TM_MOTION.enter : ''}`}>
        <div className="tm-emoji-header">
          <span className="tm-emoji-title">{title}</span>
          <div className="tm-emoji-header-actions">
            {onRemove && (
              <button type="button" className={TM_UI.buttonGhost} onClick={onRemove}>
                {removeLabel}
              </button>
            )}
            <button type="button" className={TM_UI.iconButton} onClick={onClose} aria-label="关闭表情选择器">
              <X size={14} />
            </button>
          </div>
        </div>

        <EmojiPicker
          emojiData={EMOJI_DATA_ZH}
          onEmojiClick={handleEmojiClick}
          width={340}
          height={352}
          columns={9}
          theme="auto"
          emojiStyle="native"
          lazyLoadEmojis
          autoFocusSearch={autoFocus}
          suggestedEmojis={suggested}
          skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
          previewConfig={{ showPreview: false }}
          labels={PICKER_LABELS}
          components={{ Emoji: EmojiCell }}
        />

        <div className="tm-emoji-preview">
          {active ? (
            <>
              <EmojiGlyph char={active.char} unified={active.unified} size={20} />
              <span className="tm-emoji-preview-name">{emojiLabel(active.unified) || '表情'}</span>
            </>
          ) : (
            <span className="tm-emoji-preview-name">输入中文或拼音快速查找</span>
          )}
          <span className="tm-emoji-preview-hint">Enter 选择 · Esc 关闭</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
