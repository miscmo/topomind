/**
 * 面板状态持久化 composable
 * 将 GraphView.vue 中分散的 localStorage 读写逻辑集中管理
 */
import { logger } from '@/core/logger.js'

// ─── 常量 ───────────────────────────────────────────────────────────────────
export const STYLE_WIDTH_MIN = 300
export const STYLE_WIDTH_MAX = 420
export const DETAIL_WIDTH_MIN = 260
export const DETAIL_WIDTH_MAX = 860

// ─── key 生成 ────────────────────────────────────────────────────────────────
function detailWidthKeyForKB(kbPath) {
  return kbPath ? `topomind:detail-width:${kbPath}` : ''
}

function detailPanelStateKeyForKB(kbPath) {
  return kbPath ? `topomind:detail-panel:${kbPath}` : ''
}

function styleWidthKeyForKB(kbPath) {
  return kbPath ? `topomind:style-width:${kbPath}` : ''
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────
function clampPanelWidth(w, min, max, fallback) {
  const n = Number(w)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function clampDetailWidth(w) {
  return clampPanelWidth(w, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX, 420)
}

export function clampStyleWidth(w) {
  return clampPanelWidth(w, STYLE_WIDTH_MIN, STYLE_WIDTH_MAX, 300)
}

// ─── 主 composable ───────────────────────────────────────────────────────────
/**
 * @param {() => string} getKBPath - getter，返回当前 KB 路径
 */
export function usePanelState(getKBPath) {

  function readPersistedDetailWidth() {
    const key = detailWidthKeyForKB(getKBPath())
    if (!key) return null
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return null
      return clampDetailWidth(raw)
    } catch (e) {
      logger.warn('[usePanelState] readPersistedDetailWidth', e)
      return null
    }
  }

  function persistDetailWidth(width) {
    const key = detailWidthKeyForKB(getKBPath())
    if (!key) return
    try {
      localStorage.setItem(key, String(clampDetailWidth(width)))
    } catch (e) {
      logger.warn('[usePanelState] persistDetailWidth', e)
    }
  }

  function persistDetailPanelState(state) {
    const key = detailPanelStateKeyForKB(getKBPath())
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch (e) {
      logger.warn('[usePanelState] persistDetailPanelState', e)
    }
  }

  function readPersistedDetailPanelState() {
    const key = detailPanelStateKeyForKB(getKBPath())
    if (!key) return null
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return null
      return JSON.parse(raw)
    } catch (e) {
      logger.warn('[usePanelState] readPersistedDetailPanelState', e)
      return null
    }
  }

  function persistStyleWidth(width) {
    const key = styleWidthKeyForKB(getKBPath())
    if (!key) return
    try {
      localStorage.setItem(key, String(clampStyleWidth(width)))
    } catch (e) {
      logger.warn('[usePanelState] persistStyleWidth', e)
    }
  }

  function readPersistedStyleWidth() {
    // 优先读 KB 特定 key
    const kbVal = (() => {
      const key = styleWidthKeyForKB(getKBPath())
      if (!key) return null
      try {
        const raw = localStorage.getItem(key)
        if (raw == null) return null
        return clampStyleWidth(raw)
      } catch (e) {
        return null
      }
    })()
    if (kbVal !== null) return kbVal

    // 兜底旧全局 key（仅首次，迁移后删除）
    try {
      const raw = localStorage.getItem('topomind:style-width')
      if (raw == null) return null
      const val = clampStyleWidth(raw)
      // 迁移到 KB key 并删除旧 key
      if (getKBPath()) {
        persistStyleWidth(val)
      }
      localStorage.removeItem('topomind:style-width')
      return val
    } catch (e) {
      logger.warn('[usePanelState] readPersistedStyleWidth (legacy)', e)
      return null
    }
  }

  return {
    clampDetailWidth,
    clampStyleWidth,
    readPersistedDetailWidth,
    persistDetailWidth,
    readPersistedDetailPanelState,
    persistDetailPanelState,
    readPersistedStyleWidth,
    persistStyleWidth,
  }
}
