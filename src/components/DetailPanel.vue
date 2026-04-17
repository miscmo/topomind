<!-- 右侧详情面板：Markdown 渲染 + 编辑 -->
<template>
  <div id="detail-panel">
    <div id="detail-title">
      <button id="btn-collapse-detail" @click="$emit('collapse')" title="收起详情">▶</button>
      <div class="detail-title-main">
        <span class="detail-title-text">{{ nodeLabel || '知识详情' }}</span>
        <span class="detail-title-sub">阅读 / 编辑 / 预览</span>
      </div>
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
      <!-- 阅读模式：渲染 Markdown，图片异步加载 -->
      <div v-show="mode === 'read'" class="read-mode-wrap">
        <teleport to="body">
          <button
            v-if="tocItems.length > 0 && !tocOpen"
            class="toc-icon-toggle"
            :style="tocAnchorStyle"
            title="显示目录"
            @click="tocOpen = true"
            aria-label="显示目录"
          >
            <span class="toc-icon" aria-hidden="true">
              <i></i><i></i><i></i>
            </span>
          </button>
        </teleport>

        <div
          class="rendered-content"
          ref="renderedRef"
          v-html="renderedHtml"
          @click="handleRenderedClick"
          @mousedown.prevent
        ></div>
      </div>

      <teleport to="body">
        <div v-if="tocOpen && tocItems.length > 0" class="toc-float-panel" :style="tocPanelStyle" @mousedown.stop>
          <div class="toc-float-header">
            <span>目录</span>
            <button class="toc-float-close" @click="tocOpen = false">×</button>
          </div>
          <div class="toc-float-body">
            <button
              v-for="item in tocItems"
              :key="item.id"
              class="toc-item"
              :class="[ `level-${item.level}`, { active: activeTocId === item.id } ]"
              @mousedown="handleTocMouseDown"
              @click.stop="handleTocClick(item.id)"
            >
              {{ item.text }}
            </button>
          </div>
        </div>
      </teleport>

      <!-- 编辑模式：CodeMirror Markdown 编辑器（常驻，避免切换重建） -->
      <div v-show="mode === 'edit'" class="md-editor-wrap">
        <div ref="cmEditorRef" class="md-editor-cm"></div>
      </div>
    </div>

    <div v-if="previewVisible" class="image-preview-mask" @click="closeImagePreview" @wheel.prevent="handlePreviewWheel">
      <div class="image-preview-tip">滚轮可缩放，点击空白处关闭</div>
      <img
        class="image-preview-full"
        :src="previewSrc"
        :style="{ transform: `scale(${previewScale})` }"
        alt="preview"
        @click.stop
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { marked } from 'marked'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { GFM } from '@lezer/markdown'
import { useStorage, showSaveIndicator } from '@/composables/useStorage'
import { useRoomStore } from '@/stores/room'
import { logger } from '@/core/logger.js'
import { GitCache } from '@/core/git-backend.js'

marked.setOptions({ breaks: true, gfm: true })

const props = defineProps({ nodeId: { type: String, default: null } })
const emit = defineEmits(['collapse', 'delete', 'rename', 'drill', 'doc-changed'])

const storage = useStorage()
const roomStore = useRoomStore()

const mode = ref('read')
const markdownRaw = ref('')
const editContent = ref('')
const childCards = ref([])
const tocItems = ref([])
const tocOpen = ref(false)
const activeTocId = ref('')
const bodyRef = ref(null)
const renderedRef = ref(null)
const cmEditorRef = ref(null)
const previewVisible = ref(false)
const previewSrc = ref('')
const previewScale = ref(1)

let _cmView = null

// 竞态保护版本号
let _version = 0
let _modeVersion = 0
let _prevRenderedEl = null
// Object URL 追踪
let _activeUrls = []

const nodeLabel = computed(() => {
  // 依赖 _pathNameMapVersion 以响应节点改名事件
  void roomStore._pathNameMapVersion
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
      childInfo += `<span class="child-tag" data-drill-path="${escHtml(kid.path).replace(/"/g, '&quot;')}">${escHtml(kid.name || '')}</span>`
    })
    childInfo += '</div>'
  }
  const md = markdownRaw.value
  let parsed = ''
  if (md) {
    try { parsed = marked.parse(md) } catch { parsed = '' }
  }
  const html = parsed ? sanitizeHtml(parsed) : '<div class="placeholder-text" style="color:#bbb;margin-top:20px">暂无文档内容</div>'
  return html + childInfo
})

