/**
 * 统一表情字形。
 *
 * 所有显示 emoji 的地方（画布节点表情、文档树图标、面包屑、选择器网格）
 * 都走这里：命中 Fluent Emoji Flat 本地 SVG 则用统一字形，未命中或非 emoji
 * 文本则原样渲染，保证旧数据（用户可能存过任意字符）不会丢失或变形。
 */
import { memo } from 'react'
import { emojiCharToUnified, emojiGlyphUrl, findGlyphAsset } from './emojiData'

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

export interface EmojiGlyphProps {
  /** 落盘的原生 emoji 字符串 */
  char: string
  /** picker 网格传入的 unified（含肤色），优先于从 char 推导 */
  unified?: string
  /** 数字按 px，字符串原样作为 CSS 尺寸（支持 em） */
  size?: number | string
  className?: string
  title?: string
}

export const EmojiGlyph = memo(function EmojiGlyph({
  char,
  unified,
  size = 16,
  className,
  title,
}: EmojiGlyphProps) {
  if (!char || typeof char !== 'string') return null

  const isEmoji = PICTOGRAPHIC.test(char)
  if (!isEmoji && !unified) {
    return <span className={className} title={title}>{char}</span>
  }

  const file = findGlyphAsset(unified ?? emojiCharToUnified(char))
  if (!file) {
    return <span className={className} title={title}>{char}</span>
  }

  const dimension = typeof size === 'number' ? `${size}px` : size
  return (
    <img
      src={emojiGlyphUrl(file)}
      alt={char}
      title={title}
      draggable={false}
      className={className}
      style={{
        width: dimension,
        height: dimension,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: '-0.16em',
        flexShrink: 0,
      }}
    />
  )
})
