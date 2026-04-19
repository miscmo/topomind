import { logger } from './logger.js'
import { cloneGraphStyle } from './graph-style.js'

/**
 * CyManager（最小版）
 * - 按 roomKey 缓存 Cytoscape 实例
 * - 单容器激活：同一时刻仅一个实例挂载到容器
 * - 支持 loaded / eventsBound 状态标记
 */
/**
 * 创建 Cytoscape 实例管理器，用于缓存房间上下文并控制激活/淘汰逻辑。
 *
 * @param {number} [maxContexts=4] 最大上下文缓存数量
 * @returns {object} cy manager 方法集合
 */
export function createCyManager(maxContexts = 4) {
  const contexts = new Map()
  let activeKey = null

  /**
   * 判断指定 key 的上下文是否存在。
   *
   * @param {string} key 房间上下文 key
   * @returns {boolean} 是否存在
   */
  function has(key) {
    return contexts.has(key)
  }

  /**
   * 获取指定 key 对应的上下文对象。
   *
   * @param {string} key 房间上下文 key
   * @returns {object|null} 上下文对象
   */
  function get(key) {
    return contexts.get(key) || null
  }

  /**
   * 创建并缓存一个新的 Cytoscape 上下文。
   *
   * @param {string} key 房间上下文 key
   * @param {import('cytoscape').Core} cy Cytoscape 实例
   * @param {object} [extra={}] 附加上下文信息
   * @returns {object|null} 创建后的上下文
   */
  function create(key, cy, extra = {}) {
    const ctx = {
      key,
      cy,
      lastActiveAt: Date.now(),
      loaded: false,
      eventsBound: false,
      cleanup: extra?.cleanup || null,
      ...extra,
    }
    contexts.set(key, ctx)
    evictIfNeeded()
    return contexts.get(key)
  }

  /**
   * 标记指定上下文是否已完成数据加载。
   *
   * @param {string} key 房间上下文 key
   * @param {boolean} [loaded=true] 是否已加载
   * @returns {void}
   */
  function markLoaded(key, loaded = true) {
    const ctx = contexts.get(key)
    if (ctx) ctx.loaded = loaded
  }

  /**
   * 标记指定上下文是否已完成事件绑定。
   *
   * @param {string} key 房间上下文 key
   * @param {boolean} [bound=true] 是否已绑定
   * @returns {void}
   */
  function markEventsBound(key, bound = true) {
    const ctx = contexts.get(key)
    if (ctx) ctx.eventsBound = bound
  }

  /**
   * 在缓存超出上限时按 LRU 策略淘汰最久未激活的非当前上下文。
   *
   * @returns {void}
   */
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
    try { victim?.cleanup?.() } catch (e) { logger.warn('CyManager', '清理DOM事件失败:', e) }
    try { victim?.cy?.destroy?.() } catch (e) { logger.warn('CyManager', '销毁上下文失败:', e) }
    contexts.delete(victimKey)
  }

  /**
   * 激活指定上下文，并将对应实例挂载到目标容器。
   * 激活时会卸载上一个实例、恢复样式并更新时间戳。
   *
   * @param {string} key 房间上下文 key
   * @param {HTMLElement} container 挂载容器
   * @returns {object|null} 被激活的上下文
   */
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

  /**
   * 移除指定上下文并销毁对应实例。
   *
   * @param {string} key 房间上下文 key
   * @returns {void}
   */
  function remove(key) {
    const ctx = contexts.get(key)
    if (!ctx) return
    try { ctx.cleanup?.() } catch (e) { logger.warn('CyManager', '清理DOM事件失败:', e) }
    try { ctx.cy?.destroy?.() } catch (e) { logger.warn('CyManager', '销毁实例失败:', e) }
    if (activeKey === key) activeKey = null
    contexts.delete(key)
  }

  /**
   * 清空所有上下文并销毁对应实例。
   *
   * @returns {void}
   */
  function clear() {
    contexts.forEach((ctx) => {
      try { ctx.cy?.destroy?.() } catch (e) { logger.warn('CyManager', '销毁实例失败:', e) }
    })
    contexts.clear()
    activeKey = null
  }

  return { has, get, create, activate, markLoaded, markEventsBound, remove, clear }
}
