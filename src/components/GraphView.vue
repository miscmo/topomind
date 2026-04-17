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
      <button v-if="!leftPanel.open" id="btn-toggle-style" class="visible" @click="leftPanel.open = true" title="展开面板">▶</button>

      <!-- 左侧面板：样式/ Git 标签页 -->
      <div v-if="leftPanel.open" id="left-panel-container"
        :style="{ width: leftPanelWidth + 'px', flexShrink: 0, position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 5 }">
        <!-- 面板 Header + Tab 切换 -->
        <div id="left-panel-header">
          <div id="left-panel-tabs">
            <button class="left-panel-tab" :class="{ active: activeLeftTab === 'style' }" @click="activeLeftTab = 'style'">样式</button>
            <button class="left-panel-tab" :class="{ active: activeLeftTab === 'git' }" @click="activeLeftTab = 'git'">Git</button>
          </div>
          <button id="btn-collapse-left-panel" @click="leftPanel.open = false" title="收起">◀</button>
        </div>
        <!-- 面板内容 -->
        <div id="left-panel-body">
          <StylePanel v-show="activeLeftTab === 'style'"
            :selectedNodeId="appStore.selectedNodeId"
            :cy="graph.cy.value"
            @collapse="leftPanel.open = false"
            @update-style="graph.updateNodeStyle"
            @update-font-style="graph.updateNodeFontStyle"
          />
          <GitPanel v-show="activeLeftTab === 'git'" :inline="true" />
        </div>
      </div>

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
        @doc-changed="graph.refreshNodeBadge"
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
import { useGitStore } from '@/stores/git'
import { useGraph } from '@/composables/useGraph'
import { useGrid } from '@/composables/useGrid'
import { useResizeDrag } from '@/composables/useResizeDrag'
import { useStorage, saveIndicatorVisible, saveFailed } from '@/composables/useStorage'
import { usePanelState } from '@/composables/usePanelState.js'

import StylePanel from '@/components/StylePanel.vue'
import DetailPanel from '@/components/DetailPanel.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import GitPanel from '@/components/GitPanel.vue'
import { logger } from '@/core/logger.js'


const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const gitStore = useGitStore()
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
const activeLeftTab = ref('style') // 'style' | 'git'
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

function saveUiToActiveTab(patch = {}) {
  const tab = roomStore.activeTab
  if (!tab) return
  if (!tab.ui) tab.ui = {}
  tab.ui = { ...tab.ui, ...patch }
}

function syncUiFromActiveTab() {
  const tab = roomStore.activeTab
  if (!tab) return

  const ui = tab.ui || {}

  // 详情面板状态优先从 localStorage 恢复（跨 tab 重启持久化），
  // 其次读 tab.ui，最后用默认值
  const persistedDetailState = panelState.readPersistedDetailPanelState()

  leftPanel.open = persistedDetailState?.leftPanelOpen ?? ui.leftPanelOpen ?? true

  detailPanel.open = persistedDetailState?.detailPanelOpen ?? ui.detailPanelOpen ?? true

  const persistedStyleWidth = panelState.readPersistedStyleWidth()
  const restoredStyleWidth = persistedStyleWidth ?? ui.leftPanelWidth ?? leftPanelWidth.value
  leftPanelWidth.value = panelState.clampStyleWidth(restoredStyleWidth)

  const persistedWidth = panelState.readPersistedDetailWidth()
  // 跨重启优先使用持久化宽度，避免 tab.ui 的默认值覆盖用户上次调整
  const restoredWidth = persistedWidth ?? ui.detailPanelWidth ?? detailPanelWidth.value
  detailPanelWidth.value = panelState.clampDetailWidth(restoredWidth)

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
const panelState = usePanelState(() => roomStore.currentKBPath)
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
  clearTimeout(_roomWatchTimer)
})

let _roomWatchTimer = null

// 切换标签页时重新加载房间（带防抖）
watch(() => roomStore.currentRoomPath, async (newPath) => {
  if (!newPath || !graph.cy.value) return

  // 清除之前的定时器
  clearTimeout(_roomWatchTimer)
  _roomWatchTimer = setTimeout(async () => {
    try {
      initPhase.value = 'room'
      await graph.loadRoom(newPath)
      initPhase.value = 'ready'
    } catch (e) {
      initPhase.value = 'error'
      initError.value = e?.message || '切换房间失败'
      logger.warn('GraphView', '切换房间加载失败:', newPath, e)
    }
  }, 300) // 防抖 300ms
})

watch(() => roomStore.activeTabId, () => {
  syncUiFromActiveTab()
}, { immediate: true })

