/**
 * 「最近使用」与「常用」合并策略。
 *
 * 参考飞书 / 腾讯文档：顶部一行是随使用更新的 LRU，后面接稳定的国内高频表情，
 * 全部由应用自己持有（localStorage），跨四个入口共用一份，不依赖库内建缓存。
 */
import { POPULAR_EMOJI_UNIFIEDS, normalizeUnified } from './emojiData'

const STORAGE_KEY = 'topomind_emoji_recent_v1'
const MAX_RECENT = 9

function safeRead(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && /^[0-9a-f-]+$/.test(item))
      .slice(0, MAX_RECENT)
      .map(normalizeUnified)
  } catch {
    return []
  }
}

function safeWrite(list: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 隐私模式 / 配额不足时静默降级，不影响选择功能
  }
}

export function readRecentEmojis(): string[] {
  return safeRead()
}

/** 选中后把 emoji 提到最前，返回新的最近使用列表。 */
export function pushRecentEmoji(unified: string): string[] {
  const key = normalizeUnified(unified).replace(/-1f3f[b-f]/g, '')
  if (!key) return safeRead()
  const next = [key, ...safeRead().filter((item) => item !== key)].slice(0, MAX_RECENT)
  safeWrite(next)
  return next
}

/** picker 的 suggested 区：最近使用（最多 9）+ 国内高频置顶（去重）。 */
export function suggestedEmojiUnifieds(): string[] {
  const recent = safeRead()
  const seen = new Set(recent)
  return [
    ...recent,
    ...POPULAR_EMOJI_UNIFIEDS.map(normalizeUnified).filter((item) => !seen.has(item)),
  ]
}
