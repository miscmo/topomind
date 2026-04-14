<!-- 图谱主页面：左侧面板 + 中间图谱 + 右侧详情 -->
<template>
  <div id="graph-page">
    <div v-if="initPhase === 'error'" class="graph-init-error">
      <div class="graph-init-error-title">图谱初始化失败</div>
      <div class="graph-init-error-msg">{{ initError || '未知错误' }}</div>
      <button class="graph-init-retry-btn" @click="retryInit">重试</button>
    </div>

    <div v-else id="app-layout" ref="appLayoutRef">

      <!-- 展开按钮（左侧面板收起时） -->
      <button v-if="!leftPanel.open" id="btn-toggle-style" class="visible" @click="leftPanel.open = true" title="展开样式面板">▶</button>

      <!-- 左侧面板：样式面板 -->
      <StylePanel
        v-if="leftPanel.open"
        :class="{ compact: leftPanelWidth < 320 }"
        :selectedNodeId="appStore.selectedNodeId"
        :cy="graph.cy.value"
        :style="{ width: leftPanelWidth + 'px', flexShrink: 0, position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 5 }"
        @collapse="leftPanel.open = false"
        @update-style="graph.updateNodeStyle"
        @update-font-style="graph.updateNodeFontStyle"
      />
      <div v-if="leftPanel.open" id="style-resize-preview" :class="{ active: styleResizeState.active }" :style="{ left: styleResizeState.previewLeft + 'px' }"></div>
      <div v-if="leftPanel.open" id="style-resize-handle" :style="{ left: Math.max(0, leftPanelWidth - 2) + 'px' }" @mousedown="startStyleResize"></div>

      <!-- 中间图谱 -->
      <div id="graph-panel">
        <!-- 网格背景 canvas -->
        <canvas ref="gridCanvasRef" id="grid-canvas" class="grid-bg"></canvas>

        <!-- Cytoscape 容器 -->
        <div ref="cyContainerRef" id="cy"></div>


        <!-- Tooltip -->
        <div ref="tooltipRef" id="node-tooltip">
          <div id="node-tooltip-title"></div>
          <div id="node-tooltip-body"></div>
        </div>

        <!-- 路径导航（根层显示知识库名，子层显示完整路径） -->
        <Breadcrumb
          v-if="roomStore.currentKBPath"
          :crumbs="roomStore.breadcrumbs"
          @jump="graph.jumpToBreadcrumb"
          @go-root="graph.goRoot"
        />

        <!-- 缩放指示 -->
        <div id="zoom-indicator" :style="zoomIndicatorStyle">{{ graph.zoomLevel.value }}%</div>

        <!-- 缩放控制 -->
        <div id="controls">
          <button @click="graph.zoomIn()">＋</button>
          <button @click="graph.zoomOut()">－</button>
        </div>

        <!-- 保存指示器 -->
        <div id="save-indicator" :class="{ visible: saveIndicatorVisible }">{{ saveFailed ? '✗ 保存失败' : '✓ 已保存' }}</div>

        <!-- 连线模式提示 -->
        <div id="edge-mode-hint" :class="{ active: appStore.edgeMode }">
          <span>🔗 连线模式：点击目标节点</span>
          <button @click="appStore.exitEdgeMode()">取消</button>
        </div>
      </div>

      <!-- 右侧详情面板 -->
      <button v-if="!detailPanel.open" id="btn-toggle-detail" class="visible" @click="detailPanel.open = true" title="展开文档详情">◀</button>
      <div v-if="detailPanel.open" id="detail-resize-preview" :class="{ active: detailResizeState.active }" :style="{ left: detailResizeState.previewLeft + 'px' }"></div>
      <div v-if="detailPanel.open" id="detail-resize-handle" @mousedown="startDetailResize"></div>
      <DetailPanel
        v-if="detailPanel.open"
        ref="detailPanelRef"
        :nodeId="appStore.selectedNodeId"
        :style="{ width: detailPanelWidth + 'px', pointerEvents: detailResizeState.active ? 'none' : 'auto' }"
        @collapse="detailPanel.open = false"
        @delete="handleDeleteFromDetail"
        @rename="handleRenameFromDetail"
        @drill="graph.drillInto"
      />

    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      :menu="graph.contextMenu.value"
      :edgeMode="appStore.edgeMode"
      @close="graph.contextMenu.value.type = null"
      @action="handleContextAction"
    />

  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useGraph } from '@/composables/useGraph'