watch(() => leftPanel.open, (v) => {
  saveUiToActiveTab({ leftPanelOpen: !!v })
  panelState.persistDetailPanelState({ leftPanelOpen: !!v })
})

watch(() => leftPanelWidth.value, (v) => {
  saveUiToActiveTab({ leftPanelWidth: panelState.clampStyleWidth(v) })
  panelState.persistStyleWidth(v)
})

watch(() => detailPanel.open, (v) => {
  saveUiToActiveTab({ detailPanelOpen: !!v })
  panelState.persistDetailPanelState({ detailPanelOpen: !!v })
})

watch(() => detailPanelWidth.value, (v) => {
  saveUiToActiveTab({ detailPanelWidth: panelState.clampDetailWidth(v) })
  panelState.persistDetailWidth(v)
  panelState.persistDetailPanelState({ detailPanelWidth: panelState.clampDetailWidth(v) })
})

watch(() => appStore.selectedNodeId, (v) => {
  saveUiToActiveTab({ selectedNodeId: v || null })
  panelState.persistDetailPanelState({ selectedNodeId: v || null })
})

watch(() => appStore.edgeMode, (v) => {
  saveUiToActiveTab({ edgeMode: !!v })
})

watch(() => appStore.edgeModeSourceId, (v) => {
  saveUiToActiveTab({ edgeModeSourceId: v || null })
})

// 切换到 Git Tab 时自动打开 gitStore
watch(activeLeftTab, (tab) => {
  if (tab === 'git') {
    gitStore.openForKB(gitStore.kbPath || roomStore.currentKBPath || '')
  }
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
    logger.catch('GraphView', 'mounted 初始化', e)
  }
}

function retryInit() {
  clearTimeout(_initGridTimer)
  if (graph.cy.value) {
    graph.cy.value.destroy()
    graph.cy.value = null
  }
  initializeGraphView()
}

// 注意：beforeunload 是同步事件，浏览器不会等待 async/Promise 完成。
// flushEdit() 和 saveLayout() 以 fire-and-forget 方式调用，数据最多丢失 1 秒（debouncedSave 间隔）。
// 真正的安全网是 debouncedSave（每 1 秒自动保存）。
async function handleBeforeUnload() {
  // 先保存正在编辑的 Markdown 内容
  detailPanelRef.value?.flushEdit()
  const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
  if (!dirPath) return
  try {
    const meta = await graph.buildCurrentMeta()
    if (meta) {
      // 使用异步保存而非 sendSync，确保数据完整写入
      storage.saveLayout(dirPath, meta)
    }
  } catch (e) {
    logger.catch('GraphView', '保存布局', e)
  }
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
    case 'delete-all': {
      const count = graph.cy.value?.nodes().length || 0
      const ok = await modalStore.showConfirm(`确定删除当前房间的全部 ${count} 个节点？此操作不可撤销。`)
      if (ok) await graph.deleteAllNodes()
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
  useResizeDrag(
    e,
    appLayoutRef.value,
    leftPanelWidth.value,
    panelState.clampStyleWidth,
    (width) => Math.max(0, width),
    (width) => {
      leftPanelWidth.value = width
      saveUiToActiveTab({ leftPanelWidth: width })
      panelState.persistStyleWidth(width)
    },
    styleResizeState,
    -1, // drag right = expand (clientX increases → width increases)
  )
}

function startDetailResize(e) {
  const container = appLayoutRef.value
  useResizeDrag(
    e,
    container,
    detailPanelWidth.value,
    panelState.clampDetailWidth,
    (width) => Math.max(0, container.getBoundingClientRect().width - width),
    (width) => {
      detailPanelWidth.value = width
      panelState.persistDetailWidth(width)
      saveUiToActiveTab({ detailPanelWidth: width })
    },
    detailResizeState,
    1, // drag left = expand (clientX decreases → width increases)
  )
}
</script>

<style>
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

#left-panel-container {
  display: flex;
  flex-direction: column;
  background: #fafbfc;
  border-right: 1px solid #e8ecf0;
  overflow: hidden;
}

#left-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 4px;
  height: 36px;
  border-bottom: 1px solid #e8ecf0;
  background: #fafbfc;
  flex-shrink: 0;
}

#left-panel-tabs {
  display: flex;
  gap: 2px;
}

.left-panel-tab {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #7b8794;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.left-panel-tab:hover {
  background: #eef1f5;
  color: #4a5568;
}

.left-panel-tab.active {
  background: #1a3a5c;
  color: #fff;
}

#btn-collapse-left-panel {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #999;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

#btn-collapse-left-panel:hover {
  background: #e8ecf0;
  color: #333;
}

#left-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

</style>
