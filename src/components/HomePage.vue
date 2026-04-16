<!-- 工作目录主页：当前工作目录下的知识库列表 -->
<template>
  <div id="home-modal">
    <!-- 头部 -->
    <div class="home-header">
      <div class="home-logo">
        <span class="home-logo-icon">🧠</span>
        <div>
          <h1>TopoMind</h1>
          <span>可漫游拓扑知识大脑</span>
        </div>
      </div>
      <div class="home-workdir-bar" v-if="workDir">
        <span class="home-workdir-path" :title="workDir">📂 {{ truncatedWorkDir }}</span>
        <button class="home-workdir-switch" @click="switchWorkDir" title="切换工作目录">切换</button>
      </div>
    </div>

    <!-- 知识库列表 -->
    <div class="home-content">
      <div class="home-section-title">我的知识库</div>
      <div class="home-grid">
        <!-- 知识库卡片 -->
        <div
          v-for="(kb, idx) in kbs"
          :key="kb.path"
          class="home-card"
          :class="{ loading: kb.nodeCount === null && !kb.gitStatus, 'drag-over': dragOverIndex === idx, dragging: dragKBIndex === idx }"
          draggable="true"
          @click="openKB(kb)"
          @dragstart="onKBDragStart($event, idx)"
          @dragover.prevent="onKBDragOver($event, idx)"
          @dragleave="onKBDragLeave"
          @drop.prevent="onKBDrop($event, idx)"
          @dragend="onKBDragEnd"
        >
          <div class="home-card-image">
            <img v-if="kb.coverUrl" :src="kb.coverUrl" />
            <span v-else class="home-card-image-icon">📚</span>
          </div>
          <div class="home-card-body" @contextmenu.prevent="openKBSettings(kb)">
            <button class="home-card-settings-btn" @click.stop="openKBSettings(kb)" title="设置">⚙</button>
            <div class="home-card-title">
              <span>{{ kb.name }}</span>
            </div>
            <div class="home-card-meta">
              <div class="home-card-meta-row">
                <span
                  v-if="kb.gitStatus"
                  :class="['home-meta-pill', 'home-meta-pill--git', `home-meta-pill--${kb.gitStatus.state}`]"
                  :title="gitBadgeTitle(kb.gitStatus)"
                >{{ gitBadgeLabel(kb.gitStatus) }}</span>
              </div>
              <div class="home-card-meta-row">
                <span v-if="kb.nodeCount !== null">📊 {{ kb.nodeCount }} 个节点</span>
                <span v-else class="home-card-loading-skeleton">📊 ··· 个节点</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 新建按钮 -->
        <div class="home-card-add" @click="showCreateForm = true">
          <div class="home-card-add-icon">＋</div>
          <div class="home-card-add-text">新建知识库</div>
        </div>

        <!-- 导入按钮 -->
        <div class="home-card-add" @click="openImportForm">
          <div class="home-card-add-icon">📥</div>
          <div class="home-card-add-text">导入知识库</div>
        </div>
      </div>
    </div>

    <!-- 新建知识库表单 -->
    <div class="home-form-overlay" :class="{ active: showCreateForm }">
      <div class="home-form">
        <div class="home-form-header">
          <h3>新建知识库</h3>
          <button class="home-form-close" @click="cancelCreate">✕</button>
        </div>
        <div class="home-form-body">
          <div class="home-form-group">
            <label>知识库名称</label>
            <input
              ref="nameInputRef"
              type="text"
              v-model="newKB.name"
              placeholder="输入名称..."
              :style="{ borderColor: nameError ? '#e74c3c' : '' }"
              @keydown.enter="submitCreate"
            />
          </div>
          <div class="home-form-group">
            <label>封面图片</label>
            <div
              class="home-image-upload"
              :class="{ 'has-image': newKB.coverBlob }"
              @click="selectCover"
            >
              <template v-if="newKB.coverPreviewUrl">
                <img :src="newKB.coverPreviewUrl" />
                <button class="home-remove-image" @click.stop="removeCover">✕</button>
              </template>
              <template v-else>
                <div class="home-image-upload-text">📷 点击选择封面</div>
                <div class="home-image-upload-hint">可选，不设置使用默认</div>
              </template>
            </div>
            <input ref="coverInputRef" type="file" accept="image/*" style="display:none" @change="coverChanged" />
          </div>
        </div>
        <div class="home-form-footer">
          <button class="home-btn home-btn-cancel" @click="cancelCreate">取消</button>
          <button class="home-btn home-btn-primary" @click="submitCreate">创建</button>
        </div>
      </div>
    </div>

    <!-- 导入知识库表单 -->
    <div class="home-form-overlay" :class="{ active: showImportForm }">
      <div class="home-form">
        <div class="home-form-header">
          <h3>导入知识库</h3>
          <button class="home-form-close" @click="closeImportForm">✕</button>
        </div>
        <div class="home-form-body">
          <div class="home-form-group">
            <label>选择知识库文件夹</label>
            <div v-if="importSelected" class="home-import-selected">
              <template v-if="importSelected.valid">
                <div class="home-import-valid">
                  <span class="home-import-badge">✓ 有效知识库</span>
                  <div class="home-import-info">
                    <span>📁 {{ importSelected.path }}</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="home-import-invalid">
                  <span class="home-import-badge home-import-badge--error">✕ {{ importSelected.error }}</span>
                  <div class="home-import-info">
                    <span>📁 {{ importSelected.path }}</span>
                  </div>
                </div>
              </template>
            </div>
            <button class="home-btn home-btn-cancel" @click="doSelectExistingKB" style="width:100%;padding:10px 14px">
              {{ importSelected ? '重新选择...' : '📂 选择文件夹' }}
            </button>
          </div>
          <div v-if="importError" class="home-import-error">{{ importError }}</div>
        </div>
        <div class="home-form-footer">
          <button class="home-btn home-btn-cancel" @click="closeImportForm">取消</button>
          <button
            class="home-btn home-btn-primary"
            :disabled="!importSelected || !importSelected.valid || importLoading"
            @click="submitImport"
          >
            {{ importLoading ? '导入中...' : '导入' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 封面裁剪弹窗 -->
    <div class="home-form-overlay" :class="{ active: showCoverCrop }">
      <div class="home-form home-crop-form">
        <div class="home-form-header">
          <h3>裁剪封面</h3>
          <button class="home-form-close" @click="cancelCoverCrop">✕</button>
        </div>
        <div class="home-form-body">
          <div class="home-crop-container" @mousedown="onCropMouseDown" @mousemove="onCropMouseMove" @mouseup="onCropMouseUp" @mouseleave="onCropMouseUp">
            <img :src="cropSource.url" class="home-crop-img" />
            <div class="home-crop-overlay">
              <div class="home-crop-box" :style="{ left: (cropRect.x / cropSource.width * 100) + '%', top: (cropRect.y / cropSource.height * 100) + '%', width: (cropRect.w / cropSource.width * 100) + '%', height: (cropRect.h / cropSource.height * 100) + '%' }"></div>
            </div>
          </div>
          <p class="home-crop-hint">拖动选框调整裁剪区域</p>
        </div>
        <div class="home-form-footer">
          <button class="home-btn home-btn-cancel" @click="cancelCoverCrop">取消</button>
          <button class="home-btn home-btn-primary" @click="applyCoverCrop">应用裁剪</button>
        </div>
      </div>
    </div>

    <!-- 知识库设置弹窗 -->
    <div class="home-form-overlay" :class="{ active: showSettingsForm }">
      <div class="home-form">
        <div class="home-form-header">
          <h3>知识库设置</h3>
          <button class="home-form-close" @click="closeKBSettings">✕</button>
        </div>
        <div class="home-form-body">
          <div class="home-form-group">
            <label>知识库名称（显示名）</label>
            <input
              type="text"
              v-model="settingsForm.name"
              placeholder="输入新名称..."
              :style="{ borderColor: settingsNameError ? '#e74c3c' : '' }"
            />
          </div>

          <div class="home-form-group home-kb-advanced">
            <label>高级信息（只读）</label>
            <div class="home-kb-advanced-grid">
              <div class="home-kb-advanced-row">
                <span class="k">目录名</span>
                <span class="v">{{ settingsForm.path || '—' }}</span>
              </div>
              <div class="home-kb-advanced-row">
                <span class="k">完整路径</span>
                <span class="v" :title="settingsFullPath">{{ settingsFullPath || '—' }}</span>
              </div>
              <div class="home-kb-advanced-row">
                <span class="k">创建时间</span>
                <span class="v">{{ formatTime(settingsForm.createdAt) }}</span>
              </div>
              <div class="home-kb-advanced-row">
                <span class="k">节点数量</span>
                <span class="v">{{ settingsForm.nodeCount ?? 0 }}</span>
              </div>
            </div>
          </div>

          <div class="home-form-group">
            <label>封面图片</label>
            <div
              class="home-image-upload"
              :class="{ 'has-image': settingsForm.coverPreviewUrl || settingsForm.keepCurrentCover }"
              @click="selectSettingsCover"
            >
              <template v-if="settingsForm.coverPreviewUrl">
                <img :src="settingsForm.coverPreviewUrl" />
                <button class="home-remove-image" @click.stop="removeSettingsCover">✕</button>
              </template>
              <template v-else>
                <div class="home-image-upload-text">📷 点击更换封面</div>
                <div class="home-image-upload-hint">可选，不改则保留原封面</div>
              </template>
            </div>
            <input ref="settingsCoverInputRef" type="file" accept="image/*" style="display:none" @change="settingsCoverChanged" />
          </div>
        </div>
        <div class="home-form-footer">
          <button class="home-btn home-btn-cancel" @click="closeKBSettings">取消</button>
          <button class="home-btn home-btn-primary" @click="saveKBSettings">保存</button>
          <button class="home-btn home-btn-danger" @click="deleteKBFromSettings">删除知识库</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useStorage } from '@/composables/useStorage'
import { useGit } from '@/composables/useGit'
import { logger } from '@/core/logger.js'

const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const storage = useStorage()
const git = useGit()

// ─── 状态 ──────────────────────────────────────────────────────
const loading = ref(false)
const kbs = ref([])
const workDir = ref('')
const showCreateForm = ref(false)
const nameError = ref(false)
const nameInputRef = ref(null)
const coverInputRef = ref(null)

const showSettingsForm = ref(false)
const settingsNameError = ref(false)
const settingsCoverInputRef = ref(null)
const settingsTargetKB = ref(null)

const showImportForm = ref(false)
const importSelected = ref(null)
const importLoading = ref(false)
const importError = ref(null)

// 知识库拖拽排序状态
const dragKBIndex = ref(-1)
const dragOverIndex = ref(-1)

// 封面裁剪状态
const showCoverCrop = ref(false)
const cropSource = ref({ blob: null, url: null, width: 0, height: 0 })
const cropRect = reactive({ x: 0, y: 0, w: 100, h: 100 })
const cropDragging = ref(false)
const cropDragStart = { x: 0, y: 0 }

const newKB = reactive({
  name: '',
  coverBlob: null,
  coverPreviewUrl: null,
})

const settingsForm = reactive({
  name: '',
  path: '',
  createdAt: null,
  nodeCount: 0,
  coverBlob: null,
  coverPreviewUrl: null,
  keepCurrentCover: false,
})

const settingsFullPath = computed(() => {
  if (!settingsForm.path) return ''
  return workDir.value ? `${workDir.value}/${settingsForm.path}` : settingsForm.path
})

const truncatedWorkDir = computed(() => {
  if (!workDir.value) return ''
  const p = workDir.value
  if (p.length <= 48) return p
  // 显示: 前12字符 + "..." + 后32字符
  return p.slice(0, 12) + '...' + p.slice(-32)
})

// ─── 生命周期 ──────────────────────────────────────────────────
onMounted(() => { loadKBList() })

// ─── 加载知识库列表 ────────────────────────────────────────────
async function loadKBList() {
  loading.value = true
  try {
    const [list, dir] = await Promise.all([storage.listKBs(), storage.getRootDir()])
    workDir.value = dir || ''
    kbs.value = (list || []).map(kb => ({ ...kb, nodeCount: null, gitStatus: null, coverUrl: null }))

    // 并发获取节点数和封面（避免串行 await 导致首页变慢）
    await Promise.all(
      kbs.value.map(async (kb, i) => {
        try {
          const count = await storage.countChildren(kb.path)
          kbs.value[i].nodeCount = count
        } catch (e) { logger.warn('HomePage', '加载节点数失败:', kb.path, e) }

        if (kb.cover) {
          try {
            const imgPath = `${kb.path}/${kb.cover}`
            const url = await storage.loadImage(imgPath)
            kbs.value[i].coverUrl = url
          } catch (e) { logger.warn('HomePage', '加载封面失败:', kb.path, e) }
        }
      })
    )

    // 异步获取 Git 状态
    if (kbs.value.length > 0) {
      const statuses = await git.statusBatch(kbs.value.map(kb => kb.path))
      kbs.value.forEach((kb, i) => {
        kbs.value[i].gitStatus = statuses[kb.path] || { state: 'uninit' }
      })
    }
  } catch (err) {
    logger.catch('HomePage', '加载知识库列表', err)
  } finally {
    loading.value = false
  }
}

// ─── 打开知识库 ────────────────────────────────────────────────
async function openKB(kb) {
  try {
    await storage.setLastOpenedKB(kb.path)
  } catch (e) {
    logger.catch('HomePage', '设置最近打开', e)
  }
  roomStore.openTab(kb.path, kb.name)
  appStore.showGraph()
}

// ─── 在 Finder 中打开 ─────────────────────────────────────────
function openInFinder(kb) {
  storage.openInFinder(kb.path)
}

// ─── 知识库拖拽排序 ───────────────────────────────────────────
function onKBDragStart(e, idx) {
  dragKBIndex.value = idx
  dragOverIndex.value = -1
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(idx))
}

