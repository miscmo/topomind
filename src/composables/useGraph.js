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
import { logger } from '@/core/logger.js'
import { GraphConstants } from '@/core/graph-constants.js'
import { cloneGraphStyle } from '@/core/graph-style.js'
import { getNodeHtmlLabelConfig } from '@/core/graph-labels.js'
import { useGraphDOM } from '@/composables/useGraphDOM.js'

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
  // 右键拖拽状态（ref 传给 useGraphDOM）
  const rightDragMoved = ref(false)
  // 右键菜单目标（传给 ContextMenu 组件）
  const contextMenu = ref({ type: null, x: 0, y: 0, nodeId: null, bgPos: null })
  // 当前缩放值（用于显示）
  const zoomLevel = ref(100)
  // 搜索关键词
  const searchQuery = ref('')
  // 当前房间的 meta 数据（用于保存时复用，避免重复读取存储）
  const currentMeta = ref(null)
  const cyManager = createCyManager(GraphConstants.CY_INSTANCE_POOL_SIZE)
  const _cyEventsBound = new WeakSet()
  // 拖拽状态（ref 传给 useGraphDOM）
  const dragResizeState = ref(null)
  const dragConnectState = ref(null)
  let _loadRoomSeq = 0

  // DOM 事件管理器（已提取至 useGraphDOM.js）
  const dom = useGraphDOM({
    cyRef: cy,
    gridRef: { get value() { return _grid } },
    dragResizeRef: dragResizeState,
    dragConnectRef: dragConnectState,
    rightDragMovedRef: rightDragMoved,
    saveLayout: () => saveCurrentLayout(),
    addEdge,
    modalInput: (title, placeholder, defaultVal) => modalStore.showInput(title, placeholder, defaultVal),
  })

  function _roomKey(dirPath) {
    const kb = roomStore.currentKBPath || ''
    return `${kb}::${dirPath || ''}`
  }

  // ─── 节点 HTML 标签生成器（已提取至 @/core/graph-labels.js）─────────────────
  // 导入自 @/core/graph-labels.js

  // ─── 设置 HTML 标签（在 cy.mount() 之后调用）─────────────────────
  // 使用 cytoscape-node-html-label 插件渲染节点 HTML 标签
  // 注意：cytoscape-node-html-label 内部会清理旧容器，故可安全重复调用
  function _setupHtmlLabels(cyInst, forceInit = false) {
    if (!cyInst) return
    cyInst.nodeHtmlLabel(getNodeHtmlLabelConfig(), { enablePointerEvents: false })

    // 如果 graph 已经有节点了（从缓存激活的旧实例），
    // 'render' 事件已过，手动触发一次 label 创建
    if (forceInit || (cyInst.nodes && cyInst.nodes().length > 0)) {
      try {
        cyInst.emit('render')
      } catch (e) {
        logger.catch('useGraph', 'emit render')
      }
    }
  }

  // ─── 初始化 Cytoscape ────────────────────────────────────────
  function _createCyInstance(container = null) {
    const instance = cytoscape({
      container: container || containerRef.value || undefined,
      elements: [],
      minZoom: GraphConstants.ZOOM_MIN, maxZoom: GraphConstants.ZOOM_MAX,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: true,
      selectionType: 'additive',
      style: cloneGraphStyle(),
    })

    return instance
  }

  function initCy() {
    if (!containerRef.value) return
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath || '__root__'
    const key = _roomKey(dirPath)

    if (cyManager.has(key)) {
      cyManager.remove(key)
    }

    const instance = _createCyInstance(containerRef.value)
    cyManager.create(key, instance)
    const ctx = cyManager.activate(key, containerRef.value)
    cy.value = instance
    _setupHtmlLabels(instance)
    _bindCyEvents(instance)
    dom.bindDOMEvents(instance)
    if (ctx) cyManager.markEventsBound(key, true)
    _grid?.bindCyEvents?.()
    ctx?.cy?.resize?.()
    _grid?.drawGrid?.()
  }

  // ─── 加载房间 ────────────────────────────────────────────────
  async function loadRoom(dirPath) {
    if (!containerRef.value) return

    const loadSeq = ++_loadRoomSeq
    const key = _roomKey(dirPath)
    if (cyManager.has(key)) {
      cyManager.remove(key)
    }

    // 惰性创建：如果房间目录不存在，先创建它和 _graph.json
    await storage.ensureCardDir(dirPath)

    try {
      const instance = _createCyInstance(containerRef.value)
      cyManager.create(key, instance)
      const ctx = cyManager.activate(key, containerRef.value)
      cy.value = instance
      const cyInst = instance
      _setupHtmlLabels(cyInst)
      _bindCyEvents(cyInst)
      dom.bindDOMEvents(cyInst)
      if (ctx) cyManager.markEventsBound(key, true)
      dom.cleanupDOMEventsExcept(cyInst)
      const [cardsRaw, metaRaw] = await Promise.all([
        storage.listCards(dirPath).catch((e) => {
          logger.catch('useGraph', 'listCards', e)
          return []
        }),
        storage.readLayout(dirPath).catch((e) => {
          logger.catch('useGraph', 'readLayout', e)
          return {}
        }),
      ])
      if (loadSeq !== _loadRoomSeq) return
      const meta = normalizeMeta(metaRaw)
      currentMeta.value = meta
      const cards = Array.isArray(cardsRaw)
        ? cardsRaw.filter((card) => card && typeof card === 'object' && card.path)
        : []
      const uniqueCards = []
      const seenCardPaths = new Set()
      for (const card of cards) {
        if (seenCardPaths.has(card.path)) continue
        seenCardPaths.add(card.path)
        uniqueCards.push(card)
      }
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
      cy.value.nodes().forEach((n) => n.removeStyle())
      cy.value.edges().forEach((e) => e.removeStyle())

      // 缓存路径名称
      uniqueCards.forEach((card) => {
        const safeName = (typeof card.name === 'string' && card.name.trim())
          ? card.name
          : (card.path.split('/').pop() || card.path)
        roomStore.setPathName(card.path, safeName)
      })
      if (dirPath && meta.name) {
        roomStore.setPathName(dirPath, meta.name)
      }

      // 添加节点
      uniqueCards.forEach((card) => {
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
          nodeOpacity: saved.nodeOpacity != null ? saved.nodeOpacity : 1,
        }
        const ele = cy.value.add({ group: 'nodes', data, classes: 'card' })
        _applyNodeStyle(ele, data, saved)
      })

      // 添加边
      const seenEdgeIds = new Set()
      edges.forEach((e) => {
        if (!e) return
        const source = e.source || e.from
        const target = e.target || e.to
        if (!source || !target) return
        const edgeId = e.id || _autoEdgeId()
        if (seenEdgeIds.has(edgeId)) return
        if (cy.value.getElementById(source).length && cy.value.getElementById(target).length) {
          seenEdgeIds.add(edgeId)
          cy.value.add({ group: 'edges', data: {
            id: edgeId,
            source,
            target,
            relation: e.relation || '相关',
            weight: e.weight || 'minor',
          }})
        }
      })

    // 判断是否需要自动布局（基于保存数据，而不是当前渲染结果）
    const hasSavedPositions = uniqueCards.some((card) => {
      const saved = children[card.path] || children[card.name] || {}
      return Number.isFinite(saved.posX) && Number.isFinite(saved.posY)
    })
    const hasSavedViewport = Number.isFinite(meta.zoom) && !!meta.pan
    const targetViewport = hasSavedViewport ? { zoom: meta.zoom, pan: meta.pan } : null

    const keepZoom = cy.value.zoom()

    if (loadSeq !== _loadRoomSeq) return
    if (!hasSavedPositions && cards.length > 0) {
      cy.value.nodes().layout({
        name: 'elk',
        elk: {
          algorithm: 'layered', 'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': 60,
          'elk.layered.spacing.nodeNodeBetweenLayers': 80,
          'elk.padding': `[top=${GraphConstants.ELK_PADDING_TOP},left=${GraphConstants.ELK_PADDING_SIDES},bottom=${GraphConstants.ELK_PADDING_SIDES},right=${GraphConstants.ELK_PADDING_SIDES}]`,
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
      logger.catch('useGraph', 'loadRoom', e)
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
    if (data.borderColor) ele.style('border-color', data.borderColor)
    if (data.borderWidth) ele.style('border-width', data.borderWidth + 'px')
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
        storage.listCards(id).catch((e) => { logger.catch('useGraph', 'listCards', e); return [] }),
        storage.readMarkdown(id).catch((e) => { logger.catch('useGraph', 'readMarkdown', e); return '' }),
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

    const viewport = { zoom: cy.value.zoom(), pan: cy.value.pan() }

    return {
      ...(currentMeta.value || {}),
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
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
    try {
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
    } catch (e) {
      logger.catch('useGraph', '加载子卡片', e)
    }
  }

  async function goBack() {
    if (roomStore.roomHistory.length === 0) {
      appStore.showHome()
      return
    }
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
    roomStore.goBack()
  }

  async function goRoot() {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
    roomStore.jumpTo(roomStore.currentKBPath)
  }

  async function jumpToBreadcrumb(path) {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
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
    // 同步保存：确保父级的 _graph.json 立即更新，持久化新卡片
    await saveCurrentLayout(dirPath)
    return cardPath
  }

  async function addChildCard(parentPath, name) {
    // 惰性创建：先确保父级目录存在，再创建子卡片
    await storage.ensureCardDir(parentPath)
    const cardPath = await storage.createCard(parentPath, name)
    // 立即添加到当前 Cytoscape 图谱中（同步保存后 loadRoom 会再次添加，需防重）
    const existing = cy.value.getElementById(cardPath)
    if (!existing.length) {
      cy.value.add({
        group: 'nodes',
        data: { id: cardPath, label: name, cardPath },
        classes: 'card',
        position: { x: 0, y: 0 },
      })
      cy.value.center()
    }
    // 同步保存：确保父级的 _graph.json 立即更新，持久化新卡片
    await saveCurrentLayout(parentPath)
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
    try {
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
    } catch (e) {
      logger.warn('useGraph', `添加边失败:`, sourceId, targetId, e)
    }
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
        logger.warn('useGraph', `删除节点失败: ${id}`, err)
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
  function fitView() { cy.value?.animate({ fit: { padding: GraphConstants.FIT_PADDING } }, { duration: GraphConstants.FIT_ANIMATION_DURATION_MS }) }
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
      dom.updateNodeHandles(c)
    }

    // 节点释放后兜底选中：避免 tap 被轻微拖动吞掉、并防止释放时被取消
    c.on('mouseup', 'node', (e) => {
      if (dragConnectState.value?.active) return
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
      if (dragConnectState.value?.active) return
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
      if (rightDragMoved.value) return
      const selected = c.nodes(':selected')
      if (selected.length > 1) {
        contextMenu.value = { type: 'batch', x: e.originalEvent.clientX, y: e.originalEvent.clientY }
      } else {
        contextMenu.value = { type: 'node', x: e.originalEvent.clientX, y: e.originalEvent.clientY, nodeId: e.target.id() }
      }
    })

    // 边右键菜单
    c.on('cxttap', 'edge', (e) => {
      if (rightDragMoved.value) return
      contextMenu.value = { type: 'edge', x: e.originalEvent.clientX, y: e.originalEvent.clientY, edgeId: e.target.id() }
    })

    // 背景右键菜单
    c.on('cxttap', (e) => {
      if (rightDragMoved.value) return
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
      dom.applyZoomDisplay(c.zoom())
      dom.updateNodeHandles(c)
      // 多实例模式下，视口以当前房间 meta 为准，不写会话共享缓存
    })

    // 画布平移时记录当前房间状态（严格绑定 activeRoomPath）
    c.on('pan', () => {
      dom.updateNodeHandles(c)
      // 多实例模式下，视口以当前房间 meta 为准，不写会话共享缓存
    })

    _cyEventsBound.add(c)
  }


  // ─── 键盘事件（由 GraphView 组件调用） ──────────────────────
  async function handleKeydown(e) {
    // 拦截 Delete/Backspace 键，避免在图谱空白区域按下时触发意外行为
    const key = e.key
    if (key === 'Delete' || key === 'Backspace') {
      const tag = document.activeElement?.tagName?.toLowerCase()
      const isEditable = document.activeElement?.isContentEditable
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || isEditable) return
      // 在图谱区域内按下删除/回退键时，仅阻止浏览器默认行为（避免页面导航）
      e.preventDefault()
      return
    }
  }

  // ─── 节点样式更新（供 StylePanel 调用） ─────────────────────
  // ─── 强制刷新 HTML 标签（style 变更后调用）─────
  // cytoscape-node-html-label 插件通过 'data'/'style' 事件更新标签，
  // 但由于 _setupHtmlLabels 可能被多次调用产生多套事件处理器，
  // 故在样式变更后显式触发 'data' 事件确保标签刷新。
  function _refreshHtmlLabels(targetNodes) {
    if (!cy.value) return
    const nodes = targetNodes || cy.value.nodes()
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

    targets.forEach((node) => {
      Object.entries(styles).forEach(([key, value]) => {
        node.data(key, value)
        // 映射到 Cytoscape 样式
        const styleMap = {
          color: () => node.style('background-color', value),
          fontColor: () => node.style('color', value),
          fontSize: () => node.style('font-size', value + 'px'),
          textAlign: () => node.style('text-halign', value),
          nodeWidth: () => { node.style('width', value ? value + 'px' : 'auto'); node.style('text-max-width', value ? value + 'px' : '100px') },
          nodeHeight: () => node.style('height', value ? value + 'px' : 'auto'),
          borderColor: () => {
            node.style('border-color', value)
            // Ensure border is visible when color changes (need width > 0)
            const bw = parseFloat(node.style('border-width')) || 0
            if (bw === 0) node.style('border-width', '1px')
          },
          borderWidth: () => {
            node.style('border-width', value + 'px')
            // Sync border color so width change is immediately visible
            const bc = node.data('borderColor')
            if (bc) node.style('border-color', bc)
          },
          nodeShape: () => node.style('shape', value),
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

  function refreshNodeBadge(nodeId) {
    if (!cy.value || !nodeId) return
    const node = cy.value.getElementById(nodeId)
    if (!node?.length) return
    storage.readMarkdown(nodeId).then(md => {
      if (!cy.value) return
      const n = cy.value.getElementById(nodeId)
      if (!n?.length) return
      n.data('hasDoc', !!(md && md.trim().length > 0))
      try { n.emit('data') } catch (e) {}
    }).catch(() => {})
  }
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
    refreshNodeBadge,
  }
}