function buildTocItems() {
  const container = renderedRef.value
  if (!container) {
    tocItems.value = []
    return
  }
  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  const seen = new Map()
  tocItems.value = headings.map((h, idx) => {
    const level = Number(h.tagName.slice(1)) || 1
    const text = (h.textContent || '').trim()
    const slug = (text || `heading-${idx + 1}`)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-\u4e00-\u9fa5]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `heading-${idx + 1}`
    const count = (seen.get(slug) || 0) + 1
    seen.set(slug, count)
    const id = count > 1 ? `${slug}-${count}` : slug
    h.id = id
    return { id, text, level }
  }).filter(item => item.text)
  if (tocItems.value.length > 0 && !activeTocId.value) {
    activeTocId.value = tocItems.value[0].id
  }
}

function scrollToHeading(id) {
  const container = renderedRef.value
  if (!container || !id) return
  const target = container.querySelector(`[id="${CSS.escape(id)}"]`)
  if (!target) return
  activeTocId.value = id
  target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  requestAnimationFrame(() => {
    tocOpen.value = true
  })
}

function handleTocClick(id) {
  scrollToHeading(id)
}

function handleTocMouseDown(e) {
  e.preventDefault()
}

function updateActiveHeading() {
  const content = renderedRef.value
  const body = bodyRef.value
  if (!content || !body) return
  const headings = Array.from(content.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  if (!headings.length) {
    activeTocId.value = ''
    return
  }

  const probeTop = body.scrollTop + 120
  let current = headings[0]

  for (const heading of headings) {
    const headingTop = heading.offsetTop
    if (headingTop <= probeTop) {
      current = heading
    } else {
      break
    }
  }

  activeTocId.value = current.id || ''
}

const tocAnchorStyle = computed(() => {
  const body = bodyRef.value
  if (!body) return {}
  const rect = body.getBoundingClientRect()
  return {
    top: `${Math.max(56, Math.round(rect.top + 12))}px`,
    right: `${Math.max(12, Math.round(window.innerWidth - rect.right + 12))}px`,
  }
})

const tocPanelStyle = computed(() => {
  const body = bodyRef.value
  if (!body) return {}
  const rect = body.getBoundingClientRect()
  return {
    top: `${Math.max(56, Math.round(rect.top + 12))}px`,
    right: `${Math.max(12, Math.round(window.innerWidth - rect.right + 12))}px`,
  }
})

function _ensureEditorView(initialDoc = '') {
  if (!cmEditorRef.value) return

  // 阅读/编辑切换会销毁 v-else 下的 DOM，旧实例可能还在内存但已脱离文档
  if (_cmView && !_cmView.dom.isConnected) {
    _cmView.destroy()
    _cmView = null
  }

  if (_cmView) return

  _cmView = new EditorView({
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        lineNumbers(),
        drawSelection(),
        highlightActiveLine(),
        markdown({
          base: markdownLanguage,
          extensions: [GFM],
          codeLanguages: languages,
        }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        cmPlaceholder('输入 Markdown...（可粘贴或拖入图片）'),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste: (event) => {
            void handlePaste(event)
            return false
          },
          drop: (event) => {
            void handleDrop(event)
            return false
          },
          dragover: (event) => {
            event.preventDefault()
            return true
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const value = update.state.doc.toString()
          editContent.value = value
          debouncedSave()
        }),
      ],
    }),
    parent: cmEditorRef.value,
  })
}

function _setEditorDoc(text = '') {
  if (!_cmView) return
  const current = _cmView.state.doc.toString()
  if (current === text) return
  _cmView.dispatch({
    changes: { from: 0, to: current.length, insert: text },
  })
}

// 切换节点时重新加载
watch(() => props.nodeId, async (newId) => {
  if (!newId) { reset(); return }
  await loadNodeContent(newId)
}, { immediate: true })

async function loadNodeContent(cardPath) {
  // 先切回阅读模式（不要在这里 flush：避免先把空 editContent 覆盖掉磁盘文档）
  mode.value = 'read'
  tocOpen.value = false

  _revokeActiveUrls()
  const version = ++_version

  const [kids, md] = await Promise.all([
    storage.listCards(cardPath).catch(() => []),
    storage.readMarkdown(cardPath).catch(() => ''),
  ])

  if (version !== _version) return // 已切换到其他节点

  childCards.value = kids || []
  markdownRaw.value = md || ''
  editContent.value = md || ''
  _setEditorDoc(editContent.value)

  if (bodyRef.value) bodyRef.value.scrollTop = 0

  // 异步解析渲染内容中的图片（等 DOM 更新后）
  await nextTick()
  buildTocItems()
  updateActiveHeading()
  _resolveRenderedImages(cardPath, version)
}