function onKBDragOver(e, idx) {
  if (dragKBIndex.value === -1 || dragKBIndex.value === idx) return
  dragOverIndex.value = idx
  e.dataTransfer.dropEffect = 'move'
}

function onKBDragLeave(e) {
  // 只有真正离开卡片时才清除，不在内部移动时清除
  const rel = e.relatedTarget
  if (!rel || !e.currentTarget.contains(rel)) {
    dragOverIndex.value = -1
  }
}

async function onKBDrop(e, idx) {
  const fromIdx = dragKBIndex.value
  if (fromIdx === -1 || fromIdx === idx) {
    dragKBIndex.value = -1
    dragOverIndex.value = -1
    return
  }
  // 执行排序
  const arr = [...kbs.value]
  const [item] = arr.splice(fromIdx, 1)
  arr.splice(idx, 0, item)
  // 更新 sortOrder
  arr.forEach((kb, i) => { kb.order = i })
  kbs.value = arr
  // 持久化到各 KB 元数据（保留原有 meta，避免覆盖 cover / createdAt 等字段）
  await Promise.all(arr.map(async (kb) => {
    const meta = await storage.getKBMeta(kb.path)
    await storage.saveKBMeta(kb.path, { ...(meta || {}), order: kb.order })
  }))
  dragKBIndex.value = -1
  dragOverIndex.value = -1
}

