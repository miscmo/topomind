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
      <div
        v-show="mode === 'read'"
        class="rendered-content"
        ref="renderedRef"
        v-html="renderedHtml"
        @click="handleRenderedClick"
        @mousedown.prevent
      ></div>

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
import { GitCache } from '@/core/git-backend.js'

marked.setOptions({ breaks: true, gfm: true })

const props = defineProps({ nodeId: { type: String, default: null } })
const emit = defineEmits(['collapse', 'delete', 'rename', 'drill'])

const storage = useStorage()
const roomStore = useRoomStore()

const mode = ref('read')
const markdownRaw = ref('')
const editContent = ref('')
const childCards = ref([])
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
    ? sanitizeHtml(marked.parse(md))
    : '<div class="placeholder-text" style="color:#bbb;margin-top:20px">暂无文档内容</div>'
  return html + childInfo
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
    console.error('[DetailPanel] 图片上传失败:', err)
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
      if (url) {
        _activeUrls.push(url)
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
          console.error('[DetailPanel] 打开外链失败:', err)
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
    const dangerous = ['script', 'iframe', 'object', 'embed', 'link', 'style', 'svg', 'math']
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

// 暴露 flushEdit 给父组件调用（路由切换时）
defineExpose({ flushEdit })
</script>