async function setMode(m) {
  const token = ++_modeVersion

  if (m === 'edit') {
    await flushEdit() // 先保存当前（如果在编辑中）
    const md = await storage.readMarkdown(props.nodeId).catch(() => '')
    // 丢弃过期的模式切换结果
    if (token !== _modeVersion || props.nodeId == null) return
    editContent.value = md || ''
    mode.value = 'edit'
    await nextTick()
    _ensureEditorView(editContent.value)
    _setEditorDoc(editContent.value)
    _cmView?.focus()
  } else {
    await flushEdit()
    if (token !== _modeVersion) return
    mode.value = 'read'
    if (props.nodeId) await loadNodeContent(props.nodeId)
  }
}

async function flushEdit() {
  if (mode.value === 'edit' && props.nodeId && editContent.value !== undefined) {
    await storage.writeMarkdown(props.nodeId, editContent.value)
    showSaveIndicator()
    if (roomStore.currentKBPath) GitCache.markDirty(roomStore.currentKBPath)
    // 通知图谱刷新节点文档图标
    emit('doc-changed', props.nodeId)
  }
}

// 防抖自动保存（编辑模式）
let _saveTimer = null
function debouncedSave() {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => { void flushEdit() }, 1000)
}


onUnmounted(() => {
  clearTimeout(_saveTimer)
  if (_cmView) {
    _cmView.destroy()
    _cmView = null
  }
  if (_prevRenderedEl) {
    _prevRenderedEl.removeEventListener('scroll', updateActiveHeading)
    _prevRenderedEl = null
  }
})

// ─── 图片上传（paste / drop）────────────────────────────────
async function handlePaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (blob) await _insertImage(blob)
      return
    }
  }
}

async function handleDrop(e) {
  const files = e.dataTransfer?.files
  if (!files?.length) return
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      await _insertImage(file)
    }
  }
}

async function _insertImage(blob) {
  if (!props.nodeId) return
  const ext = (blob.name || blob.type.split('/')[1] || 'png').split('.').pop()
  const filename = `img-${Date.now()}.${ext}`
  try {
    const result = await storage.saveImage(props.nodeId, blob, filename)
    const mdRef = `![](${result.markdownRef})`

    if (_cmView) {
      const range = _cmView.state.selection.main
      _cmView.dispatch({
        changes: { from: range.from, to: range.to, insert: mdRef },
        selection: { anchor: range.from + mdRef.length },
        scrollIntoView: true,
      })
      _cmView.focus()
      return
    }

    editContent.value += (editContent.value ? '\n' : '') + mdRef
    debouncedSave()
  } catch (err) {
    logger.catch('DetailPanel', '图片上传', err)
  }
}

// ─── 图片异步解析（阅读模式）────────────────────────────────
async function _resolveRenderedImages(cardPath, version) {
  const container = renderedRef.value
  if (!container) return
  const imgs = container.querySelectorAll('img')
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('images/')) continue
    const imgPath = cardPath + '/' + src
    img.style.opacity = '0.3'
    try {
      const url = await storage.loadImage(imgPath)
      if (version !== _version) {
        if (url) try { URL.revokeObjectURL(url) } catch (e) {}
        return
      }
      if (url) _activeUrls.push(url)
      if (url) {
        img.src = url
        img.style.opacity = '1'
      } else {
        img.alt = '[图片加载失败]'
        img.style.opacity = '1'
      }
    } catch (e) {
      img.alt = '[图片加载失败]'
      img.style.opacity = '1'
    }
  }
}

// 处理渲染内容中的点击（图片预览 / 外链打开 / 子卡片标签）
function handleRenderedClick(e) {
  const img = e.target.closest('img')
  if (img && img.getAttribute('src')) {
    previewSrc.value = img.getAttribute('src')
    previewScale.value = 1
    previewVisible.value = true
    return
  }

  const link = e.target.closest('a[href]')
  if (link) {
    const href = (link.getAttribute('href') || '').trim()
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      // Electron：系统默认浏览器；Web：新标签页打开
      if (window.electronAPI?.invoke) {
        window.electronAPI.invoke('app:openExternal', href).catch((err) => {
          logger.catch('DetailPanel', '打开外链', err)
        })
      } else {
        window.open(href, '_blank', 'noopener,noreferrer')
      }
      return
    }
  }

  const tag = e.target.closest('[data-drill-path]')
  if (tag) emit('drill', tag.dataset.drillPath)
}