function onKBDragEnd() {
  dragKBIndex.value = -1
  dragOverIndex.value = -1
}

// ─── 新建知识库 ────────────────────────────────────────────────
function selectCover() { coverInputRef.value?.click() }

function coverChanged(e) {
  const file = e.target.files?.[0]
  if (!file) return
  newKB.coverBlob = file
  const reader = new FileReader()
  reader.onload = (ev) => { newKB.coverPreviewUrl = ev.target.result }
  reader.readAsDataURL(file)
}

function removeCover() {
  newKB.coverBlob = null
  newKB.coverPreviewUrl = null
  if (coverInputRef.value) coverInputRef.value.value = ''
}

function cancelCreate() {
  showCreateForm.value = false
  newKB.name = ''
  newKB.coverBlob = null
  newKB.coverPreviewUrl = null
  nameError.value = false
}

async function submitCreate() {
  const name = newKB.name.trim()
  if (!name) {
    nameError.value = true
    nameInputRef.value?.focus()
    setTimeout(() => { nameError.value = false }, 2000)
    return
  }

  // 检查同名
  const existing = await storage.listKBs()
  if (existing.some(kb => kb.name === name || kb.path === name)) {
    nameError.value = true
    nameInputRef.value?.focus()
    setTimeout(() => { nameError.value = false }, 2000)
    return
  }

  try {
    await storage.createKB(name)
    const kbPath = name
    // 保存封面
    if (newKB.coverBlob) {
      const ext = (newKB.coverBlob.name || 'png').split('.').pop()
      const r = await storage.saveKBImage(kbPath, newKB.coverBlob, `cover.${ext}`)
      const meta = await storage.getKBMeta(kbPath)
      meta.cover = r.markdownRef
      await storage.saveKBMeta(kbPath, meta)
    }
    cancelCreate()
    await loadKBList()
  } catch (err) {
    logger.catch('HomePage', '创建知识库', err)
  }
}

