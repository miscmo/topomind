<!-- 图谱主页面：左侧样式面板 + 中间图谱 + 右侧详情 -->
<template>
  <div id="graph-page">
    <div id="app-layout">

      <!-- 展开按钮（样式面板收起时） -->
      <button v-if="!stylePanel.open" id="btn-toggle-style" @click="stylePanel.open = true" title="展开样式">▶</button>

      <!-- 左侧样式面板 -->
      <StylePanel
        v-if="stylePanel.open"
        :selectedNodeId="appStore.selectedNodeId"
        :cy="graph.cy.value"
        @update-style="graph.updateNodeStyle"
        @update-font-style="graph.updateNodeFontStyle"
        @collapse="stylePanel.open = false"
      />

      <!-- 中间图谱 -->
      <div id="graph-panel">
        <!-- 网格背景 -->
        <canvas ref="gridCanvasRef" id="grid-canvas" class="grid-bg"></canvas>

        <!-- Cytoscape 容器 -->
        <div ref="cyContainerRef" id="cy"></div>

        <!-- 节点徽标层 -->
        <div id="node-badges-layer"></div>

        <!-- 顶部标题 -->
        <div id="header">{{ currentTitle }}</div>

        <!-- 面包屑 -->
        <Breadcrumb
          v-if="roomStore.currentRoomPath && roomStore.currentRoomPath !== roomStore.currentKBPath"
          :crumbs="roomStore.breadcrumbs"
          @jump="graph.jumpToBreadcrumb"
          @go-root="graph.goRoot"
        />

        <!-- 图例 -->
        <div id="legend">
          <h4>关系</h4>
          <div class="legend-item"><span class="legend-line" style="background:#5cb85c"></span> 演进</div>
          <div class="legend-item"><span class="legend-line" style="background:#e8913a"></span> 依赖</div>
          <div class="legend-item"><span class="legend-dash" style="border-color:#bbb"></span> 相关</div>
        </div>

        <!-- 搜索框 -->
        <div id="search-box">
          <input
            id="search-input"
            type="text"
            placeholder="搜索..."
            v-model="searchQuery"
            @input="graph.applySearch(searchQuery)"
          />
        </div>

        <!-- 缩放指示 -->
        <div id="zoom-indicator">{{ graph.zoomLevel.value }}%</div>

        <!-- 缩放控制 -->
        <div id="controls">
          <button @click="graph.zoomIn()">＋</button>
          <button @click="graph.zoomOut()">－</button>
          <button @click="graph.fitView()">⊡</button>
        </div>

        <!-- 工具栏 -->
        <div id="toolbar">
          <button @click="promptAddCard">＋ 卡片</button>
          <button @click="startEdgeMode" :class="{ active: appStore.edgeMode }">⤯ 连线</button>
          <div class="sep"></div>
          <button id="btn-toggle-grid" :class="{ active: gridVisible }" @click="toggleGrid">⊞</button>
          <div class="sep"></div>
          <button @click="graph.exportPNG()">↓ 导出</button>
          <button @click="graph.fitView()">↺ 重置</button>
          <div class="sep"></div>
          <button @click="openGit">
            ⎇ Git<span v-if="gitStore.hasDirtyFiles" class="git-dot"></span>
          </button>
        </div>

        <!-- 保存指示器 -->
        <div id="save-indicator" :class="{ visible: saveIndicatorVisible }">✓ 已保存</div>

        <!-- 连线模式提示 -->
        <div id="edge-mode-hint" :class="{ active: appStore.edgeMode }">
          <span>🔗 连线模式：点击目标节点</span>
          <button @click="appStore.exitEdgeMode()">取消</button>
        </div>

        <!-- 快捷键提示 -->
        <div id="shortcut-hint">右键拖拽画布 · 左键框选 · Tab 子卡片 · Delete 删除 · Backspace 返回</div>
      </div>

      <!-- 右侧详情面板 -->
      <button v-if="!detailPanel.open" id="btn-toggle-detail" @click="detailPanel.open = true" title="展开详情">◀</button>
      <div v-if="detailPanel.open" id="detail-resize-handle" @mousedown="startDetailResize"></div>
      <DetailPanel
        v-if="detailPanel.open"
        :nodeId="appStore.selectedNodeId"
        @collapse="detailPanel.open = false"
        @delete="handleDeleteFromDetail"
        @rename="handleRenameFromDetail"
      />

    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      :menu="graph.contextMenu.value"
      :edgeMode="appStore.edgeMode"
      @close="graph.contextMenu.value.type = null"
      @action="handleContextAction"
    />

    <!-- Git 面板 -->
    <GitPanel v-if="gitStore.isOpen" />

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useGitStore } from '@/stores/git'
import { useGraph } from '@/composables/useGraph'
import { useStorage, saveIndicatorVisible } from '@/composables/useStorage'