function closeImagePreview() {
  previewVisible.value = false
  previewSrc.value = ''
  previewScale.value = 1
}

function handlePreviewWheel(e) {
  const step = e.deltaY < 0 ? 0.1 : -0.1
  const next = previewScale.value + step
  previewScale.value = Math.min(4, Math.max(0.2, Number(next.toFixed(2))))
}


function reset() {
  mode.value = 'read'
  markdownRaw.value = ''
  editContent.value = ''
  childCards.value = []
  tocItems.value = []
  tocOpen.value = false
  activeTocId.value = ''
  _revokeActiveUrls()
}

function _revokeActiveUrls() {
  _activeUrls.forEach(url => { try { URL.revokeObjectURL(url) } catch (e) {} })
  _activeUrls = []
}

function sanitizeHtml(dirty) {
  if (!dirty) return ''
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(dirty, 'text/html')
    // 遍历所有节点，清除危险属性和危险元素
    const dangerous = ['script', 'iframe', 'object', 'embed', 'link', 'style', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select']
    const dangerousTags = doc.querySelectorAll(dangerous.join(','))
    dangerousTags.forEach(el => el.remove())

    // 清除所有 on* 事件属性和 javascript: href
    const allEls = doc.body.querySelectorAll('*')
    allEls.forEach(el => {
      const attrs = [...el.attributes]
      attrs.forEach(attr => {
        if (attr.name.startsWith('on') || /^javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name)
        }
      })
      // 降级 data: 和 javascript: href
      const href = el.getAttribute?.('href')
      if (href) {
        const h = href.trim()
        if (/^(javascript:|data:)/i.test(h)) el.setAttribute('href', '#')
      }
    })
    return doc.body.innerHTML
  } catch {
    return ''
  }
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

watch(renderedHtml, async () => {
  await nextTick()
  buildTocItems()
  updateActiveHeading()
})

watch(() => bodyRef.value?.scrollTop, () => {
  updateActiveHeading()
}, { flush: 'post' })

watch(tocOpen, async (open) => {
  if (open) {
    await nextTick()
    updateActiveHeading()
  }
})

watch(() => mode.value, (m) => {
  if (m !== 'read') tocOpen.value = false
})

watch(renderedRef, (el) => {
  if (_prevRenderedEl) {
    _prevRenderedEl.removeEventListener('scroll', updateActiveHeading)
  }
  if (el) {
    el.addEventListener('scroll', updateActiveHeading, { passive: true })
  }
  _prevRenderedEl = el || null
})

// 暴露 flushEdit 给父组件调用（路由切换时）
defineExpose({ flushEdit })
</script>

<style>
#detail-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-left: 1px solid #e8ecf0;
  box-shadow: -2px 0 8px rgba(0,0,0,.03);
}

.read-mode-wrap {
  position: relative;
  height: 100%;
}

.toc-icon-toggle {
  position: fixed;
  z-index: 40;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 18px rgba(26, 58, 92, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.toc-icon {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}

.toc-icon i {
  display: block;
  width: 14px;
  height: 2px;
  background: #1a3a5c;
  border-radius: 999px;
}

.toc-float-panel {
  position: fixed;
  z-index: 39;
  width: 280px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  border: 1px solid #dce3ea;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  overflow: hidden;
}

.toc-float-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #edf2f7;
  font-size: 13px;
  font-weight: 700;
  color: #243447;
}

.toc-float-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: #f3f6fa;
  cursor: pointer;
}

.toc-float-body {
  padding: 8px;
  overflow: auto;
}

.toc-item {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: #334155;
  cursor: pointer;
}

.toc-item:hover {
  background: #eef4fb;
}

.toc-item.active {
  background: #e8f0fb;
  color: #1a3a5c;
  font-weight: 700;
}

.toc-item.level-2 { padding-left: 18px; }
.toc-item.level-3 { padding-left: 28px; font-size: 11px; }
.toc-item.level-4 { padding-left: 38px; font-size: 11px; }
.toc-item.level-5 { padding-left: 48px; font-size: 11px; }
.toc-item.level-6 { padding-left: 58px; font-size: 11px; }
</style>