// ─── 知识库设置 ────────────────────────────────────────────────
async function openKBSettings(kb) {
  settingsTargetKB.value = kb
  settingsForm.name = kb?.name || ''
  settingsForm.path = kb?.path || ''
  settingsForm.createdAt = kb?.createdAt || null
  settingsForm.nodeCount = Number.isFinite(kb?.nodeCount) ? kb.nodeCount : 0
  settingsForm.coverBlob = null
  settingsForm.coverPreviewUrl = kb?.coverUrl || null
  settingsForm.keepCurrentCover = !!kb?.cover
  settingsNameError.value = false
  showSettingsForm.value = true

  // 打开设置时补充最新统计
  try {
    const latestCount = await storage.countChildren(kb.path)
    settingsForm.nodeCount = Number.isFinite(latestCount) ? latestCount : settingsForm.nodeCount
  } catch (e) {
    logger.warn('HomePage', '读取节点数失败:', kb.path, e)
  }
}

function closeKBSettings() {
  showSettingsForm.value = false
  settingsNameError.value = false
  settingsTargetKB.value = null
  settingsForm.name = ''
  settingsForm.path = ''
  settingsForm.createdAt = null
  settingsForm.nodeCount = 0
  settingsForm.coverBlob = null
  settingsForm.coverPreviewUrl = null
  settingsForm.keepCurrentCover = false
  if (settingsCoverInputRef.value) settingsCoverInputRef.value.value = ''
}

