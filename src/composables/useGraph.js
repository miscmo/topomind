/**
 * useGraph composable
 * 封装 Cytoscape 图谱引擎，管理：
 *   - cy 实例生命周期
 *   - 房间加载（loadRoom）
 *   - 节点/边 CRUD
 *   - 布局保存
 *   - 交互事件（点击、双击、右键、缩放、拖拽）
 */
import { ref, shallowRef, onScopeDispose, watch, getCurrentScope } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useStorage } from '@/composables/useStorage'
import { GitCache } from '@/core/git-backend.js'
import { normalizeMeta } from '@/core/meta.js'
import { createCyManager } from '@/core/cy-manager.js'
import { createCyInstance, setupHtmlLabels } from '@/core/cy-init.js'
import {
  autoEdgeId,
  deduplicateCards,
  deduplicateEdges,
  extractDisplayName,
  buildCardData,
  applyNodeStyle,
  updateNodeStyle as applyNodeStyleToCy,
  updateNodeFontStyle as applyFontStyleToCy,
  batchSetColor as applyBatchColorToCy,
  loadNodeBadges,
  buildCurrentMeta,
  refreshHtmlLabels,
} from '@/core/graph-utils.js'
import { GraphConstants } from '@/core/graph-constants.js'
import { loggerEnhanced as logger, Action } from '@/core/logger-enhanced.js'
import { useGraphDOM } from '@/composables/useGraphDOM.js'

