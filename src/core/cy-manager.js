/**
 * CyManager（最小版）
 * - 按 roomKey 缓存 Cytoscape 实例
 * - 单容器激活：同一时刻仅一个实例挂载到容器
 * - 支持 loaded / eventsBound 状态标记
 */
export function createCyManager(maxContexts = 4) {
  const contexts = new Map()
  let activeKey = null

  // 图谱样式定义（内联，避免 import 循环依赖）
  const GRAPH_STYLE = [
    { selector: 'node.card', style: {
      'shape': 'roundrectangle',
      'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'text-wrap': 'wrap', 'text-max-width': '100px',
      'text-justification': 'center',
      'line-height': 1.2,
      'background-color': '#4a6fa5', 'background-opacity': 0.92,
      'color': 'transparent', 'text-opacity': 0, 'font-size': '0px',
      'text-valign': 'center', 'text-halign': 'center',
      'padding': '14px',
      'underlay-color': '#000', 'underlay-opacity': 0.06, 'underlay-padding': 3,
      'transition-property': 'border-color,border-width,opacity',
      'transition-duration': '0.2s',
    }},
    { selector: 'edge[weight="main"]', style: {
      'width': 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 1,
      'line-color': '#999', 'target-arrow-color': '#999',
      'label': 'data(relation)', 'font-size': '8px', 'color': '#999',
      'text-rotation': 'autorotate', 'text-margin-y': -8,
      'text-background-color': '#f8f9fb', 'text-background-opacity': 0.9, 'text-background-padding': '2px',
    }},
    { selector: 'edge[relation="演进"]', style: { 'line-color': '#5cb85c', 'target-arrow-color': '#5cb85c' }},
    { selector: 'edge[relation="依赖"]', style: { 'line-color': '#e8913a', 'target-arrow-color': '#e8913a' }},
    { selector: 'edge[weight="minor"]', style: {
      'width': 1, 'line-style': 'dotted', 'line-color': '#ccc',
      'target-arrow-shape': 'none', 'opacity': 0.5, 'curve-style': 'bezier', 'label': '',
    }},
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#3498db',
      'underlay-color': '#3498db', 'underlay-opacity': 0.12 }},
    { selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': '#f39c12' }},
    { selector: 'edge.highlighted', style: { 'width': 3, 'opacity': 1, 'z-index': 999 }},
    { selector: 'node.faded', style: { 'opacity': 0.1 }},
    { selector: 'edge.faded', style: { 'opacity': 0.03 }},
    { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f1c40f' }},
  ]

  function cloneGraphStyle() {
    return GRAPH_STYLE.map((entry) => ({
      selector: entry.selector,
      style: { ...entry.style },
    }))
  }

  function getGraphStyle() {
    return cloneGraphStyle()
  }

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
    try { victim?.cy?.destroy?.() } catch (e) {}
    contexts.delete(victimKey)
  }

  function activate(key, container) {
    const target = contexts.get(key)
    if (!target) return null

    if (activeKey && activeKey !== key) {
      const prev = contexts.get(activeKey)
      if (prev?.cy?.unmount) {
        try { prev.cy.unmount() } catch (e) {}
      }
    }

    if (target.cy?.mount && container) {
      try { target.cy.mount(container) } catch (e) {}
    }

    if (target.cy?.style) {
      try { target.cy.style(getGraphStyle()) } catch (e) {}
    }

    if (target.cy?.elements) {
      try { target.cy.elements().removeStyle() } catch (e) {}
    }

    target.lastActiveAt = Date.now()
    activeKey = key
    return target
  }

  function remove(key) {
    const ctx = contexts.get(key)
    if (!ctx) return
    try { ctx.cy?.destroy?.() } catch (e) {}
    if (activeKey === key) activeKey = null
    contexts.delete(key)
  }

  function clear() {
    contexts.forEach((ctx) => {
      try { ctx.cy?.destroy?.() } catch (e) {}
    })
    contexts.clear()
    activeKey = null
  }

  return { has, get, create, activate, markLoaded, markEventsBound, remove, clear }
}