import { useGrid } from '@/composables/useGrid'
import { useStorage, saveIndicatorVisible, saveFailed } from '@/composables/useStorage'

import StylePanel from '@/components/StylePanel.vue'
import DetailPanel from '@/components/DetailPanel.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import ContextMenu from '@/components/ContextMenu.vue'


const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const storage = useStorage()

// DOM 引用
const appLayoutRef = ref(null)
const cyContainerRef = ref(null)
const gridCanvasRef = ref(null)
const tooltipRef = ref(null)
const detailPanelRef = ref(null)
let _initGridTimer = null

// 面板状态
const leftPanel = reactive({ open: true })
const detailPanel = reactive({ open: true })
const leftPanelWidth = ref(300)
const detailPanelWidth = ref(420)
const styleResizeState = reactive({
  active: false,
  previewLeft: 0,
})
const detailResizeState = reactive({
  active: false,
  previewLeft: 0,
})
const zoomIndicatorStyle = computed(() => ({
  left: `${Math.max(12, leftPanelWidth.value + 12)}px`,
}))
const initPhase = ref('idle') // idle | engine | decorators | room | ready | error
const initError = ref('')

const STYLE_WIDTH_MIN = 300
const STYLE_WIDTH_MAX = 420
const DETAIL_WIDTH_MIN = 260
const DETAIL_WIDTH_MAX = 860

function detailWidthKeyForKB(kbPath) {
  return kbPath ? `topomind:detail-width:${kbPath}` : ''
}

function detailPanelStateKeyForKB(kbPath) {
  return kbPath ? `topomind:detail-panel:${kbPath}` : ''
}

function clampPanelWidth(w, min, max, fallback) {
  const n = Number(w)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function clampDetailWidth(w) {
  return clampPanelWidth(w, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX, 420)
}

function clampStyleWidth(w) {
  return clampPanelWidth(w, STYLE_WIDTH_MIN, STYLE_WIDTH_MAX, 300)
}

function readPersistedDetailWidthForKB(kbPath) {
  const key = detailWidthKeyForKB(kbPath)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return null
    return clampDetailWidth(raw)
  } catch (e) {
    console.warn('[GraphView] 读取详情宽度失败:', e)
    return null
  }
}

function persistDetailWidthForKB(kbPath, width) {
  const key = detailWidthKeyForKB(kbPath)
  if (!key) return
  try {
    localStorage.setItem(key, String(clampDetailWidth(width)))
  } catch (e) {
    console.warn('[GraphView] 保存详情宽度失败:', e)
  }
}

function persistDetailPanelStateForKB(kbPath, state) {
  const key = detailPanelStateKeyForKB(kbPath)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch (e) {
    console.warn('[GraphView] 保存详情面板状态失败:', e)
  }
}

function readPersistedDetailPanelStateForKB(kbPath) {
  const key = detailPanelStateKeyForKB(kbPath)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return null
    return JSON.parse(raw)
  } catch (e) {
    console.warn('[GraphView] 读取详情面板状态失败:', e)
    return null
  }
}

function saveUiToActiveTab(patch = {}) {
  const tab = roomStore.activeTab
  if (!tab) return
  if (!tab.ui) tab.ui = {}
  tab.ui = { ...tab.ui, ...patch }
}

