import { logger } from './logger.js'
import { cloneGraphStyle } from './graph-style.js'

/**
 * CyManager（最小版）
 * - 按 roomKey 缓存 Cytoscape 实例
 * - 单容器激活：同一时刻仅一个实例挂载到容器
 * - 支持 loaded / eventsBound 状态标记
 */
export function createCyManager(maxContexts = 4) {
  const contexts = new Map()
  let activeKey = null

  function has(key) {
    return contexts.has(key)
  }

  function get(key) {
    return contexts.get(key) || null
  }

  function create(key, cy, extra = {}) {
    const ctx = {
      key,
      cy,
      lastActiveAt: Date.now(),
      loaded: false,
      eventsBound: false,
      ...extra,
    }
    contexts.set(key, ctx)
    evictIfNeeded()
    return contexts.get(key)
  }

  function markLoaded(key, loaded = true) {
    const ctx = contexts.get(key)
    if (ctx) ctx.loaded = loaded
  }

  function markEventsBound(key, bound = true) {
    const ctx = contexts.get(key)
    if (ctx) ctx.eventsBound = bound
  }

  function evictIfNeeded() {
    if (contexts.size <= maxContexts) return

    // LRU：尽量不驱逐当前 active
    let victimKey = null
    let victimTs = Infinity
    contexts.forEach((ctx, key) => {
      if (key === activeKey) return
      if ((ctx.lastActiveAt || 0) < victimTs) {
        victimTs = ctx.lastActiveAt || 0
        victimKey = key
      }
    })

    if (!victimKey) return
    const victim = contexts.get(victimKey)
    try { victim?.cy?.destroy?.() } catch (e) { logger.warn('CyManager', '销毁上下文失败:', e) }
    contexts.delete(victimKey)
  }

  function activate(key, container) {
    const target = contexts.get(key)
    if (!target) return null

    if (activeKey && activeKey !== key) {
      const prev = contexts.get(activeKey)
      if (prev?.cy?.unmount) {
        try { prev.cy.unmount() } catch (e) { logger.warn('CyManager', '卸载前一个实例失败:', e) }
      }
    }

    if (target.cy?.mount && container) {
      try { target.cy.mount(container) } catch (e) { logger.warn('CyManager', '挂载实例失败:', e) }
    }

    if (target.cy?.style) {
      try { target.cy.style(cloneGraphStyle()) } catch (e) { logger.warn('CyManager', '应用样式失败:', e) }
    }

    if (target.cy?.elements) {
      try { target.cy.elements().removeStyle() } catch (e) { logger.warn('CyManager', '清除元素样式失败:', e) }
    }

    target.lastActiveAt = Date.now()
    activeKey = key
    return target
  }

  function remove(key) {
    const ctx = contexts.get(key)
    if (!ctx) return
    try { ctx.cy?.destroy?.() } catch (e) { logger.warn('CyManager', '销毁实例失败:', e) }
    if (activeKey === key) activeKey = null
    contexts.delete(key)
  }

  function clear() {
    contexts.forEach((ctx) => {
      try { ctx.cy?.destroy?.() } catch (e) { logger.warn('CyManager', '销毁实例失败:', e) }
    })
    contexts.clear()
    activeKey = null
  }

  return { has, get, create, activate, markLoaded, markEventsBound, remove, clear }
}