/**
 * 管理图谱页面中的 Cytoscape 实例、房间加载、节点边操作与交互事件。
 *
 * @param {{ value: HTMLElement | null }} containerRef 图谱容器引用
 * @returns {object} 图谱状态与操作方法集合
 */
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

  /**
   * 初始化 Cytoscape 实例，并绑定 DOM 与图事件。
   * 若当前房间已有实例，会先移除旧实例后重建。
   *
   * @returns {void}
   */
  function initCy() {
    if (!containerRef.value) return
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath || '__root__'
    const key = _roomKey(dirPath)

    if (cyManager.has(key)) {
      cyManager.remove(key)
    }

    const instance = createCyInstance(containerRef.value)
    cyManager.create(key, instance)
    const ctx = cyManager.activate(key, containerRef.value)
    cy.value = instance
    setupHtmlLabels(instance)
    _bindCyEvents(instance)
    dom.cleanupDOMEventsExcept(instance)
    dom.bindDOMEvents(instance)
    if (ctx) cyManager.markEventsBound(key, true)
    _grid?.bindCyEvents?.()
    ctx?.cy?.resize?.()
    _grid?.drawGrid?.()
  }

  // ─── 加载房间 ────────────────────────────────────────────────
  /**
   * 加载指定目录对应的图谱房间，并恢复节点、边、画布边界与视口状态。
   * 通过序号机制避免异步并发加载导致旧结果覆盖新房间。
   *
   * @param {string} dirPath 房间目录相对路径
   * @returns {Promise<void>} 加载结果
   */
  async function loadRoom(dirPath) {
    if (!containerRef.value) return

    const startTime = performance.now()
    const loadSeq = ++_loadRoomSeq
    const key = _roomKey(dirPath)
    logger.info('useGraph', Action.PERF_LOAD_ROOM, `加载房间: ${dirPath}`, { key })
    if (cyManager.has(key)) {
      cyManager.remove(key)
    }

    // 惰性创建：如果房间目录不存在，先创建它和 _graph.json
    await storage.ensureCardDir(dirPath)

    try {
      const instance = createCyInstance(containerRef.value)
      cyManager.create(key, instance)
      const ctx = cyManager.activate(key, containerRef.value)
      cy.value = instance
      const cyInst = instance
      setupHtmlLabels(cyInst)
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
      const uniqueCards = deduplicateCards(cardsRaw)
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

      // 添加节点
      uniqueCards.forEach((card) => {
        const legacyKey = card.name?.trim() || null
        const saved = children[card.path] || (legacyKey ? children[legacyKey] : null) || {}
        const data = buildCardData(card, saved)
        const ele = cy.value.add({ group: 'nodes', data, classes: 'card' })
        applyNodeStyle(ele, data, saved)
      })

      // 添加边
      deduplicateEdges(edges, (edgeData) => {
        const { source, target } = edgeData
        if (cy.value.getElementById(source).length && cy.value.getElementById(target).length) {
          cy.value.add({ group: 'edges', data: edgeData })
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
    if (!hasSavedPositions && uniqueCards.length > 0) {
      cy.value.nodes().layout({
        name: 'elk',
        elk: {
          algorithm: 'layered', 'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': 60,
          'elk.layered.spacing.nodeNodeBetweenLayers': 80,
          'elk.padding': `[top=${GraphConstants.ELK_PADDING_TOP},left=${GraphConstants.ELK_PADDING_SIDES},bottom=${GraphConstants.ELK_PADDING_SIDES},right=${GraphConstants.ELK_PADDING_SIDES}]`,
        },
        fit: false, animate: false,
        error: (e) => {
          if (loadSeq !== _loadRoomSeq) return
          logger.warn('useGraph', 'ELK布局失败，回退到中心化:', e)
          cy.value.nodes().positions(n => ({ x: 0, y: 0 }))
          cy.value.center()
          _grid?.drawGrid()
        },
        stop: () => {
          if (loadSeq !== _loadRoomSeq) return
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
      loadNodeBadges(cy.value, storage)
      cyManager.markLoaded(key, true)

      // 从 localStorage 恢复选中的节点（仅当节点在当前房间中存在）
      _restoreSelectedNode()
      logger.perf('useGraph', Action.PERF_LOAD_ROOM, `房间加载完成: ${dirPath}`, performance.now() - startTime, { key, cardCount: uniqueCards.length })
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

  // ─── 布局保存 ────────────────────────────────────────────────
  /**
   * 立即保存当前图谱布局到指定目录或当前房间目录。
   * 保存成功后会把当前知识库标记为存在未提交改动。
   *
   * @param {string|null} [targetDirPath=null] 可选目标目录路径
   * @returns {Promise<void>} 保存结果
   */
  async function saveCurrentLayout(targetDirPath = null) {
    const dirPath = targetDirPath || roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return
    const meta = buildCurrentMeta(cy.value, currentMeta.value, _grid)
    if (!meta) return
    await storage.flushGraphSave(dirPath, () => meta)
    if (roomStore.currentKBPath) {
      GitCache.markDirty(roomStore.currentKBPath)
    }
  }

  /**
   * 以防抖方式保存当前图谱布局。
   * 在调度时冻结元数据快照，避免切换房间后写回错误目录。
   *
   * @returns {Promise<void>} 调度结果
   */
  async function saveCurrentLayoutDebounced() {
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return

    // 关键：在调度时就冻结快照，避免切房间后把新房间布局误写回旧房间
    const metaSnapshot = buildCurrentMeta(cy.value, currentMeta.value, _grid)
    if (!metaSnapshot) return
    storage.saveGraphDebounced(dirPath, () => metaSnapshot)
  }


  // ─── 钻入/返回 ──────────────────────────────────────────────
  async function drillInto(cardPath) {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    logger.info('useGraph', Action.ROOM_DRILL_INTO, `钻入: ${cardPath}`, { prevPath, cardPath })
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
    const targetPath = roomStore.roomHistory[roomStore.roomHistory.length - 1]
    logger.info('useGraph', Action.ROOM_GO_BACK, `返回: ${prevPath} -> ${targetPath}`, { prevPath, targetPath })
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
    roomStore.goBack()
  }

  async function goRoot() {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    const kbPath = roomStore.currentKBPath
    logger.info('useGraph', Action.ROOM_GO_ROOT, `返回根级: ${prevPath} -> ${kbPath}`, { prevPath, kbPath })
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
    roomStore.jumpTo(roomStore.currentKBPath)
  }

  async function jumpToBreadcrumb(path) {
    const prevPath = roomStore.currentRoomPath || roomStore.currentKBPath
    logger.info('useGraph', Action.ROOM_JUMP_TO, `面包屑跳转: ${prevPath} -> ${path}`, { prevPath, path })
    try {
      await saveCurrentLayout(prevPath)
    } catch (e) {
      logger.catch('useGraph', '保存布局', e)
    }
    roomStore.jumpTo(path)
  }

  // ─── 节点/边 CRUD ────────────────────────────────────────────
  /**
   * 在当前房间中新增卡片节点，并立即持久化父级布局。
   *
   * @param {string} name 卡片名称
   * @param {{x:number,y:number}} [pos] 节点初始位置
   * @returns {Promise<string|undefined>} 新卡片路径
   */
  async function addCard(name, pos) {
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return
    const startTime = performance.now()
    const cardPath = await storage.createCard(dirPath, name)
    logger.info('useGraph', Action.NODE_ADD, `添加节点: ${name}`, { cardPath, dirPath })
    await storage.ensureCardDir(cardPath)
    const node = cy.value.add({
      group: 'nodes',
      data: { id: cardPath, label: name, cardPath },
      classes: 'card',
      position: pos || { x: 0, y: 0 },
    })
    if (!pos) cy.value.center(node)
    // 同步保存：确保父级的 _graph.json 立即更新，持久化新卡片
    await saveCurrentLayout(dirPath)
    logger.perf('useGraph', Action.NODE_ADD, `节点添加完成: ${name}`, performance.now() - startTime, { cardPath })
    return cardPath
  }

  async function addChildCard(parentPath, name) {
    // 惰性创建：先确保父级目录存在，再创建子卡片
    await storage.ensureCardDir(parentPath)
    const cardPath = await storage.createCard(parentPath, name)
    // 同步保存：确保父级的 _graph.json 立即更新，持久化新卡片
    // loadRoom 会在下次加载时自动加载新卡片，无需手动添加到 cytoscape
    await saveCurrentLayout(parentPath)
    return cardPath
  }

  async function deleteCard(cardPath) {
    await storage.deleteCard(cardPath)
    logger.info('useGraph', Action.NODE_DELETE, `删除节点: ${cardPath}`)
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
    logger.info('useGraph', Action.NODE_RENAME, `重命名节点: ${cardPath} -> ${newName}`, { cardPath, actualPath, newName })
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
          roomStore.removePathName(cardPath)
        }
      }
    }
    saveCurrentLayoutDebounced()
  }

  /**
   * 在两个节点之间新增一条关系边，并避免重复添加同向边。
   *
   * @param {string} sourceId 源节点 ID
   * @param {string} targetId 目标节点 ID
   * @param {string} relation 关系类型
   * @returns {void}
   */
  function addEdge(sourceId, targetId, relation) {
    if (sourceId === targetId) return
    if (!cy.value.getElementById(sourceId)?.length || !cy.value.getElementById(targetId)?.length) return
    // 防止重复添加同向边
    const existing = cy.value.edges().filter(
      e => e.data('source') === sourceId && e.data('target') === targetId
    )
    if (existing.length) return
    try {
      const edgeId = autoEdgeId()
      cy.value.add({
        group: 'edges',
        data: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          relation,
          weight: relation === '相关' ? 'minor' : 'main',
        },
      })
      logger.info('useGraph', Action.EDGE_ADD, `添加边: ${sourceId} -> ${targetId} (${relation})`, { edgeId, source: sourceId, target: targetId, relation })
      saveCurrentLayoutDebounced()
    } catch (e) {
      logger.catch('useGraph', `添加边失败 (${sourceId} -> ${targetId})`, e)
    }
  }

  function deleteEdge(edgeId) {
    logger.info('useGraph', Action.EDGE_DELETE, `删除边: ${edgeId}`)
    const edge = cy.value.getElementById(edgeId)
    if (edge.length) cy.value.remove(edge)
    saveCurrentLayoutDebounced()
  }

  async function batchDelete(nodeIds) {
    const count = nodeIds.length
    logger.info('useGraph', Action.NODE_DELETE, `批量删除 ${count} 个节点`, { nodeIds })
    for (const id of nodeIds) {
      try {
        await storage.deleteCard(id)
      } catch (err) {
        logger.catch('useGraph', `删除节点失败: ${id}`, err)
      }
    }
    const selected = cy.value.nodes(':selected')
    selected.connectedEdges().remove()
    selected.remove()
    appStore.clearSelection()
    saveCurrentLayoutDebounced()
  }

  async function deleteAllNodes() {
    if (!cy.value) return
    const nodeIds = cy.value.nodes().map(n => n.id())
    const count = nodeIds.length
    logger.info('useGraph', Action.NODE_DELETE, `删除全部节点: ${count} 个`, { nodeIds })
    for (const id of nodeIds) {
      try {
        await storage.deleteCard(id)
      } catch (err) {
        logger.catch('useGraph', `删除节点失败: ${id}`, err)
      }
    }
    if (!cy.value) return
    cy.value.edges().remove()
    cy.value.nodes().remove()
    appStore.clearSelection()
    saveCurrentLayoutDebounced()
  }

  // ─── 搜索 ────────────────────────────────────────────────────
  function applySearch(q) {
    if (!cy.value) return
    cy.value.nodes().removeClass('search-match')
    if (!q) return
    const lower = q.toLowerCase()
    const matchCount = cy.value.nodes().filter(n => (n.data('label') || '').toLowerCase().includes(lower)).length
    cy.value.nodes().forEach(n => {
      if ((n.data('label') || '').toLowerCase().includes(lower)) {
        n.addClass('search-match')
      }
    })
    logger.info('useGraph', Action.SEARCH_APPLY, `搜索: ${q}`, { query: q, matchCount })
  }

  // ─── 缩放 ────────────────────────────────────────────────────
  function zoomIn() {
    logger.info('useGraph', Action.VIEW_ZOOM, '放大')
    cy.value?.animate({ zoom: cy.value.zoom() * 1.3 }, { duration: 200 })
  }
  function zoomOut() {
    logger.info('useGraph', Action.VIEW_ZOOM, '缩小')
    cy.value?.animate({ zoom: cy.value.zoom() / 1.3 }, { duration: 200 })
  }
  function fitView() {
    logger.info('useGraph', Action.VIEW_FIT, '适应视图')
    cy.value?.animate({ fit: { padding: GraphConstants.FIT_PADDING } }, { duration: GraphConstants.FIT_ANIMATION_DURATION_MS })
  }
  function resetZoom() {
    logger.info('useGraph', Action.VIEW_RESET_ZOOM, '重置缩放')
    cy.value?.zoom(1)
    cy.value?.center()
  }

  // ─── 事件绑定 ────────────────────────────────────────────────

  // 同步选中状态到 Pinia store
  const syncSelectionToStore = (c) => {
    const selected = c.nodes(':selected')
    const prevSelected = appStore.selectedNodeId
    if (selected.length > 0) {
      const id = selected[0].id()
      appStore.selectNode(id)
      if (id !== prevSelected) {
        logger.info('useGraph', Action.NODE_SELECT, `选中节点: ${id}`)
      }
    } else {
      if (prevSelected) {
        logger.info('useGraph', Action.NODE_UNSELECT, `取消选中: ${prevSelected}`)
      }
      appStore.clearSelection()
    }
    dom.updateNodeHandles(c)
  }

  // 节点释放（mouseup）：兜底选中，避免 tap 被轻微拖动吞掉
  const _onNodeMouseUp = (c, e) => {
    if (dragConnectState.value?.active) return
    if (appStore.edgeMode) return
    const oe = e.originalEvent || {}
    if (oe.button === 2) return
    const node = e.target
    const keepMulti = !!(oe.ctrlKey || oe.shiftKey || oe.metaKey)
    requestAnimationFrame(() => {
      if (!keepMulti) c.nodes(':selected').unselect()
      node.select()
      syncSelectionToStore(c)
    })
  }

  // 节点单击（tap）：连线模式下确认目标节点
  const _onNodeTap = async (c, e) => {
    if (dragConnectState.value?.active) return
    if (!appStore.edgeMode || !appStore.edgeModeSourceId) return
    const t = e.target
    if (t.id() === appStore.edgeModeSourceId) return
    const srcId = appStore.edgeModeSourceId
    appStore.exitEdgeMode()
    const relation = await modalStore.showInput('关系类型', '演进 / 依赖 / 相关', '依赖')
    if (relation) addEdge(srcId, t.id(), relation)
  }

  // 节点右键（cxttap）：打开节点/批量操作右键菜单
  const _onNodeContextTap = (c, e) => {
    if (rightDragMoved.value) return
    const selected = c.nodes(':selected')
    if (selected.length > 1) {
      contextMenu.value = { type: 'batch', x: e.originalEvent.clientX, y: e.originalEvent.clientY }
    } else {
      contextMenu.value = { type: 'node', x: e.originalEvent.clientX, y: e.originalEvent.clientY, nodeId: e.target.id() }
    }
  }

  // 背景右键（cxttap）：打开空白区域右键菜单
  const _onBgContextTap = (c, e) => {
    if (rightDragMoved.value) return
    if (e.target === c) {
      contextMenu.value = { type: 'bg', x: e.originalEvent.clientX, y: e.originalEvent.clientY, bgPos: e.position }
    }
  }

  /**
   * 为指定 Cytoscape 实例绑定图交互事件，并确保每个实例仅绑定一次。
   *
   * @param {object|null} [targetCy=null] 目标 Cytoscape 实例
   * @returns {void}
   */
  function _bindCyEvents(targetCy = null) {
    const c = targetCy || cy.value
    if (!c || _cyEventsBound.has(c)) return

    c.on('mouseup', 'node', (e) => _onNodeMouseUp(c, e))
    c.on('tap', 'node', (e) => _onNodeTap(c, e))
    c.on('dbltap', 'node', (e) => { drillInto(e.target.id()) })
    c.on('cxttap', 'node', (e) => _onNodeContextTap(c, e))
    c.on('cxttap', 'edge', (e) => {
      if (rightDragMoved.value) return
      contextMenu.value = { type: 'edge', x: e.originalEvent.clientX, y: e.originalEvent.clientY, edgeId: e.target.id() }
    })
    c.on('cxttap', (e) => _onBgContextTap(c, e))
    c.on('mouseover', 'node', (e) => { e.target.addClass('highlighted') })
    c.on('mouseout', 'node', (e) => { e.target.removeClass('highlighted') })
    c.on('free', 'node', () => { saveCurrentLayoutDebounced(); dom.updateNodeHandles(c) })
    c.on('select unselect', 'node', () => { syncSelectionToStore(c) })
    c.on('zoom', () => {
      zoomLevel.value = Math.round(c.zoom() * 100)
      logger.debug('useGraph', `缩放变更: ${Math.round(c.zoom() * 100)}%`)
      dom.applyZoomDisplay(c.zoom())
      dom.updateNodeHandles(c)
    })
    c.on('pan', () => { dom.updateNodeHandles(c) })

    _cyEventsBound.add(c)
  }


  // ─── 键盘事件（由 GraphView 组件调用） ──────────────────────
  /**
   * 处理图谱区域键盘事件，主要用于拦截删除类按键的默认浏览器行为。
   *
   * @param {KeyboardEvent} e 键盘事件
   * @returns {Promise<void>} 处理结果
   */
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

  // 强制刷新 HTML 标签（style 变更后调用）
  // cytoscape-node-html-label 插件通过 'data'/'style' 事件更新标签，
  // 但由于 _setupHtmlLabels 可能被多次调用产生多套事件处理器，
  // 故在样式变更后显式触发 'data' 事件确保标签刷新。
  function _refreshHtmlLabels(targetNodes) {
    refreshHtmlLabels(cy.value, targetNodes)
  }

  function updateNodeStyle(nodeId, styles) {
    if (!cy.value) return

    const selected = cy.value.nodes(':selected')
    const fallback = nodeId ? cy.value.getElementById(nodeId) : cy.value.collection()
    const targets = selected.length > 1 ? selected : fallback
    if (!targets.length) return

    applyNodeStyleToCy(cy.value, targets, styles, _refreshHtmlLabels)

    saveCurrentLayoutDebounced()
  }

  function updateNodeFontStyle(nodeId, style, active) {
    if (!cy.value) return

    const selected = cy.value.nodes(':selected')
    const fallback = nodeId ? cy.value.getElementById(nodeId) : cy.value.collection()
    const targets = selected.length > 1 ? selected : fallback
    if (!targets.length) return

    applyFontStyleToCy(cy.value, targets, style, active, _refreshHtmlLabels)

    saveCurrentLayoutDebounced()
  }

  // 批量改色
  function batchSetColor(color) {
    if (!cy.value) return
    applyBatchColorToCy(cy.value, cy.value.nodes(':selected'), color)
    saveCurrentLayoutDebounced()
  }

  // 导出为 PNG
  function exportPNG() {
    if (!cy.value) return
    try {
      const png = cy.value.png({ scale: 2, full: true, bg: '#f8f9fb' })
      const a = document.createElement('a')
      a.href = png
      a.download = 'topomind-export.png'
      a.click()
    } catch (err) {
      logger.catch('useGraph', 'exportPNG 失败', err)
    }
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

  if (getCurrentScope()) {
    onScopeDispose(() => {
      dom.cleanupDOMEventsExcept(null)
      cyManager.clear()
      // 显式销毁 Cytoscape 实例，防止内存泄漏
      if (cy.value && !cy.value.destroyed) {
        cy.value.destroy()
      }
      cy.value = null
    })
  }

  /**
   * 根据卡片文档内容刷新节点的徽标显示状态。
   *
   * @param {string} id 节点 ID / 卡片路径
   * @returns {void}
   */
  function refreshNodeBadge(id) {
    if (!cy.value || !id) return
    const node = cy.value.getElementById(id)
    if (!node?.length) return
    storage.readMarkdown(id).then(md => {
      if (!cy.value) return
      const n = cy.value.getElementById(id)
      if (!n?.length) return
      n.data('hasDoc', !!(md && md.trim().length > 0))
      try { n.emit('data') } catch (e) { logger.warn('useGraph', 'emit data event', e) }
    }).catch((e) => { logger.catch('useGraph', 'updateNodeHasDoc', e) })
  }

  // 注入外部 composable
  /**
   * 注入外部网格控制对象，供布局恢复、画布边界和辅助线能力复用。
   *
   * @param {object} g grid composable 返回对象
   * @returns {void}
   */
  function setGrid(g) { _grid = g }

  return {
    cy,
    contextMenu,
    zoomLevel,
    searchQuery,
    initCy,
    loadRoom,
    buildCurrentMeta: () => buildCurrentMeta(cy.value, currentMeta.value, _grid),
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
    deleteAllNodes,
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