function selectSettingsCover() {
  settingsCoverInputRef.value?.click()
}

function settingsCoverChanged(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const url = ev.target.result
    const img = new Image()
    img.onload = () => {
      cropSource.value = { blob: file, url, width: img.width, height: img.height }
      // 默认选中中央区域（200x200 或更小）
      const minDim = Math.min(img.width, img.height)
      const cx = img.width / 2, cy = img.height / 2
      cropRect.x = cx - minDim / 2
      cropRect.y = cy - minDim / 2
      cropRect.w = minDim
      cropRect.h = minDim
      showCoverCrop.value = true
    }
    img.src = url
  }
  reader.readAsDataURL(file)
}

function onCropMouseDown(e) {
  cropDragging.value = true
  cropDragStart.x = e.clientX
  cropDragStart.y = e.clientY
}
function onCropMouseMove(e) {
  if (!cropDragging.value) return
  const dx = e.clientX - cropDragStart.x
  const dy = e.clientY - cropDragStart.y
  cropDragStart.x = e.clientX
  cropDragStart.y = e.clientY
  const scaleX = cropSource.value.width / e.currentTarget.offsetWidth
  const scaleY = cropSource.value.height / e.currentTarget.offsetHeight
  cropRect.x += dx * scaleX
  cropRect.y += dy * scaleY
}
function onCropMouseUp() { cropDragging.value = false }