function readPersistedStyleWidth() {
  try {
    const raw = localStorage.getItem('topomind:style-width')
    if (raw == null) return null
    return clampStyleWidth(raw)
  } catch (e) {
    console.warn('[GraphView] 读取样式宽度失败:', e)
    return null
  }
}

function persistStyleWidth(width) {
  try {
    localStorage.setItem('topomind:style-width', String(clampStyleWidth(width)))
  } catch (e) {
    console.warn('[GraphView] 保存样式宽度失败:', e)
  }
}

function syncUiFromActiveTab() {
  const tab = roomStore.activeTab
  if (!tab) return

  const ui = tab.ui || {}

  // 详情面板状态优先从 localStorage 恢复（跨 tab 重启持久化），
  // 其次读 tab.ui，最后用默认值
  const persistedDetailState = readPersistedDetailPanelStateForKB(roomStore.currentKBPath)

  leftPanel.open = persistedDetailState?.leftPanelOpen ?? ui.leftPanelOpen ?? true

  detailPanel.open = persistedDetailState?.detailPanelOpen ?? ui.detailPanelOpen ?? true

  const persistedStyleWidth = readPersistedStyleWidth()
  const restoredStyleWidth = persistedStyleWidth ?? ui.leftPanelWidth ?? leftPanelWidth.value
  leftPanelWidth.value = clampStyleWidth(restoredStyleWidth)

  const persistedWidth = readPersistedDetailWidthForKB(roomStore.currentKBPath)
  // 跨重启优先使用持久化宽度，避免 tab.ui 的默认值覆盖用户上次调整
  const restoredWidth = persistedWidth ?? ui.detailPanelWidth ?? detailPanelWidth.value
  detailPanelWidth.value = clampDetailWidth(restoredWidth)

  // selectedNodeId 也优先从 localStorage 恢复（跨 tab 重启持久化）
  const restoredNodeId = persistedDetailState?.selectedNodeId ?? ui.selectedNodeId ?? null
  appStore.selectNode(restoredNodeId)
  if (ui.edgeMode && ui.edgeModeSourceId) {
    appStore.enterEdgeMode(ui.edgeModeSourceId)
  } else {
    appStore.exitEdgeMode()
  }
}

// ─── composables ────────────────────────────────────────────
const graph = useGraph(cyContainerRef)
const grid = useGrid(gridCanvasRef, () => graph.cy.value)

// 把 grid 注入到 graph，让 loadRoom 完成后自动调用
graph.setGrid(grid)

// ─── 计算属性 ────────────────────────────────────────────────

// ─── 生命周期 ────────────────────────────────────────────────
onMounted(async () => {
  await initializeGraphView()
  syncUiFromActiveTab()
})

