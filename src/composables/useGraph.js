/**
 * useGraph composable
 * 封装 Cytoscape 图谱引擎，管理：
 *   - cy 实例生命周期
 *   - 房间加载（loadRoom）
 *   - 节点/边 CRUD
 *   - 布局保存
 *   - 交互事件（点击、双击、右键、缩放、拖拽）
 */
import { ref, shallowRef, onUnmounted, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useStorage, showSaveIndicator } from '@/composables/useStorage'
import { GitCache } from '@/core/git-backend.js'
import { normalizeMeta } from '@/core/meta.js'
import { createCyManager } from '@/core/cy-manager.js'
import cytoscape from 'cytoscape'
import elk from 'cytoscape-elk'
import htmlLabel from 'cytoscape-node-html-label'

// 注册 ELK 布局插件
cytoscape.use(elk)
// 注册 HTML 标签插件
cytoscape.use(htmlLabel)

export function useGraph(containerRef) {
  const appStore = useAppStore()
  const roomStore = useRoomStore()
  const modalStore = useModalStore()
  const storage = useStorage()

  // Cytoscape 实例（shallowRef，不做深度响应式）
  const cy = shallowRef(null)
  // 外部注入的 grid composable 引用
  let _grid = null
  // 右键拖拽状态（仅用于菜单抑制；实际拖拽状态按实例在 _bindDOMEvents 内隔离）
  let _rightDragMoved = false
  // 右键菜单目标（传给 ContextMenu 组件）
  const contextMenu = ref({ type: null, x: 0, y: 0, nodeId: null, bgPos: null })
  // 当前缩放值（用于显示）
  const zoomLevel = ref(100)
  // 搜索关键词
  const searchQuery = ref('')
  const cyManager = createCyManager(4)
  const _cyEventsBound = new WeakSet()
  const _domCleanupByCy = new Map()
  const _handleElsByCy = new Map()
  let _dragResizeState = null
  let _dragConnectState = null

  function _detachAllDomBindingsExcept(activeCy = null) {
    for (const [cyInst, cleanup] of _domCleanupByCy.entries()) {
      if (!activeCy || cyInst !== activeCy) {
        try { cleanup?.() } catch (e) {}
        _domCleanupByCy.delete(cyInst)
      }
    }
  }

  function _roomKey(dirPath) {
    const kb = roomStore.currentKBPath || ''
    return `${kb}::${dirPath || ''}`
  }

  // ─── 节点 HTML 标签生成器（tpl 函数，供 cytoscape-node-html-label 调用）─────
  function generateNodeLabelHtml(data) {
    const label = data.label || ''
    const hasDoc = !!data.hasDoc
    const childCount = data.childCount || 0

    // 从节点数据读取文字样式
    const fontSize = Number(data.fontSize) || 12
    const fontColor = data.fontColor || '#fff'
    const fontStyle = data.fontStyle || ''
    const textAlign = data.textAlign || 'center'
    const textWrap = data.textWrap !== false
    const fontWeight = fontStyle.includes('bold') ? 'bold' : ''
    const fontStyleAttr = fontStyle.includes('italic') ? 'italic' : ''

    // DEBUG
    console.log('[HTML label]生成标签 id=' + data.id + ' fontColor=' + fontColor + ' fontSize=' + fontSize + ' fontStyle=' + fontStyle)

    // 记录时间戳用于调试事件触发顺序
    if (!window.__labelGenCount) window.__labelGenCount = 0
    window.__labelGenCount++
    console.log('[HTML label] 生成次数 #' + window.__labelGenCount + ' id=' + data.id)

    // 文档图标：14x14px 固定尺寸，不随父元素 font-size 缩放
    const docIcon = hasDoc
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;font-size:0;line-height:0;vertical-align:text-bottom"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="9" height="12" rx="1.5" stroke="#fff" stroke-width="1.2" fill="none"/><rect x="4" y="1" width="6" height="5" rx="1" fill="#fff" opacity="0.9"/><line x1="3" y1="8" x2="9" y2="8" stroke="#fff" stroke-width="1" stroke-linecap="round"/><line x1="3" y1="10" x2="9" y2="10" stroke="#fff" stroke-width="1" stroke-linecap="round"/><line x1="3" y1="12" x2="7" y2="12" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg></span>`
      : ''

    // 子节点计数：固定 10px，不随节点文字大小变化
    const childIcon = childCount > 0
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:14px;padding:0 3px;flex-shrink:0;font-size:10px;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif;color:#fff;line-height:1;vertical-align:text-bottom;box-sizing:border-box;background:rgba(255,255,255,0.25);border-radius:7px">${childCount}↓</span>`
      : ''

    const badgeGroup = (docIcon || childIcon)
      ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:5px;flex-shrink:0;vertical-align:text-bottom">${docIcon}${childIcon}</span>`
      : ''

    // 文字样式：使用节点数据的 fontSize、fontColor、fontStyle、textWrap
    const textStyles = [
      'display:inline',
      'vertical-align:text-bottom',
      `font-size:${fontSize}px`,
      `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`,
      `color:${fontColor}`,
      fontWeight ? `font-weight:${fontWeight}` : '',
      fontStyleAttr ? `font-style:${fontStyleAttr}` : '',
      `text-align:${textAlign}`,
      `white-space:${textWrap ? 'normal' : 'nowrap'}`,
    ].filter(Boolean).join(';')

    return `<span style="${textStyles}">${badgeGroup}${label}</span>`
  }

  // ─── 设置 HTML 标签（在 cy.mount() 之后调用）─────────────────────
  // 使用 cytoscape-node-html-label 插件渲染节点 HTML 标签
  // 注意：cytoscape-node-html-label 内部会清理旧容器，故可安全重复调用
  function _setupHtmlLabels(cyInst, forceInit = false) {
    if (!cyInst) return
    console.log('[_setupHtmlLabels] 开始设置 forceInit=' + forceInit)
    const container = cyInst.container()
    console.log('[_setupHtmlLabels] cy.container()=', container ? '存在' : 'null')
    cyInst.nodeHtmlLabel([{
      query: 'node.card',
      tpl: (data) => generateNodeLabelHtml(data),
      halign: 'center',
      valign: 'center',
    }], { enablePointerEvents: false })

    // 如果 graph 已经有节点了（从缓存激活的旧实例），
    // 'render' 事件已过，手动触发一次 label 创建
    if (forceInit || (cyInst.nodes && cyInst.nodes().length > 0)) {
      try {
        console.log('[_setupHtmlLabels] 触发 render 事件，节点数=' + cyInst.nodes().length)
        cyInst.emit('render')
      } catch (e) {
        console.error('[_setupHtmlLabels] emit render 失败:', e)
      }
    }
  }

  // ─── 初始化 Cytoscape ────────────────────────────────────────
  function _createCyInstance(container = null) {
    const instance = cytoscape({
      container: container || containerRef.value || undefined,
      elements: [],
      minZoom: 0.15, maxZoom: 3.5,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: true,
      selectionType: 'additive',
      style: [
        { selector: 'node.card', style: {
          'shape': 'roundrectangle',
          'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
          'text-wrap': 'wrap', 'text-max-width': '100px',
          'text-justification': 'center',
          'line-height': 1.2,
          'background-color': '#4a6fa5', 'background-opacity': 0.92,
          'color': 'transparent', 'text-color': 'transparent',
          'text-opacity': 0, 'font-size': '0px',
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
      ],
    })

    return instance
  }

  function initCy() {
    if (!containerRef.value) return
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath || '__root__'
    const key = _roomKey(dirPath)

    if (cyManager.has(key)) {
      const ctx = cyManager.activate(key, containerRef.value)
      cy.value = ctx?.cy || null
      if (ctx) {
        _setupHtmlLabels(ctx.cy, true)
        _bindCyEvents(ctx.cy)
        _detachAllDomBindingsExcept(null)
        _bindDOMEvents(ctx.cy)
        cyManager.markEventsBound(key, true)
      }
      _grid?.bindCyEvents?.()
      ctx?.cy?.resize?.()
      _grid?.drawGrid?.()
      return
    }

    const instance = _createCyInstance(containerRef.value)
    cyManager.create(key, instance)
    const ctx = cyManager.activate(key, containerRef.value)
    cy.value = instance
    _setupHtmlLabels(instance)
    _bindCyEvents(instance)
    _bindDOMEvents(instance)
    if (ctx) cyManager.markEventsBound(key, true)
  }

  // ─── 加载房间 ────────────────────────────────────────────────
  async function loadRoom(dirPath) {
    if (!containerRef.value) return

    const key = _roomKey(dirPath)
    if (cyManager.has(key)) {
      const ctx = cyManager.activate(key, containerRef.value)
      if (ctx?.loaded) {
        cy.value = ctx.cy || null
        _detachAllDomBindingsExcept(null)
        _setupHtmlLabels(ctx.cy, true)
        _bindCyEvents(ctx.cy)
        _bindDOMEvents(ctx.cy)
        cyManager.markEventsBound(key, true)
        _grid?.bindCyEvents?.()
        ctx?.cy?.resize?.()
        _grid?.drawGrid()
        _restoreSelectedNode()
        return
      }
      // 存在但未加载完成，删除重建避免空实例被复用
      try { ctx?.cy?.destroy?.() } catch (e) {}
    }

    try {
      const instance = _createCyInstance(containerRef.value)
      cyManager.create(key, instance)
      const ctx = cyManager.activate(key, containerRef.value)
      cy.value = instance
      _setupHtmlLabels(instance)
      _bindCyEvents(instance)
      _bindDOMEvents(instance)
      if (ctx) cyManager.markEventsBound(key, true)
      _detachAllDomBindingsExcept(instance)
      const [cardsRaw, metaRaw] = await Promise.all([
        storage.listCards(dirPath).catch((e) => {
          console.error('[useGraph] listCards 失败:', dirPath, e)
          return []
        }),
        storage.readLayout(dirPath).catch((e) => {
          console.error('[useGraph] readLayout 失败:', dirPath, e)
          return {}
        }),
      ])
      const meta = normalizeMeta(metaRaw)
      const cards = Array.isArray(cardsRaw)
        ? cardsRaw.filter((card) => card && typeof card === 'object' && card.path)
        : []
      const children = meta.children
      const edges = meta.edges

      // 恢复画布边界（仅使用 meta，保证跨房间/跨知识库绝对隔离）
      if (meta.canvasBounds) {
        _grid?.setCanvasBounds(meta.canvasBounds)
      } else {
        _grid?.setCanvasBounds({ x: -750, y: -500, w: 1500, h: 1000 })
      }

      // 清空图谱
      cy.value.elements().remove()

      // 缓存路径名称
      cards.forEach((card) => {
        const safeName = (typeof card.name === 'string' && card.name.trim())
          ? card.name
          : (card.path.split('/').pop() || card.path)
        roomStore.setPathName(card.path, safeName)
      })
      if (dirPath && meta.name) {
        roomStore.setPathName(dirPath, meta.name)
      }

      // 添加节点
      cards.forEach((card) => {
        const legacyKey = (typeof card.name === 'string' && card.name.trim()) ? card.name : null
        const saved = children[card.path] || (legacyKey ? children[legacyKey] : null) || {}
        const displayName = (typeof saved.name === 'string' && saved.name.trim())
          ? saved.name
          : ((typeof card.name === 'string' && card.name.trim()) ? card.name : (card.path.split('/').pop() || '未命名卡片'))

        const data = {
          id: card.path,
          label: displayName,
          cardPath: card.path,
          color: saved.color || '',
          fontColor: saved.fontColor || '',
          fontSize: saved.fontSize || 0,
          fontStyle: saved.fontStyle || '',
          textAlign: saved.textAlign || '',
          textWrap: saved.textWrap !== undefined ? saved.textWrap : true,
          nodeWidth: saved.nodeWidth || '',
          nodeHeight: saved.nodeHeight || '',
          borderColor: saved.borderColor || '',
          borderWidth: saved.borderWidth || 0,
          nodeShape: saved.nodeShape || '',
          shadowOpacity: 0,
          nodeOpacity: saved.nodeOpacity != null ? saved.nodeOpacity : 1,
        }
        const ele = cy.value.add({ group: 'nodes', data, classes: 'card' })
        _applyNodeStyle(ele, data, saved)
      })

      // 添加边
      edges.forEach((e) => {
        if (!e) return
        const source = e.source || e.from
        const target = e.target || e.to
        if (!source || !target) return
        if (cy.value.getElementById(source).length && cy.value.getElementById(target).length) {
          cy.value.add({ group: 'edges', data: {
            id: e.id || _autoEdgeId(),
            source,
            target,
            relation: e.relation || '相关',
            weight: e.weight || 'minor',
          }})
        }
      })

    // 判断是否需要自动布局（基于保存数据，而不是当前渲染结果）
    const hasSavedPositions = cards.some((card) => {
      const saved = children[card.path] || children[card.name] || {}
      return Number.isFinite(saved.posX) && Number.isFinite(saved.posY)
    })
    const hasSavedViewport = Number.isFinite(meta.zoom) && !!meta.pan
    const targetViewport = hasSavedViewport ? { zoom: meta.zoom, pan: meta.pan } : null

    const keepZoom = cy.value.zoom()

    if (!hasSavedPositions && cards.length > 0) {
      cy.value.nodes().layout({
        name: 'elk',
        elk: {
          algorithm: 'layered', 'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': 60,
          'elk.layered.spacing.nodeNodeBetweenLayers': 80,
          'elk.padding': '[top=40,left=30,bottom=30,right=30]',
        },
        fit: false, animate: false,
        stop: () => {
          if (targetViewport) {
            cy.value.zoom(targetViewport.zoom)
            cy.value.pan(targetViewport.pan)
          } else {
            cy.value.zoom(keepZoom)
            cy.value.center()
          }
          _grid?.drawGrid()
        },
      }).run()
    } else if (targetViewport) {
      cy.value.zoom(targetViewport.zoom)
      cy.value.pan(targetViewport.pan)
      _grid?.drawGrid()
    } else if (cy.value.nodes().length > 0) {
      cy.value.zoom(keepZoom)
      cy.value.center()
      _grid?.drawGrid()
    }

      // 异步加载节点徽标数据
      _loadNodeBadges(cards)
      cyManager.markLoaded(key, true)

      // 从 localStorage 恢复选中的节点（仅当节点在当前房间中存在）
      _restoreSelectedNode()
    } catch (e) {
      console.error('[useGraph] loadRoom 失败:', dirPath, e)
      throw e
    }
  }

  function _restoreSelectedNode() {
    const savedNodeId = appStore.selectedNodeId
    if (!savedNodeId || !cy.value) return
    const node = cy.value.getElementById(savedNodeId)
    if (node.length) {
      // 确保视觉高亮选中状态
      node.select()
    }
  }

  function _applyNodeStyle(ele, data, saved) {
    if (data.color) ele.style('background-color', data.color)
    if (data.fontColor) ele.style('color', data.fontColor)
    if (data.fontSize) ele.style('font-size', data.fontSize + 'px')
    if (data.fontStyle) {
      const styles = data.fontStyle.split(' ')
      if (styles.includes('bold')) ele.style('font-weight', 'bold')
      if (styles.includes('italic')) ele.style('font-style', 'italic')
    }
    if (data.textAlign) ele.style('text-halign', data.textAlign)
    if (!data.textWrap) ele.style('text-wrap', 'none')
    if (data.nodeWidth) {
      ele.style('width', data.nodeWidth + 'px')
      ele.style('text-max-width', data.nodeWidth + 'px')
    }
    if (data.nodeHeight) ele.style('height', data.nodeHeight + 'px')
    if (data.borderColor && data.borderWidth) {
      ele.style('border-color', data.borderColor)
      ele.style('border-width', data.borderWidth + 'px')
    }
    if (data.nodeShape) ele.style('shape', data.nodeShape)

    // 当前 Cytoscape 版本不支持 shadow-* 样式属性，跳过运行时阴影写入

    if (data.nodeOpacity != null && data.nodeOpacity !== 1) {
      ele.style('opacity', data.nodeOpacity)
    }
    if (saved.posX !== undefined && saved.posY !== undefined) {
      ele.position({ x: saved.posX, y: saved.posY })
    }
  }

  async function _loadNodeBadges(cards) {
    if (!cy.value) return

    const nodeIds = cy.value.nodes().map(n => n.id())
    await Promise.all(nodeIds.map(async (id) => {
      const [children, md] = await Promise.all([
        storage.listCards(id).catch((e) => { console.warn('[useGraph] listCards 失败:', id, e); return [] }),
        storage.readMarkdown(id).catch((e) => { console.warn('[useGraph] readMarkdown 失败:', id, e); return '' }),
      ])
      const node = cy.value?.getElementById(id)
      if (!node?.length) return

      const childCount = children.length
      const hasDoc = !!(md && md.trim().length > 0)

      node.data('childCount', childCount)
      node.data('hasDoc', hasDoc)
    }))
  }

  // ─── 布局保存 ────────────────────────────────────────────────
  async function buildCurrentMetaFor(dirPath) {
    if (!cy.value || !dirPath) return null

    const children = {}
    cy.value.nodes().forEach(n => {
      const d = n.data()
      const pos = n.position()
      children[d.cardPath || d.id] = {
        name: d.label,
        color: d.color || undefined,
        fontColor: d.fontColor || undefined,
        fontSize: d.fontSize || undefined,
        fontStyle: d.fontStyle || undefined,
        textAlign: d.textAlign || undefined,
        textWrap: d.textWrap !== false ? undefined : false,
        nodeWidth: d.nodeWidth || undefined,
        nodeHeight: d.nodeHeight || undefined,
        borderColor: d.borderColor || undefined,
        borderWidth: d.borderWidth || undefined,
        nodeShape: d.nodeShape || undefined,
        // 已下线阴影运行时能力，保留字段兼容旧数据但不再保存
        shadowOpacity: undefined,
        nodeOpacity: d.nodeOpacity !== 1 ? d.nodeOpacity : undefined,
        posX: pos.x,
        posY: pos.y,
      }
    })

    const edges = cy.value.edges().map(e => ({
      id: e.id(),
      source: e.data('source'),
      target: e.data('target'),
      relation: e.data('relation'),
      weight: e.data('weight'),
    }))

    const rawMeta = await storage.readLayout(dirPath).catch(() => ({}))
    const existingMeta = normalizeMeta(rawMeta)
    const viewport = { zoom: cy.value.zoom(), pan: cy.value.pan() }

    return {
      ...existingMeta,
      children,
      edges,
      zoom: viewport.zoom,
      pan: viewport.pan,
      canvasBounds: _grid?.getCanvasBounds(),
    }
  }

  async function saveCurrentLayout(targetDirPath = null) {
    const dirPath = targetDirPath || roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return
    const meta = await buildCurrentMetaFor(dirPath)
    if (!meta) return
    await storage.flushGraphSave(dirPath, () => meta)
    if (roomStore.currentKBPath) {
      GitCache.markDirty(roomStore.currentKBPath)
    }
  }

  async function saveCurrentLayoutDebounced() {
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return

    // 关键：在调度时就冻结快照，避免切房间后把新房间布局误写回旧房间
    const metaSnapshot = await buildCurrentMetaFor(dirPath)
    if (!metaSnapshot) return
    storage.saveGraphDebounced(dirPath, () => metaSnapshot)
  }


  // ─── 钻入/返回 ──────────────────────────────────────────────
  async function drillInto(cardPath) {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    await saveCurrentLayout(prevPath)
    const kids = await storage.listCards(cardPath)
    if (kids.length === 0) {
      // 叶子卡片，显示详情
      const node = cy.value.getElementById(cardPath)
      if (node.length) {
        cy.value.nodes(':selected').unselect()
        node.select()
      }
      return
    }
    roomStore.drillInto(cardPath)
  }

  async function goBack() {
    if (roomStore.roomHistory.length === 0) {
      appStore.showHome()
      return
    }
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    await saveCurrentLayout(prevPath)
    roomStore.goBack()
  }

  async function goRoot() {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    await saveCurrentLayout(prevPath)
    roomStore.jumpTo(roomStore.currentKBPath)
  }

  async function jumpToBreadcrumb(path) {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    await saveCurrentLayout(prevPath)
    roomStore.jumpTo(path)
  }

  // ─── 节点/边 CRUD ────────────────────────────────────────────
  async function addCard(name, pos) {
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return
    const cardPath = await storage.createCard(dirPath, name)
    const node = cy.value.add({
      group: 'nodes',
      data: { id: cardPath, label: name, cardPath },
      classes: 'card',
      position: pos || { x: 0, y: 0 },
    })
    if (!pos) cy.value.center(node)
    saveCurrentLayoutDebounced()
    return cardPath
  }

  async function addChildCard(parentPath, name) {
    const cardPath = await storage.createCard(parentPath, name)
    // 驱逐当前房间缓存，强制 loadRoom 重新获取最新数据
    const key = _roomKey(parentPath)
    cyManager.remove(key)
    await loadRoom(parentPath)
    return cardPath
  }

  async function deleteCard(cardPath) {
    await storage.deleteCard(cardPath)
    const node = cy.value.getElementById(cardPath)
    if (node.length) {
      cy.value.remove(node.connectedEdges())
      cy.value.remove(node)
      appStore.clearSelection()
    }
    saveCurrentLayoutDebounced()
  }

  async function renameCard(cardPath, newName) {
    const actualPath = await storage.renameCard(cardPath, newName)
    const node = cy.value.getElementById(cardPath)
    if (node.length) {
      node.data('label', newName)
      // 如果 mkDir 脱敏/去重导致路径变化，同步更新 graph node ID 和 pathNameMap
      if (actualPath && actualPath !== cardPath) {
        node.id(actualPath)
        // pathNameMap 映射 path → display name，需同步更新
        const oldName = roomStore.pathNameMap[cardPath]
        if (oldName !== undefined) {
          roomStore.setPathName(actualPath, newName)
          delete roomStore.pathNameMap[cardPath]
        }
      }
    }
    saveCurrentLayoutDebounced()
  }

  function addEdge(sourceId, targetId, relation) {
    cy.value.add({
      group: 'edges',
      data: {
        id: _autoEdgeId(),
        source: sourceId,
        target: targetId,
        relation,
        weight: relation === '相关' ? 'minor' : 'main',
      },
    })
    saveCurrentLayoutDebounced()
  }

  function deleteEdge(edgeId) {
    const edge = cy.value.getElementById(edgeId)
    if (edge.length) cy.value.remove(edge)
    saveCurrentLayoutDebounced()
  }

  async function batchDelete(nodeIds) {
    for (const id of nodeIds) {
      try {
        await storage.deleteCard(id)
      } catch (err) {
        console.error(`[useGraph] 删除节点失败: ${id}`, err)
      }
    }
    const selected = cy.value.nodes(':selected')
    selected.connectedEdges().remove()
    selected.remove()
    appStore.clearSelection()
    saveCurrentLayoutDebounced()
  }

  // ─── 搜索 ────────────────────────────────────────────────────
  function applySearch(q) {
    if (!cy.value) return
    cy.value.nodes().removeClass('search-match')
    if (!q) return
    const lower = q.toLowerCase()
    cy.value.nodes().forEach(n => {
      if ((n.data('label') || '').toLowerCase().includes(lower)) {
        n.addClass('search-match')
      }
    })
  }

  // ─── 缩放 ────────────────────────────────────────────────────
  function zoomIn() { cy.value?.animate({ zoom: cy.value.zoom() * 1.3 }, { duration: 200 }) }
  function zoomOut() { cy.value?.animate({ zoom: cy.value.zoom() / 1.3 }, { duration: 200 }) }
  function fitView() { cy.value?.animate({ fit: { padding: 50 } }, { duration: 300 }) }
  function resetZoom() { cy.value?.zoom(1); cy.value?.center() }

  // ─── 事件绑定 ────────────────────────────────────────────────
  function _bindCyEvents(targetCy = null) {
    const c = targetCy || cy.value
    if (!c || _cyEventsBound.has(c)) return

    const syncSelectionToStore = () => {
      const selected = c.nodes(':selected')
      if (selected.length > 0) {
        appStore.selectNode(selected[0].id())
      } else {
        appStore.clearSelection()
      }
      _updateNodeHandles(c)
    }

    // 节点释放后兜底选中：避免 tap 被轻微拖动吞掉、并防止释放时被取消
    c.on('mouseup', 'node', (e) => {
      if (_dragConnectState?.active) return
      if (appStore.edgeMode) return

      const oe = e.originalEvent || {}
      if (oe.button === 2) return

      const node = e.target
      const keepMulti = !!(oe.ctrlKey || oe.shiftKey || oe.metaKey)

      requestAnimationFrame(() => {
        if (!keepMulti) {
          c.nodes(':selected').unselect()
        }
        node.select()
        syncSelectionToStore()
      })
    })

    // 节点单击：连线模式下确认目标
    c.on('tap', 'node', async (e) => {
      if (_dragConnectState?.active) return
      if (!appStore.edgeMode || !appStore.edgeModeSourceId) return

      const t = e.target
      if (t.id() === appStore.edgeModeSourceId) return
      const srcId = appStore.edgeModeSourceId
      appStore.exitEdgeMode()
      const relation = await modalStore.showInput('关系类型', '演进 / 依赖 / 相关', '依赖')
      if (relation) addEdge(srcId, t.id(), relation)
    })

    // 双击钻入
    c.on('dbltap', 'node', (e) => { drillInto(e.target.id()) })


    // 节点右键菜单（单选）
    c.on('cxttap', 'node', (e) => {
      if (_rightDragMoved) return
      const selected = c.nodes(':selected')
      if (selected.length > 1) {
        contextMenu.value = { type: 'batch', x: e.originalEvent.clientX, y: e.originalEvent.clientY }
      } else {
        contextMenu.value = { type: 'node', x: e.originalEvent.clientX, y: e.originalEvent.clientY, nodeId: e.target.id() }
      }
    })

    // 边右键菜单
    c.on('cxttap', 'edge', (e) => {
      if (_rightDragMoved) return
      contextMenu.value = { type: 'edge', x: e.originalEvent.clientX, y: e.originalEvent.clientY, edgeId: e.target.id() }
    })

    // 背景右键菜单
    c.on('cxttap', (e) => {
      if (_rightDragMoved) return
      if (e.target === c) {
        contextMenu.value = { type: 'bg', x: e.originalEvent.clientX, y: e.originalEvent.clientY, bgPos: e.position }
      }
    })

    // 悬停高亮
    c.on('mouseover', 'node', (e) => { e.target.addClass('highlighted') })
    c.on('mouseout', 'node', (e) => { e.target.removeClass('highlighted') })

    // 拖拽完成保存
    c.on('free', 'node', () => { saveCurrentLayoutDebounced(); _updateNodeHandles(c) })

    // 框选/多选变化同步
    c.on('select unselect', 'node', () => { syncSelectionToStore() })


    // 缩放联动
    c.on('zoom', () => {
      zoomLevel.value = Math.round(c.zoom() * 100)
      _applyZoomDisplay(c.zoom())
      _updateNodeHandles(c)
      // 多实例模式下，视口以当前房间 meta 为准，不写会话共享缓存
    })

    // 画布平移时记录当前房间状态（严格绑定 activeRoomPath）
    c.on('pan', () => {
      _updateNodeHandles(c)
      // 多实例模式下，视口以当前房间 meta 为准，不写会话共享缓存
    })

    _cyEventsBound.add(c)
  }

  function _bindDOMEvents(targetCy = null) {
    const c = targetCy || cy.value
    if (!c) return
    if (_domCleanupByCy.has(c)) return

    const container = c.container()

    const resizeHandleEl = document.createElement('div')
    resizeHandleEl.className = 'node-resize-handle'
    container.parentElement?.appendChild(resizeHandleEl)

    const connectHandleEl = document.createElement('div')
    connectHandleEl.className = 'edge-handle'
    container.parentElement?.appendChild(connectHandleEl)

    const previewLineEl = document.createElement('div')
    previewLineEl.className = 'connect-preview-line'
    previewLineEl.style.display = 'none'
    container.parentElement?.appendChild(previewLineEl)

    _attachHandleElements(c, { resizeHandleEl, connectHandleEl, previewLineEl })

    // 右键拖拽画布（实例级隔离，避免父子/跨库互相影响）
    let localPanning = false
    let localPanStart = { x: 0, y: 0 }
    let localPanOrigin = { x: 0, y: 0 }

    const onMousedown = (e) => {
      if (e.button === 2) {
        localPanning = true
        _rightDragMoved = false
        localPanStart = { x: e.clientX, y: e.clientY }
        localPanOrigin = { x: c.pan().x, y: c.pan().y }
        container.style.cursor = 'grabbing'
        e.preventDefault()
      }
    }
    const onMousemove = (e) => {
      if (_dragResizeState?.active) {
        const node = c.getElementById(_dragResizeState.nodeId)
        if (node?.length) {
          const dx = e.clientX - _dragResizeState.startX
          const dy = e.clientY - _dragResizeState.startY
          const nextW = Math.max(40, Math.min(1200, Math.round(_dragResizeState.startW + dx / Math.max(c.zoom(), 0.2))))
          const nextH = Math.max(30, Math.min(1200, Math.round(_dragResizeState.startH + dy / Math.max(c.zoom(), 0.2))))
          node.data('nodeWidth', nextW)
          node.data('nodeHeight', nextH)
          node.style('width', `${nextW}px`)
          node.style('height', `${nextH}px`)
          node.style('text-max-width', `${nextW}px`)
          _updateNodeHandles(c)
        }
        return
      }

      if (_dragConnectState?.active) {
        const src = c.getElementById(_dragConnectState.sourceId)
        const els = _handleElsByCy.get(c)
        if (src?.length && els?.previewLineEl) {
          const s = src.renderedPosition()
          const rect = container.getBoundingClientRect()
          const tx = e.clientX - rect.left
          const ty = e.clientY - rect.top
          const dx = tx - s.x
          const dy = ty - s.y
          const len = Math.sqrt(dx * dx + dy * dy)
          const angle = Math.atan2(dy, dx) * 180 / Math.PI
          const line = els.previewLineEl
          line.style.left = `${s.x}px`
          line.style.top = `${s.y}px`
          line.style.width = `${len}px`
          line.style.transform = `rotate(${angle}deg)`
        }
        return
      }

      if (!localPanning) return
      const dx = e.clientX - localPanStart.x
      const dy = e.clientY - localPanStart.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _rightDragMoved = true
      c.pan({ x: localPanOrigin.x + dx, y: localPanOrigin.y + dy })
      // 兜底：首次进入房间时若 grid 的 pan 监听尚未就绪，仍确保画布跟随
      _grid?.drawGrid?.()
    }
    const onMouseup = async (e) => {
      if (_dragResizeState?.active) {
        _dragResizeState = null
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        saveCurrentLayoutDebounced()
        return
      }

      if (_dragConnectState?.active) {
        const sourceId = _dragConnectState.sourceId
        const target = _hitNodeByClientPoint(c, e.clientX, e.clientY)
        const els = _handleElsByCy.get(c)
        if (els?.previewLineEl) els.previewLineEl.style.display = 'none'

        _dragConnectState = null
        document.body.style.userSelect = ''
        document.body.style.cursor = ''

        if (target && target.id() !== sourceId) {
          const relation = await modalStore.showInput('关系类型', '演进 / 依赖 / 相关', '依赖')
          if (relation) addEdge(sourceId, target.id(), relation)
        }
        return
      }

      if (e.button === 2 && localPanning) {
        localPanning = false
        container.style.cursor = ''
      }
    }
    // 保存 contextmenu 拦截引用以便清理
    const onContextmenu = (e) => e.preventDefault()
    container.addEventListener('contextmenu', onContextmenu)
    container.addEventListener('mousedown', onMousedown)
    document.addEventListener('mousemove', onMousemove)
    document.addEventListener('mouseup', onMouseup)

    // 滚轮缩放
    const onWheel = (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      let newZoom = c.zoom() * factor
      newZoom = Math.max(c.minZoom(), Math.min(c.maxZoom(), newZoom))
      const rect = container.getBoundingClientRect()
      c.zoom({ level: newZoom, renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } })
    }
    container.addEventListener('wheel', onWheel, { passive: false })

    // 保存 cleanup 函数（按 cy 实例隔离）
    _domCleanupByCy.set(c, () => {
      container.removeEventListener('contextmenu', onContextmenu)
      container.removeEventListener('mousedown', onMousedown)
      document.removeEventListener('mousemove', onMousemove)
      document.removeEventListener('mouseup', onMouseup)
      container.removeEventListener('wheel', onWheel)
      resizeHandleEl.remove()
      connectHandleEl.remove()
      previewLineEl.remove()
      _detachHandleElements(c)
    })
  }

  function _attachHandleElements(c, els) {
    _handleElsByCy.set(c, els)
    _updateNodeHandles(c)

    const { resizeHandleEl, connectHandleEl, previewLineEl } = els

    resizeHandleEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const selected = c.nodes(':selected')
      const node = selected.length ? selected[0] : null
      if (!node) return

      const startW = Number(node.data('nodeWidth')) || node.renderedWidth()
      const startH = Number(node.data('nodeHeight')) || node.renderedHeight()

      _dragResizeState = { active: true, nodeId: node.id(), startX: e.clientX, startY: e.clientY, startW, startH }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'nwse-resize'
    })

    connectHandleEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const selected = c.nodes(':selected')
      const node = selected.length ? selected[0] : null
      if (!node) return

      const p = node.renderedPosition()
      _dragConnectState = { active: true, sourceId: node.id() }
      previewLineEl.style.display = 'block'
      previewLineEl.style.left = `${p.x}px`
      previewLineEl.style.top = `${p.y}px`
      previewLineEl.style.width = '0px'
      previewLineEl.style.transform = 'rotate(0deg)'
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'crosshair'
    })
  }

  function _detachHandleElements(c) {
    _handleElsByCy.delete(c)
  }

  function _updateNodeHandles(c = cy.value) {
    if (!c) return
    const els = _handleElsByCy.get(c)
    if (!els) return

    const { resizeHandleEl, connectHandleEl } = els
    const selected = c.nodes(':selected')
    if (selected.length !== 1) {
      resizeHandleEl.classList.remove('active')
      connectHandleEl.classList.remove('active')
      return
    }

    const node = selected[0]
    const p = node.renderedPosition()
    const w = node.renderedWidth()
    const h = node.renderedHeight()

    resizeHandleEl.classList.add('active')
    connectHandleEl.classList.add('active')

    resizeHandleEl.style.left = `${p.x + w / 2 - 6}px`
    resizeHandleEl.style.top = `${p.y + h / 2 - 6}px`

    connectHandleEl.style.left = `${p.x + w / 2 + 8}px`
    connectHandleEl.style.top = `${p.y - 6}px`
  }

  function _hitNodeByClientPoint(c, clientX, clientY) {
    const container = c.container()
    if (!container) return null

    const rect = container.getBoundingClientRect()
    const rx = clientX - rect.left
    const ry = clientY - rect.top

    const nodes = c.nodes()
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i]
      const bb = n.renderedBoundingBox()
      if (rx >= bb.x1 && rx <= bb.x2 && ry >= bb.y1 && ry <= bb.y2) {
        return n
      }
    }
    return null
  }

  function _applyZoomDisplay(zoom) {
    if (!cy.value) return
    if (zoom < 0.6) {
      cy.value.edges('[weight="main"]').style('label', '')
      cy.value.edges('[weight="minor"]').style('display', 'none')
    } else if (zoom < 0.8) {
      cy.value.edges('[weight="main"]').style('label', e => e.data('relation') || '')
      cy.value.edges('[weight="minor"]').style('display', 'none')
    } else {
      cy.value.edges('[weight="main"]').style('label', e => e.data('relation') || '')
      cy.value.edges('[weight="minor"]').style('display', 'element')
    }
  }

  // ─── 键盘事件（由 GraphView 组件调用） ──────────────────────
  async function handleKeydown(e) {
    // 已移除全局键盘快捷键，避免干扰文本输入
  }

  // ─── 节点样式更新（供 StylePanel 调用） ─────────────────────
  // ─── 强制刷新 HTML 标签（style 变更后调用）─────
  // cytoscape-node-html-label 插件通过 'data'/'style' 事件更新标签，
  // 但由于 _setupHtmlLabels 可能被多次调用产生多套事件处理器，
  // 故在样式变更后显式触发 'data' 事件确保标签刷新。
  function _refreshHtmlLabels(targetNodes) {
    if (!cy.value) return
    const nodes = targetNodes || cy.value.nodes()
    console.log('[_refreshHtmlLabels] 刷新 ' + nodes.length + ' 个节点')
    nodes.forEach((n) => {
      if (n.isNode() && n.hasClass('card')) {
        try { n.emit('data') } catch (e) {}
      }
    })
  }

  function updateNodeStyle(nodeId, styles) {
    if (!cy.value) return

    const selected = cy.value.nodes(':selected')
    const fallback = nodeId ? cy.value.getElementById(nodeId) : cy.value.collection()
    const targets = selected.length > 1 ? selected : fallback
    if (!targets.length) return

    console.log('[updateNodeStyle] nodeId=' + nodeId + ' styles=', styles)
    targets.forEach((node) => {
      Object.entries(styles).forEach(([key, value]) => {
        console.log('[updateNodeStyle] setting node=' + node.id() + ' key=' + key + ' value=' + value)
        node.data(key, value)
        // 映射到 Cytoscape 样式
        const styleMap = {
          color: () => node.style('background-color', value),
          fontColor: () => node.style('color', value),
          fontSize: () => node.style('font-size', value + 'px'),
          textAlign: () => node.style('text-halign', value),
          nodeWidth: () => { node.style('width', value ? value + 'px' : 'auto'); node.style('text-max-width', value ? value + 'px' : '100px') },
          nodeHeight: () => node.style('height', value ? value + 'px' : 'auto'),
          borderColor: () => node.style('border-color', value),
          borderWidth: () => node.style('border-width', value + 'px'),
          nodeShape: () => node.style('shape', value),
          shadowOpacity: () => {
            // 当前 Cytoscape 版本不支持 shadow-*，仅保留 data 值用于兼容历史数据
          },
          nodeOpacity: () => node.style('opacity', value),
        }
        styleMap[key]?.()
      })
    })

    // 强制刷新 HTML 标签
    _refreshHtmlLabels(targets)

    saveCurrentLayoutDebounced()
  }

  function updateNodeFontStyle(nodeId, style, active) {
    if (!cy.value) return

    const selected = cy.value.nodes(':selected')
    const fallback = nodeId ? cy.value.getElementById(nodeId) : cy.value.collection()
    const targets = selected.length > 1 ? selected : fallback
    if (!targets.length) return

    targets.forEach((node) => {
      let current = (node.data('fontStyle') || '').split(' ').filter(Boolean)
      if (active) { if (!current.includes(style)) current.push(style) }
      else current = current.filter(s => s !== style)
      const fontStyle = current.join(' ')
      node.data('fontStyle', fontStyle)
      node.style('font-weight', current.includes('bold') ? 'bold' : 'normal')
      node.style('font-style', current.includes('italic') ? 'italic' : 'normal')
    })

    // 强制刷新 HTML 标签
    _refreshHtmlLabels(targets)

    saveCurrentLayoutDebounced()
  }

  // 批量改色
  function batchSetColor(color) {
    if (!cy.value) return
    cy.value.nodes(':selected').forEach(node => {
      node.data('color', color)
      node.style('background-color', color)
    })
    saveCurrentLayoutDebounced()
  }

  // 导出为 PNG
  function exportPNG() {
    if (!cy.value) return
    const png = cy.value.png({ scale: 2, full: true, bg: '#f8f9fb' })
    const a = document.createElement('a')
    a.href = png
    a.download = 'topomind-export.png'
    a.click()
  }

  // ─── 清理 ────────────────────────────────────────────────────

  // 监听 App 触发的“退出前保存”请求
  watch(
    () => roomStore._saveRequestTs,
    async (ts) => {
      if (!ts) return
      await saveCurrentLayout()
    }
  )

  onUnmounted(() => {
    _detachAllDomBindingsExcept(null)
    cyManager.clear()
    cy.value = null
  })

  // ─── 工具 ────────────────────────────────────────────────────
  let _edgeCounter = 0
  function _autoEdgeId() {
    // 数值达到上限时重置（防溢出）
    if (_edgeCounter > 9999) _edgeCounter = 0
    return `e-${Date.now()}-${_edgeCounter++}`
  }

  // 注入外部 composable
  function setGrid(g) { _grid = g }

  return {
    cy,
    contextMenu,
    zoomLevel,
    searchQuery,
    initCy,
    loadRoom,
    buildCurrentMeta: () => buildCurrentMetaFor(roomStore.currentRoomPath || roomStore.currentKBPath),
    saveCurrentLayout,
    drillInto,
    goBack,
    goRoot,
    jumpToBreadcrumb,
    addCard,
    addChildCard,
    deleteCard,
    renameCard,
    addEdge,
    deleteEdge,
    batchDelete,
    batchSetColor,
    updateNodeStyle,
    updateNodeFontStyle,
    applySearch,
    zoomIn,
    zoomOut,
    fitView,
    resetZoom,
    exportPNG,
    handleKeydown,
    setGrid,
  }
}