function applyCoverCrop() {
  // 使用 Canvas 裁剪图片
  const { blob, url, width, height } = cropSource.value
  if (!blob || !width) return
  const canvas = document.createElement('canvas')
  const img = new Image()
  img.onload = () => {
    canvas.width = cropRect.w
    canvas.height = cropRect.h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h)
    canvas.toBlob((cropBlob) => {
      if (cropBlob) {
        settingsForm.coverBlob = new File([cropBlob], blob.name || 'cover.png', { type: 'image/png' })
        settingsForm.coverPreviewUrl = URL.createObjectURL(cropBlob)
        settingsForm.keepCurrentCover = false
      }
      showCoverCrop.value = false
    }, 'image/png')
  }
  img.src = url
}

function cancelCoverCrop() {
  showCoverCrop.value = false
  cropSource.value = { blob: null, url: null, width: 0, height: 0 }
}

function removeSettingsCover() {
  settingsForm.coverBlob = null
  settingsForm.coverPreviewUrl = null
  settingsForm.keepCurrentCover = false
  if (settingsCoverInputRef.value) settingsCoverInputRef.value.value = ''
}

async function saveKBSettings() {
  const kb = settingsTargetKB.value
  if (!kb) return

  const newName = (settingsForm.name || '').trim()
  if (!newName) {
    settingsNameError.value = true
    setTimeout(() => { settingsNameError.value = false }, 1800)
    return
  }

  const all = await storage.listKBs()
  const duplicated = all.some(item => item.path !== kb.path && ((item.name || '').trim() === newName || item.path === newName))
  if (duplicated) {
    settingsNameError.value = true
    setTimeout(() => { settingsNameError.value = false }, 1800)
    return
  }

  const targetPath = kb.path

  try {
    // 当前存储后端以目录名作为知识库路径标识，设置页改名仅修改展示名（meta.name）
    const baseMeta = await storage.getKBMeta(targetPath)
    await storage.saveKBMeta(targetPath, { ...(baseMeta || {}), name: newName })

    // 封面处理
    if (settingsForm.coverBlob) {
      const ext = (settingsForm.coverBlob.name || 'png').split('.').pop()
      const r = await storage.saveKBImage(targetPath, settingsForm.coverBlob, `cover.${ext}`)
      const meta = await storage.getKBMeta(targetPath)
      meta.cover = r.markdownRef
      await storage.saveKBMeta(targetPath, meta)
    } else if (!settingsForm.keepCurrentCover) {
      const meta = await storage.getKBMeta(targetPath)
      delete meta.cover
      await storage.saveKBMeta(targetPath, meta)
    }

    closeKBSettings()
    await loadKBList()
  } catch (e) {
    logger.catch('HomePage', '保存知识库设置', e)
  }
}

async function deleteKBFromSettings() {
  const kb = settingsTargetKB.value
  if (!kb) return

  const confirm1 = await modalStore.showConfirm(`确定删除知识库「${kb.name}」？此操作不可恢复。`)
  if (!confirm1) return
  const confirm2 = await modalStore.showConfirm('请再次确认：删除后所有节点与文档将永久丢失。')
  if (!confirm2) return

  await storage.deleteKB(kb.path)
  closeKBSettings()
  await loadKBList()
}