onUnmounted(() => {
  document.removeEventListener('keydown', graph.handleKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  clearTimeout(_initGridTimer)
})

// 切换标签页时重新加载房间
watch(() => roomStore.currentRoomPath, async (newPath) => {
  if (newPath && graph.cy.value) {
    try {
      initPhase.value = 'room'
      await graph.loadRoom(newPath)
      initPhase.value = 'ready'
    } catch (e) {
      initPhase.value = 'error'
      initError.value = e?.message || '切换房间失败'
      console.error('[GraphView] 切换房间加载失败:', newPath, e)
    }
  }
})

watch(() => roomStore.activeTabId, () => {
  syncUiFromActiveTab()
}, { immediate: true })

watch(() => leftPanel.open, (v) => {
  saveUiToActiveTab({ leftPanelOpen: !!v })
  const kbPath = roomStore.currentKBPath
  if (kbPath) {
    const state = readPersistedDetailPanelStateForKB(kbPath) || {}
    persistDetailPanelStateForKB(kbPath, { ...state, leftPanelOpen: !!v })
  }
})

watch(() => leftPanelWidth.value, (v) => {
  saveUiToActiveTab({ leftPanelWidth: clampStyleWidth(v) })
  persistStyleWidth(v)
})

watch(() => detailPanel.open, (v) => {
  saveUiToActiveTab({ detailPanelOpen: !!v })
  const kbPath = roomStore.currentKBPath
  if (kbPath) {
    const state = readPersistedDetailPanelStateForKB(kbPath) || {}
    persistDetailPanelStateForKB(kbPath, { ...state, detailPanelOpen: !!v })
  }
})

watch(() => detailPanelWidth.value, (v) => {
  saveUiToActiveTab({ detailPanelWidth: clampDetailWidth(v) })
  persistDetailWidthForKB(roomStore.currentKBPath, v)
  const kbPath = roomStore.currentKBPath
  if (kbPath) {
    const state = readPersistedDetailPanelStateForKB(kbPath) || {}
    persistDetailPanelStateForKB(kbPath, { ...state, detailPanelWidth: clampDetailWidth(v) })
  }
})

watch(() => appStore.selectedNodeId, (v) => {
  saveUiToActiveTab({ selectedNodeId: v || null })
  const kbPath = roomStore.currentKBPath
  if (kbPath) {
    const state = readPersistedDetailPanelStateForKB(kbPath) || {}
    persistDetailPanelStateForKB(kbPath, { ...state, selectedNodeId: v || null })
  }
})

watch(() => appStore.edgeMode, (v) => {
  saveUiToActiveTab({ edgeMode: !!v })
})

watch(() => appStore.edgeModeSourceId, (v) => {
  saveUiToActiveTab({ edgeModeSourceId: v || null })
})

async function initializeGraphView() {
  initError.value = ''
  try {
    await nextTick()

    initPhase.value = 'engine'
    graph.initCy()

    initPhase.value = 'decorators'
    grid.bindCyEvents()

    initPhase.value = 'room'
    if (roomStore.currentRoomPath) {
      await graph.loadRoom(roomStore.currentRoomPath)
    }

    _initGridTimer = setTimeout(() => grid.drawGrid(), 100)

    document.addEventListener('keydown', graph.handleKeydown)
    window.addEventListener('beforeunload', handleBeforeUnload)
    initPhase.value = 'ready'
  } catch (e) {
    initPhase.value = 'error'
    initError.value = e?.message || '初始化失败'
    console.error('[GraphView] mounted 初始化失败:', e)
  }
}

function retryInit() {
  if (graph.cy.value) {
    graph.cy.value.destroy()
    graph.cy.value = null
  }
  initializeGraphView()
}

async function handleBeforeUnload() {
  // 先保存正在编辑的 Markdown 内容
  detailPanelRef.value?.flushEdit()
  const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
  if (!dirPath) return
  const meta = await graph.buildCurrentMeta()
  if (meta) storage.saveLayoutSync(dirPath, meta)
}

// ─── 右键菜单动作 ────────────────────────────────────────────
async function handleContextAction({ action, payload }) {
  switch (action) {
    case 'drill':
      await graph.drillInto(payload.nodeId)
      break
    case 'add-child': {
      const name = await modalStore.showInput('添加子卡片', '子卡片名称...')
      if (name) await graph.addChildCard(payload.nodeId, name)
      break
    }
    case 'connect':
      appStore.enterEdgeMode(payload.nodeId)
      break
    case 'edit-md':
      appStore.selectNode(payload.nodeId)
      detailPanel.open = true
      break
    case 'delete': {
      const node = graph.cy.value?.getElementById(payload.nodeId)
      const ok = await modalStore.showConfirm(`确定删除节点「${node?.data('label')}」？`)
      if (ok) await graph.deleteCard(payload.nodeId)
      break
    }
    case 'delete-edge':
      graph.deleteEdge(payload.edgeId)
      break
    case 'add-card': {
      const name = await modalStore.showInput('新建卡片', '卡片名称...')
      if (name) await graph.addCard(name, payload.bgPos)
      break
    }
    case 'fit-view':
      graph.fitView()
      break
    case 'go-back':
      await graph.goBack()
      break
    case 'batch-delete': {
      const selected = graph.cy.value?.nodes(':selected')
      const ok = await modalStore.showConfirm(`确定删除选中的 ${selected?.length} 个节点？`)
      if (ok) await graph.batchDelete(selected.map(n => n.id()))
      break
    }
    case 'batch-color':
      graph.batchSetColor(payload.color)
      break
  }
  graph.contextMenu.value.type = null
}

// ─── 详情面板 ────────────────────────────────────────────────
async function handleDeleteFromDetail(nodeId) {
  const node = graph.cy.value?.getElementById(nodeId)
  const ok = await modalStore.showConfirm(`确定删除节点「${node?.data('label')}」？`)
  if (ok) await graph.deleteCard(nodeId)
}

async function handleRenameFromDetail(nodeId) {
  const node = graph.cy.value?.getElementById(nodeId)
  const newName = await modalStore.showInput('重命名', '新名称...', node?.data('label') || '')
  if (newName) await graph.renameCard(nodeId, newName)
}

function startStyleResize(e) {
  if (e.button !== 0) return
  if (!appLayoutRef.value) return

  e.preventDefault()

  const rect = appLayoutRef.value.getBoundingClientRect()
  const startX = e.clientX
  const startWidth = leftPanelWidth.value

  const prevUserSelect = document.body.style.userSelect
  const prevCursor = document.body.style.cursor

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  styleResizeState.active = true
  styleResizeState.previewLeft = Math.max(0, startWidth)

  const calcWidthByClientX = (clientX) => clampStyleWidth(startWidth + (clientX - startX))

  const onMove = (ev) => {
    ev.preventDefault()
    const nextWidth = calcWidthByClientX(ev.clientX)
    styleResizeState.previewLeft = Math.max(0, Math.min(rect.width, nextWidth))
  }

  const cleanup = () => {
    styleResizeState.active = false
    document.body.style.userSelect = prevUserSelect
    document.body.style.cursor = prevCursor
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  const onUp = (ev) => {
    ev.preventDefault()
    const nextWidth = calcWidthByClientX(ev.clientX)
    leftPanelWidth.value = nextWidth
    saveUiToActiveTab({ leftPanelWidth: nextWidth })
    persistStyleWidth(nextWidth)
    cleanup()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startDetailResize(e) {
  if (e.button !== 0) return
  if (!appLayoutRef.value) return

  e.preventDefault()

  const rect = appLayoutRef.value.getBoundingClientRect()
  const startX = e.clientX
  const startWidth = detailPanelWidth.value

  const prevUserSelect = document.body.style.userSelect
  const prevCursor = document.body.style.cursor

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  const clampWidth = (w) => clampDetailWidth(w)
  const calcWidthByClientX = (clientX) => {
    const diff = startX - clientX
    return clampWidth(startWidth + diff)
  }

  const calcPreviewLeft = (width) => {
    // 预览线在详情面板左边界（紧邻 graph-panel 右侧）
    return Math.max(0, rect.width - width)
  }

  detailResizeState.active = true
  detailResizeState.previewLeft = calcPreviewLeft(startWidth)

  const onMove = (ev) => {
    ev.preventDefault()
    const nextWidth = calcWidthByClientX(ev.clientX)
    detailResizeState.previewLeft = calcPreviewLeft(nextWidth)
  }

  const cleanup = () => {
    detailResizeState.active = false
    document.body.style.userSelect = prevUserSelect
    document.body.style.cursor = prevCursor

    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  const onUp = (ev) => {
    ev.preventDefault()
    const nextWidth = calcWidthByClientX(ev.clientX)
    detailPanelWidth.value = nextWidth
    persistDetailWidthForKB(roomStore.currentKBPath, nextWidth)
    saveUiToActiveTab({ detailPanelWidth: nextWidth })
    cleanup()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
#graph-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

#app-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

.sp-title {
  font-size: 12px;
  color: #8891aa;
  padding: 0 4px;
}
</style>
