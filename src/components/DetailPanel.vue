<!-- 右侧详情面板：Markdown 渲染 + 编辑 -->
<template>
  <div id="detail-panel">
    <div id="detail-title">
      <button id="btn-collapse-detail" @click="$emit('collapse')" title="收起详情">▶</button>
      <span class="detail-title-text">{{ nodeLabel || '知识详情' }}</span>
    </div>

    <div v-if="nodeId" id="detail-actions">
      <button @click="$emit('rename', nodeId)">⚙ 改名</button>
      <button @click="$emit('delete', nodeId)">🗑 删除</button>
      <div id="detail-mode-toggle" class="visible">
        <button :class="{ active: mode === 'read' }" @click="setMode('read')">阅读</button>
        <button :class="{ active: mode === 'edit' }" @click="setMode('edit')">编辑</button>
      </div>
    </div>

    <div id="detail-body" ref="bodyRef">
      <!-- 阅读模式 -->
      <div v-if="mode === 'read'" class="rendered-content" v-html="renderedHtml" @click="handleRenderedClick"></div>

      <!-- 编辑模式 -->
      <textarea
        v-else
        id="detail-edit-area"
        class="active"
        v-model="editContent"
        placeholder="输入 Markdown..."
        @input="debouncedSave"
      ></textarea>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useStorage, showSaveIndicator } from '@/composables/useStorage'
import { useRoomStore } from '@/stores/room'
import { GitCache } from '@/core/git-backend.js'

const props = defineProps({ nodeId: { type: String, default: null } })
const emit = defineEmits(['collapse', 'delete', 'rename', 'drill'])

const storage = useStorage()
const roomStore = useRoomStore()

const mode = ref('read')
const markdownRaw = ref('')
const editContent = ref('')
const childCards = ref([])
const bodyRef = ref(null)

// 竞态保护版本号
let _version = 0
// Object URL 追踪
let _activeUrls = []

const nodeLabel = computed(() => {
  // 从 pathNameMap 获取节点名
  if (!props.nodeId) return ''
  return roomStore.pathNameMap[props.nodeId] || props.nodeId.split('/').pop() || ''
})

const renderedHtml = computed(() => {
  if (!props.nodeId) {
    return '<div class="placeholder-text"><span>📖</span>点击节点查看详情</div>'
  }
  // 子卡片信息
  let childInfo = ''
  if (childCards.value.length > 0) {
    childInfo = `<div class="child-info-box"><strong class="child-info-title">📂 包含 ${childCards.value.length} 个子概念</strong><br>`
    childCards.value.forEach(kid => {
      childInfo += `<span class="child-tag" data-drill-path="${escHtml(kid.path)}">${escHtml(kid.name || '')}</span>`
    })
    childInfo += '</div>'
  }
  const md = markdownRaw.value
  const html = md
    ? sanitizeHtml(window.marked?.parse(md) || md)
    : '<div class="placeholder-text" style="color:#bbb;margin-top:20px">暂无文档内容</div>'
  return html + childInfo
})

// 切换节点时重新加载
watch(() => props.nodeId, async (newId) => {
  if (!newId) { reset(); return }
  await loadNodeContent(newId)
}, { immediate: true })

async function loadNodeContent(cardPath) {
  // 先切回阅读模式
  if (mode.value === 'edit') flushEdit()
  mode.value = 'read'

  _revokeActiveUrls()
  const version = ++_version

  const [kids, md] = await Promise.all([
    storage.listCards(cardPath).catch(() => []),
    storage.readMarkdown(cardPath).catch(() => ''),
  ])

  if (version !== _version) return // 已切换到其他节点

  childCards.value = kids || []
  markdownRaw.value = md || ''

  if (bodyRef.value) bodyRef.value.scrollTop = 0
}

function setMode(m) {
  if (m === 'edit') {
    flushEdit() // 先保存当前（如果在编辑中）
    storage.readMarkdown(props.nodeId).then(md => {
      editContent.value = md || ''
      mode.value = 'edit'
    })
  } else {
    flushEdit()
    mode.value = 'read'
    if (props.nodeId) loadNodeContent(props.nodeId)
  }
}

function flushEdit() {
  if (mode.value === 'edit' && props.nodeId && editContent.value !== undefined) {
    storage.writeMarkdown(props.nodeId, editContent.value)
    showSaveIndicator()
    if (roomStore.currentKBPath) GitCache.markDirty(roomStore.currentKBPath)
  }
}

// 防抖自动保存（编辑模式）
let _saveTimer = null
function debouncedSave() {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => { flushEdit() }, 1000)
}

// 处理渲染内容中的点击（子卡片标签）
function handleRenderedClick(e) {
  const tag = e.target.closest('[data-drill-path]')
  if (tag) emit('drill', tag.dataset.drillPath)
}

function reset() {
  mode.value = 'read'
  markdownRaw.value = ''
  editContent.value = ''
  childCards.value = []
}

function _revokeActiveUrls() {
  _activeUrls.forEach(url => { try { URL.revokeObjectURL(url) } catch (e) {} })
  _activeUrls = []
}

function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"')
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 暴露 flushEdit 给父组件调用（路由切换时）
defineExpose({ flushEdit })
</script>
