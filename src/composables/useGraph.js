/**
 * useGraph composable
 * 封装 Cytoscape 图谱引擎，管理：
 *   - cy 实例生命周期
 *   - 房间加载（loadRoom）
 *   - 节点/边 CRUD
 *   - 布局保存
 *   - 交互事件（点击、双击、右键、缩放、拖拽）
 */
import { ref, shallowRef, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useStorage, showSaveIndicator } from '@/composables/useStorage'
import { GitCache } from '@/core/git-backend.js'

// Cytoscape 和 ELK 从 vendor 全局加载（window.cytoscape / window.elk）
// 也可以 npm install cytoscape cytoscape-elk 后 import

export function useGraph(containerRef) {
  const appStore = useAppStore()
  const roomStore = useRoomStore()
  const modalStore = useModalStore()
  const storage = useStorage()

  // Cytoscape 实例（shallowRef，不做深度响应式）
  const cy = shallowRef(null)
  // 右键拖拽状态
  let _panning = false, _panStart = { x: 0, y: 0 }, _panOrigin = { x: 0, y: 0 }
  let _rightDragMoved = false
  // 右键菜单目标（传给 ContextMenu 组件）
  const contextMenu = ref({ type: null, x: 0, y: 0, nodeId: null, bgPos: null })
  // 当前缩放值（用于显示）
  const zoomLevel = ref(100)
  // 搜索关键词
  const searchQuery = ref('')

  // ─── 初始化 Cytoscape ────────────────────────────────────────
  function initCy() {
    if (!containerRef.value) return

    cy.value = window.cytoscape({
      container: containerRef.value,
      elements: [],
      minZoom: 0.15, maxZoom: 3.5,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: true,
      selectionType: 'additive',
      style: [
        { selector: 'node.card', style: {
          'shape': 'roundrectangle', 'label': 'data(label)',
          'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
          'text-wrap': 'wrap', 'text-max-width': '100px',
          'background-color': '#4a6fa5', 'background-opacity': 0.92,
          'color': '#fff', 'font-size': '12px',
          'text-valign': 'center', 'text-halign': 'center',
          'width': 'fit-to-label', 'height': 'fit-to-label', 'padding': '14px',
          'underlay-color': '#000', 'underlay-opacity': 0.06, 'underlay-padding': 3,
          'transition-property': 'border-color,border-width,opacity',
          'transition-duration': '0.2s',
        }},
        { selector: 'edge[weight="main"]', style: {
          'width': 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 1,
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
        { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#3498db' }},
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#3498db',
          'underlay-color': '#3498db', 'underlay-opacity': 0.12 }},
        { selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': '#f39c12' }},
        { selector: 'edge.highlighted', style: { 'width': 3, 'opacity': 1, 'z-index': 999 }},
        { selector: 'node.faded', style: { 'opacity': 0.1 }},
        { selector: 'edge.faded', style: { 'opacity': 0.03 }},
        { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f1c40f' }},
      ],
    })

    _bindCyEvents()
    _bindDOMEvents()
  }

  // ─── 加载房间 ────────────────────────────────────────────────
  async function loadRoom(dirPath) {
    if (!cy.value) return

    const [cards, meta] = await Promise.all([
      storage.listCards(dirPath),
      storage.readLayout(dirPath),
    ])
    const children = (meta || {}).children || {}
    const edges = (meta || {}).edges || []

    // 清空图谱
    cy.value.elements().remove()

    // 缓存路径名称
    cards.forEach(card => {
      roomStore.setPathName(card.path, card.name || card.path)
    })
    if (dirPath && meta?.name) {
      roomStore.setPathName(dirPath, meta.name)
    }

    // 添加节点
    cards.forEach(card => {
      const saved = children[card.path] || children[card.name] || {}
      const data = {
        id: card.path,
        label: saved.name || card.name,
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
        shadowOpacity: saved.shadowOpacity || 0,
        nodeOpacity: saved.nodeOpacity != null ? saved.nodeOpacity : 1,
      }
      const ele = cy.value.add({ group: 'nodes', data, classes: 'card' })
      _applyNodeStyle(ele, data, saved)
    })

    // 添加边
    edges.forEach(e => {
      if (cy.value.getElementById(e.source).length && cy.value.getElementById(e.target).length) {
        cy.value.add({ group: 'edges', data: {
          id: e.id || _autoEdgeId(),
          source: e.source,
          target: e.target,
          relation: e.relation || '相关',
          weight: e.weight || 'minor',
        }})
      }
    })

    // 判断是否需要自动布局
    let hasPositions = false
    cy.value.nodes().forEach(n => {
      const p = n.position()
      if (p.x !== 0 || p.y !== 0) hasPositions = true
    })

    const keepZoom = cy.value.zoom()

    if (!hasPositions && cards.length > 0) {
      cy.value.nodes().layout({
        name: 'elk',
        elk: {
          algorithm: 'layered', 'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': 60,
          'elk.layered.spacing.nodeNodeBetweenLayers': 80,
          'elk.padding': '[top=40,left=30,bottom=30,right=30]',
        },
        fit: false, animate: false,
        stop: () => { cy.value.zoom(keepZoom); cy.value.center() },
      }).run()
    } else if (meta?.zoom && meta?.pan) {
      cy.value.pan(meta.pan)
    } else if (cy.value.nodes().length > 0) {
      cy.value.zoom(keepZoom)
      cy.value.center()
    }

    // 异步加载节点徽标数据
    _loadNodeBadges(cards)
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
    if (data.shadowOpacity) {
      ele.style('shadow-blur', 12)
      ele.style('shadow-color', '#000')
      ele.style('shadow-opacity', 0.25)
      ele.style('shadow-offset-x', 3)
      ele.style('shadow-offset-y', 3)
    }
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
        storage.listCards(id).catch(() => []),
        storage.readMarkdown(id).catch(() => ''),
      ])
      const node = cy.value?.getElementById(id)
      if (!node?.length) return
      node.data('childCount', children.length)
      node.data('hasDoc', md && md.trim().length > 0)
    }))
  }

  // ─── 布局保存 ────────────────────────────────────────────────
  function buildCurrentMeta() {
    if (!cy.value) return null
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return null

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
        shadowOpacity: d.shadowOpacity || undefined,
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

    const existingMeta = {}
    return {
      ...existingMeta,
      children,
      edges,
      zoom: cy.value.zoom(),
      pan: cy.value.pan(),
    }
  }

  async function saveCurrentLayout() {
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return
    const meta = buildCurrentMeta()
    if (!meta) return
    await storage.saveLayout(dirPath, meta)
    if (roomStore.currentKBPath) {
      GitCache.markDirty(roomStore.currentKBPath)
    }
  }

  function saveCurrentLayoutDebounced() {
    const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
    if (!dirPath) return
    storage.saveGraphDebounced(dirPath, buildCurrentMeta)
  }

  // ─── 钻入/返回 ──────────────────────────────────────────────
  async function drillInto(cardPath) {
    await saveCurrentLayout()
    const kids = await storage.listCards(cardPath)
    if (kids.length === 0) {
      // 叶子卡片，显示详情
      const node = cy.value.getElementById(cardPath)
      if (node.length) {
        cy.value.nodes('.selected').removeClass('selected')
        node.addClass('selected')
        appStore.selectNode(cardPath)
      }
      return
    }
    roomStore.drillInto(cardPath)
    await loadRoom(cardPath)
  }

  async function goBack() {
    if (roomStore.roomHistory.length === 0) {
      appStore.showHome()
      return
    }
    await saveCurrentLayout()
    roomStore.goBack()
    await loadRoom(roomStore.currentRoomPath)
  }

  async function goRoot() {
    await saveCurrentLayout()
    roomStore.jumpTo(roomStore.currentKBPath)
    await loadRoom(roomStore.currentKBPath)
  }

  async function jumpToBreadcrumb(path) {
    await saveCurrentLayout()
    roomStore.jumpTo(path)
    await loadRoom(path)
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
    // 重新加载当前房间以显示新子卡片（进入父节点）
    roomStore.drillInto(parentPath)
    await loadRoom(parentPath)
    return cardPath
  }

  async function deleteCard(cardPath) {
    await storage.deleteCard(cardPath)
    const node = cy.value.getElementById(cardPath)
    if (node.length) {
      cy.value.remove(node)
      appStore.clearSelection()
    }
    saveCurrentLayoutDebounced()
  }

  async function renameCard(cardPath, newName) {
    await storage.renameCard(cardPath, newName)
    const node = cy.value.getElementById(cardPath)
    if (node.length) node.data('label', newName)
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
      await storage.deleteCard(id).catch(() => {})
    }
    cy.value.remove(cy.value.nodes(':selected'))
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
  function _bindCyEvents() {
    const c = cy.value

    // 节点单击
    c.on('tap', 'node', async (e) => {
      if (appStore.edgeMode && appStore.edgeModeSourceId) {
        const t = e.target
        if (t.id() === appStore.edgeModeSourceId) return
        const srcId = appStore.edgeModeSourceId
        appStore.exitEdgeMode()
        const relation = await modalStore.showInput('关系类型', '演进 / 依赖 / 相关', '依赖')
        if (relation) addEdge(srcId, t.id(), relation)
        return
      }
      const node = e.target
      c.nodes('.selected').removeClass('selected')
      node.addClass('selected')
      appStore.selectNode(node.id())
    })

    // 双击钻入
    c.on('dbltap', 'node', (e) => { drillInto(e.target.id()) })

    // 点击空白取消选择
    c.on('tap', (e) => {
      if (e.target === c) {
        c.nodes('.selected').removeClass('selected')
        c.nodes().unselect()
        appStore.clearSelection()
      }
    })

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
    c.on('free', 'node', () => { saveCurrentLayoutDebounced() })

    // 缩放联动
    c.on('zoom', () => {
      zoomLevel.value = Math.round(c.zoom() * 100)
      _applyZoomDisplay(c.zoom())
    })
  }

  function _bindDOMEvents() {
    const container = cy.value.container()

    // 右键拖拽画布
    const onMousedown = (e) => {
      if (e.button === 2) {
        _panning = true
        _rightDragMoved = false
        _panStart = { x: e.clientX, y: e.clientY }
        _panOrigin = { x: cy.value.pan().x, y: cy.value.pan().y }
        container.style.cursor = 'grabbing'
        e.preventDefault()
      }
    }
    const onMousemove = (e) => {
      if (!_panning) return
      const dx = e.clientX - _panStart.x
      const dy = e.clientY - _panStart.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _rightDragMoved = true
      cy.value.pan({ x: _panOrigin.x + dx, y: _panOrigin.y + dy })
    }
    const onMouseup = (e) => {
      if (e.button === 2 && _panning) {
        _panning = false
        container.style.cursor = ''
      }
    }
    container.addEventListener('contextmenu', e => e.preventDefault())
    container.addEventListener('mousedown', onMousedown)
    document.addEventListener('mousemove', onMousemove)
    document.addEventListener('mouseup', onMouseup)

    // 滚轮缩放
    const onWheel = (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      let newZoom = cy.value.zoom() * factor
      newZoom = Math.max(cy.value.minZoom(), Math.min(cy.value.maxZoom(), newZoom))
      const rect = container.getBoundingClientRect()
      cy.value.zoom({ level: newZoom, renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } })
    }
    container.addEventListener('wheel', onWheel, { passive: false })

    // 保存 cleanup 函数
    _cleanup = () => {
      container.removeEventListener('mousedown', onMousedown)
      document.removeEventListener('mousemove', onMousemove)
      document.removeEventListener('mouseup', onMouseup)
      container.removeEventListener('wheel', onWheel)
    }
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
    const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    const hasModal = document.querySelector('.modal-overlay.active')

    if (e.key === 'Escape') {
      if (appStore.edgeMode) appStore.exitEdgeMode()
      cy.value?.nodes().unselect()
      appStore.clearSelection()
    }
    if (e.key === 'Backspace' && !isInput && !hasModal && roomStore.currentKBPath) {
      e.preventDefault()
      await goBack()
    }
    if (e.key === 'Tab' && appStore.selectedNodeId && !isInput && !hasModal) {
      e.preventDefault()
      const name = await modalStore.showInput('添加子卡片', '子卡片名称...')
      if (name) await addChildCard(appStore.selectedNodeId, name)
    }
    if (e.key === 'Delete' && !isInput && !hasModal) {
      e.preventDefault()
      const selected = cy.value.nodes(':selected')
      if (selected.length > 1) {
        const ok = await modalStore.showConfirm(`确定删除选中的 ${selected.length} 个节点？`)
        if (ok) await batchDelete(selected.map(n => n.id()))
      } else if (appStore.selectedNodeId) {
        const ok = await modalStore.showConfirm(`确定删除节点「${cy.value.getElementById(appStore.selectedNodeId).data('label')}」？`)
        if (ok) await deleteCard(appStore.selectedNodeId)
      }
    }
  }

  // ─── 节点样式更新（供 StylePanel 调用） ─────────────────────
  function updateNodeStyle(nodeId, styles) {
    if (!cy.value) return
    const node = cy.value.getElementById(nodeId)
    if (!node.length) return
    Object.entries(styles).forEach(([key, value]) => {
      node.data(key, value)
      // 映射到 Cytoscape 样式
      const styleMap = {
        color: () => node.style('background-color', value),
        fontColor: () => node.style('color', value),
        fontSize: () => node.style('font-size', value + 'px'),
        textAlign: () => node.style('text-halign', value),
        nodeWidth: () => { node.style('width', value ? value + 'px' : 'fit-to-label'); node.style('text-max-width', value ? value + 'px' : '100px') },
        nodeHeight: () => node.style('height', value ? value + 'px' : 'fit-to-label'),
        borderColor: () => node.style('border-color', value),
        borderWidth: () => node.style('border-width', value + 'px'),
        nodeShape: () => node.style('shape', value),
        nodeOpacity: () => node.style('opacity', value),
      }
      styleMap[key]?.()
    })
    saveCurrentLayoutDebounced()
  }

  function updateNodeFontStyle(nodeId, style, active) {
    if (!cy.value) return
    const node = cy.value.getElementById(nodeId)
    if (!node.length) return
    let current = (node.data('fontStyle') || '').split(' ').filter(Boolean)
    if (active) { if (!current.includes(style)) current.push(style) }
    else current = current.filter(s => s !== style)
    const fontStyle = current.join(' ')
    node.data('fontStyle', fontStyle)
    node.style('font-weight', current.includes('bold') ? 'bold' : 'normal')
    node.style('font-style', current.includes('italic') ? 'italic' : 'normal')
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
  let _cleanup = null

  onUnmounted(() => {
    _cleanup?.()
    cy.value?.destroy()
    cy.value = null
  })

  // ─── 工具 ────────────────────────────────────────────────────
  let _edgeCounter = 0
  function _autoEdgeId() { return `e-${Date.now()}-${_edgeCounter++}` }

  return {
    cy,
    contextMenu,
    zoomLevel,
    searchQuery,
    initCy,
    loadRoom,
    buildCurrentMeta,
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
  }
}