// ─── 导入知识库 ────────────────────────────────────────────────
function openImportForm() {
  showImportForm.value = true
  importSelected.value = null
  importError.value = null
  importLoading.value = false
}

function closeImportForm() {
  showImportForm.value = false
  importSelected.value = null
  importError.value = null
  importLoading.value = false
}

async function doSelectExistingKB() {
  importError.value = null
  try {
    const result = await storage.selectWorkDirCandidate()
    importSelected.value = result
    if (!result) {
      // 用户取消了选择，不做处理
    }
  } catch (e) {
    // 用户取消或关闭选择框时，保持静默，避免误报
    if (String(e?.message || '').includes('取消')) return
    importError.value = e?.message || '选择知识库失败'
  }
}

async function submitImport() {
  if (!importSelected.value || !importSelected.value.valid) return
  importLoading.value = true
  importError.value = null
  try {
    const kbPath = await storage.importKB(importSelected.value.path)
    closeImportForm()
    await loadKBList()
    // 自动打开刚导入的知识库
    const importedKB = kbs.value.find(kb => kb.path === kbPath)
    if (importedKB) {
      await openKB(importedKB)
    }
  } catch (err) {
    importError.value = '导入失败: ' + (err?.message || String(err))
  } finally {
    importLoading.value = false
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────
function gitBadgeLabel(st = {}) {
  const state = st.state || 'uninit'
  switch (state) {
    case 'uninit':
      return '○ 未追踪'
    case 'conflict':
      return '⚡ 冲突'
    case 'dirty':
      return st.dirtyFiles > 0 ? `● 未提交 ${st.dirtyFiles}` : '● 未提交'
    case 'diverged':
      return `⇅ 分叉 ${st.ahead || 0}/${st.behind || 0}`
    case 'ahead':
      return `⬆ 未推送 ${st.ahead || 0}`
    case 'behind':
      return `⬇ 远程有变更 ${st.behind || 0}`
    case 'no-remote':
      return '○ 无远程'
    case 'git-unavailable':
      return '— Git 离线'
    case 'clean':
      return '✓ 已同步'
    default:
      return '… Git 状态'
  }
}

function gitBadgeTitle(st = {}) {
  const state = st.state || 'uninit'
  switch (state) {
    case 'uninit':
      return 'Git 状态：未初始化仓库'
    case 'conflict':
      return `Git 状态：存在冲突（${st.conflictFiles?.length || 0}）`
    case 'dirty':
      return `Git 状态：有未提交变更（${st.dirtyFiles || 0}）`
    case 'diverged':
      return `Git 状态：本地与远程分叉（ahead ${st.ahead || 0} / behind ${st.behind || 0}）`
    case 'ahead':
      return `Git 状态：有未推送提交（${st.ahead || 0}）`
    case 'behind':
      return `Git 状态：远程有新提交（${st.behind || 0}）`
    case 'no-remote':
      return 'Git 状态：未配置远程仓库'
    case 'git-unavailable':
      return 'Git 状态：本机 Git 不可用或离线'
    case 'clean':
      return 'Git 状态：工作区干净且与远程同步'
    default:
      return `Git 状态：${state}`
  }
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}

// ─── 切换工作目录 ──────────────────────────────────────────────
async function switchWorkDir() {
  // 1. 选择并验证新工作目录
  const res = await storage.selectExistingWorkDir()
  if (!res?.valid) return
  // 2. 关闭所有已打开的标签页（知识库属于旧工作目录）
  roomStore.tabs.slice().forEach(tab => roomStore.closeTab(tab.id))
  // 3. 重置首页视图（工作目录已通过 file-service 更新，loadKBList 会读取新 rootDir）
  await loadKBList()
}
</script>