import StylePanel from '@/components/StylePanel.vue'
import DetailPanel from '@/components/DetailPanel.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import GitPanel from '@/components/GitPanel.vue'

const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const gitStore = useGitStore()
const storage = useStorage()

// DOM 引用
const cyContainerRef = ref(null)
const gridCanvasRef = ref(null)

// 面板状态
const stylePanel = ref({ open: true })
const detailPanel = ref({ open: true })
const gridVisible = ref(true)
const searchQuery = ref('')

// 初始化 useGraph（图谱引擎）
const graph = useGraph(cyContainerRef)

// 计算当前标题
const currentTitle = computed(() => {
  if (!roomStore.currentRoomPath || roomStore.currentRoomPath === roomStore.currentKBPath) {
    return roomStore.pathNameMap[roomStore.currentKBPath] || roomStore.currentKBPath?.split('/').pop() || 'TopoMind'
  }
  return roomStore.pathNameMap[roomStore.currentRoomPath] || roomStore.currentRoomPath?.split('/').pop() || ''
})

// ─── 生命周期 ────────────────────────────────────────────────
onMounted(async () => {
  await nextTick()
  graph.initCy()

  // 加载当前房间
  if (roomStore.currentRoomPath) {
    await graph.loadRoom(roomStore.currentRoomPath)
  }

  // 键盘事件
  document.addEventListener('keydown', graph.handleKeydown)

  // 退出前同步保存
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  document.removeEventListener('keydown', graph.handleKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

// 切换标签页时重新加载房间
watch(() => roomStore.currentRoomPath, async (newPath) => {
  if (newPath && graph.cy.value) {
    await graph.loadRoom(newPath)
  }
})

function handleBeforeUnload() {
  const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
  if (!dirPath) return
  const meta = graph.buildCurrentMeta()
  if (meta) storage.saveLayoutSync(dirPath, meta)
}

// ─── 工具栏操作 ─────────────────────────────────────────────
async function promptAddCard() {
  const name = await modalStore.showInput('新建卡片', '卡片名称...')
  if (name) {
    const center = graph.cy.value?.extent()
    const pos = center ? { x: (center.x1 + center.x2) / 2, y: (center.y1 + center.y2) / 2 } : undefined
    await graph.addCard(name, pos)
  }
}

function startEdgeMode() {
  if (!appStore.selectedNodeId) return
  appStore.enterEdgeMode(appStore.selectedNodeId)
}

function toggleGrid() {
  gridVisible.value = !gridVisible.value
  // TODO: 通知 grid composable
}

function openGit() {
  gitStore.openForKB(roomStore.currentKBPath)
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
      detailPanel.value.open = true
      break
    case 'delete': {
      const node = graph.cy.value.getElementById(payload.nodeId)
      const ok = await modalStore.showConfirm(`确定删除节点「${node.data('label')}」？`)
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
      const selected = graph.cy.value.nodes(':selected')
      const ok = await modalStore.showConfirm(`确定删除选中的 ${selected.length} 个节点？`)
      if (ok) await graph.batchDelete(selected.map(n => n.id()))
      break
    }
    case 'batch-color':
      graph.batchSetColor(payload.color)
      break
  }
  graph.contextMenu.value.type = null
}

// ─── 详情面板操作 ────────────────────────────────────────────
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

// ─── 详情面板拖动调整宽度 ────────────────────────────────────
function startDetailResize(e) {
  // 简单的拖动调整宽度实现
  const startX = e.clientX
  const panel = document.getElementById('detail-panel')
  const startWidth = panel?.offsetWidth || 340
  const onMove = (ev) => {
    const diff = startX - ev.clientX
    if (panel) panel.style.width = Math.max(200, Math.min(600, startWidth + diff)) + 'px'
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
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
</style>
