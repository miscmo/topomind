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
        <div class="home-card-add" @click="showCreateSheet = true">
          <div class="home-card-add-icon">＋</div>
          <div class="home-card-add-text">新建知识库</div>
        </div>

        <!-- 导入按钮 -->
        <div class="home-card-add" @click="openImportSheet">
          <div class="home-card-add-icon">📥</div>
          <div class="home-card-add-text">导入知识库</div>
        </div>
      </div>
    </div>

    <!-- 4 个表单弹窗 -->
    <CreateKBSheet
      :visible="showCreateSheet"
      @cancel="cancelCreate"
      @submit="submitCreate"
    />

    <ImportKBSheet
      :visible="showImportSheet"
      @cancel="closeImportSheet"
      @submit="onImported"
    />

    <SettingsSheet
      ref="settingsSheetRef"
      :visible="showSettingsSheet"
      :kb-name="settingsTarget?.name || ''"
      :kb-path="settingsTarget?.path || ''"
      :kb-created-at="settingsTarget?.createdAt || null"
      :node-count="settingsTargetNodeCount"
      :current-cover-url="settingsTargetCoverUrl"
      :has-existing-cover="!!settingsTarget?.cover"
      :root-dir="workDir"
      @cancel="closeSettings"
      @save="saveSettings"
      @delete="deleteKB"
      @crop="onSettingsCoverSelected"
    />

    <CoverCropSheet
      ref="coverCropRef"
      :visible="showCoverCrop"
      :crop="cropSource"
      @cancel="cancelCoverCrop"
      @apply="onCropApplied"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useStorage } from '@/composables/useStorage'
import { useGit } from '@/composables/useGit'
import { logger } from '@/core/logger.js'
import CreateKBSheet from '@/components/modals/CreateKBSheet.vue'
import ImportKBSheet from '@/components/modals/ImportKBSheet.vue'
import SettingsSheet from '@/components/modals/SettingsSheet.vue'
import CoverCropSheet from '@/components/modals/CoverCropSheet.vue'

const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const storage = useStorage()
const git = useGit()

// ─── 状态 ──────────────────────────────────────────────────────
const loading = ref(false)
const kbs = ref([])
const workDir = ref('')

// 表单弹窗可见性
const showCreateSheet = ref(false)
const showImportSheet = ref(false)
const showSettingsSheet = ref(false)
const showCoverCrop = ref(false)

// Settings 相关状态
const settingsTarget = ref(null)
const settingsTargetNodeCount = ref(0)
const settingsTargetCoverUrl = ref(null)
const settingsSheetRef = ref(null)

// 封面裁剪状态
const cropSource = ref({ blob: null, url: '', width: 0, height: 0 })
const coverCropRef = ref(null)

// 知识库拖拽排序
const dragKBIndex = ref(-1)
const dragOverIndex = ref(-1)

const truncatedWorkDir = computed(() => {
  if (!workDir.value) return ''
  const p = workDir.value
  if (p.length <= 48) return p
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
    // 加载新列表前清理旧的 Blob URL，防止内存泄漏
    await storage.revokeAllImageUrls()
    kbs.value = (list || []).map(kb => ({ ...kb, nodeCount: null, gitStatus: null, coverUrl: null }))

    const countResults = await Promise.all(
      kbs.value.map(async (kb) => {
        try {
          return { path: kb.path, count: await storage.countChildren(kb.path) }
        } catch (e) { logger.warn('HomePage', '加载节点数失败:', kb.path, e); return { path: kb.path, count: null } }
      })
    )
    countResults.forEach(({ path, count }) => {
      const idx = kbs.value.findIndex(kb => kb.path === path)
      if (idx !== -1) kbs.value[idx].nodeCount = count
    })

    const coverResults = await Promise.all(
      kbs.value.map(async (kb) => {
        if (!kb.cover) return { path: kb.path, url: null }
        try {
          const imgPath = `${kb.path}/${kb.cover}`
          const url = await storage.loadImage(imgPath)
          return { path: kb.path, url }
        } catch (e) { logger.warn('HomePage', '加载封面失败:', kb.path, e); return { path: kb.path, url: null } }
      })
    )
    coverResults.forEach(({ path, url }) => {
      const idx = kbs.value.findIndex(kb => kb.path === path)
      if (idx !== -1 && url) kbs.value[idx].coverUrl = url
    })

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
  try { await storage.setLastOpenedKB(kb.path) } catch (e) { logger.catch('HomePage', '设置最近打开', e) }
  roomStore.openTab(kb.path, kb.name)
  appStore.showGraph()
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
  const rel = e.relatedTarget
  if (!rel || !e.currentTarget.contains(rel)) { dragOverIndex.value = -1 }
}

async function onKBDrop(e, idx) {
  const fromIdx = dragKBIndex.value
  if (fromIdx === -1 || fromIdx === idx) { dragKBIndex.value = -1; dragOverIndex.value = -1; return }
  // 模拟 splice 操作生成新数组，不突变原始 KB 对象
  const oldArr = kbs.value
  const removed = oldArr[fromIdx]
  const filtered = oldArr.filter((_, i) => i !== fromIdx)
  const newArr = [...filtered.slice(0, idx), removed, ...filtered.slice(idx)]
  kbs.value = newArr
  try {
    await Promise.all(newArr.map(async (kb, i) => {
      await storage.saveKBOrder(kb.path, i)
    }))
  } catch (e) {
    logger.catch('HomePage', '保存知识库排序', e)
  } finally {
    dragKBIndex.value = -1
    dragOverIndex.value = -1
  }
}

function onKBDragEnd() { dragKBIndex.value = -1; dragOverIndex.value = -1 }

// ─── 新建知识库 ────────────────────────────────────────────────
function cancelCreate() { showCreateSheet.value = false }

async function submitCreate({ name, coverBlob }) {
  try {
    // 检查同名
    const existing = await storage.listKBs()
    if (existing.some(kb => kb.name === name || kb.path === name)) {
      logger.warn('HomePage', '知识库已存在:', name)
      return
    }

    const kbPath = await storage.createKB(name)
    if (coverBlob) {
      const ext = (coverBlob.name || 'png').split('.').pop()
      const r = await storage.saveKBImage(kbPath, coverBlob, `cover.${ext}`)
      await storage.saveKBCover(kbPath, r.markdownRef)
    }
    showCreateSheet.value = false
    await loadKBList()
    // 创建后自动打开，与导入流程保持一致
    const newKB = kbs.value.find(kb => kb.path === kbPath)
    if (newKB) await openKB(newKB)
  } catch (err) { logger.catch('HomePage', '创建知识库', err) }
}

// ─── 导入知识库 ────────────────────────────────────────────────
function openImportSheet() {
  showImportSheet.value = true
}

function closeImportSheet() { showImportSheet.value = false }

async function onImported(kbPath) {
  showImportSheet.value = false
  await loadKBList()
  const importedKB = kbs.value.find(kb => kb.path === kbPath)
  if (importedKB) { await openKB(importedKB) }
}

// ─── 知识库设置 ────────────────────────────────────────────────
async function openKBSettings(kb) {
  settingsTarget.value = kb
  let nodeCount = Number.isFinite(kb?.nodeCount) ? kb.nodeCount : 0
  try { nodeCount = await storage.countChildren(kb.path) } catch (e) { logger.warn('HomePage', '读取节点数失败:', kb.path, e) }
  settingsTargetNodeCount.value = nodeCount
  settingsTargetCoverUrl.value = kb?.coverUrl || null
  showSettingsSheet.value = true
}

function closeSettings() {
  showSettingsSheet.value = false
  settingsTarget.value = null
  settingsTargetNodeCount.value = 0
  settingsTargetCoverUrl.value = null
}

function onSettingsCoverSelected(source) {
  cropSource.value = source
  showCoverCrop.value = true
  coverCropRef.value?.initCrop()
}

function onCropApplied(file) {
  showCoverCrop.value = false
  cropSource.value = { blob: null, url: '', width: 0, height: 0 }
  settingsSheetRef.value?.applyCroppedFile(file)
}

function cancelCoverCrop() {
  showCoverCrop.value = false
  cropSource.value = { blob: null, url: '', width: 0, height: 0 }
}

async function saveSettings(name, coverBlob) {
  const kb = settingsTarget.value
  if (!kb || !name?.trim()) return

  try {
    const targetPath = kb.path
    // 重命名知识库（目录改名）
    if (name !== kb.name) {
      await storage.renameKB(targetPath, name)
    }
    // 保存封面
    if (coverBlob) {
      const ext = (coverBlob.name || 'png').split('.').pop()
      const r = await storage.saveKBImage(targetPath, coverBlob, `cover.${ext}`)
      await storage.saveKBCover(targetPath, r.markdownRef)
    }
    closeSettings()
    await loadKBList()
  } catch (e) { logger.catch('HomePage', '保存知识库设置', e) }
}

async function deleteKB() {
  const kb = settingsTarget.value
  if (!kb) return
  const confirm1 = await modalStore.showConfirm(`确定删除知识库「${kb.name}」？此操作不可恢复。`)
  if (!confirm1) return
  const confirm2 = await modalStore.showConfirm('请再次确认：删除后所有节点与文档将永久丢失。')
  if (!confirm2) return
  await storage.deleteKB(kb.path)
  closeSettings()
  await loadKBList()
}

// ─── 工具函数 ──────────────────────────────────────────────────
function gitBadgeLabel(st = {}) {
  const state = st.state || 'uninit'
  switch (state) {
    case 'uninit': return '○ 未追踪'
    case 'conflict': return '⚡ 冲突'
    case 'dirty': return st.dirtyFiles > 0 ? `● 未提交 ${st.dirtyFiles}` : '● 未提交'
    case 'diverged': return `⇅ 分叉 ${st.ahead || 0}/${st.behind || 0}`
    case 'ahead': return `⬆ 未推送 ${st.ahead || 0}`
    case 'behind': return `⬇ 远程有变更 ${st.behind || 0}`
    case 'no-remote': return '○ 无远程'
    case 'git-unavailable': return '— Git 离线'
    case 'clean': return '✓ 已同步'
    default: return '… Git 状态'
  }
}

function gitBadgeTitle(st = {}) {
  const state = st.state || 'uninit'
  switch (state) {
    case 'uninit': return 'Git 状态：未初始化仓库'
    case 'conflict': return `Git 状态：存在冲突（${st.conflictFiles?.length || 0}）`
    case 'dirty': return `Git 状态：有未提交变更（${st.dirtyFiles || 0}）`
    case 'diverged': return `Git 状态：本地与远程分叉（ahead ${st.ahead || 0} / behind ${st.behind || 0}）`
    case 'ahead': return `Git 状态：有未推送提交（${st.ahead || 0}）`
    case 'behind': return `Git 状态：远程有新提交（${st.behind || 0}）`
    case 'no-remote': return 'Git 状态：未配置远程仓库'
    case 'git-unavailable': return 'Git 状态：本机 Git 不可用或离线'
    case 'clean': return 'Git 状态：工作区干净且与远程同步'
    default: return `Git 状态：${state}`
  }
}

// ─── 切换工作目录 ──────────────────────────────────────────────
async function switchWorkDir() {
  const res = await storage.selectExistingWorkDir()
  if (!res?.valid) return
  roomStore.tabs.slice().forEach(tab => roomStore.closeTab(tab.id))
  await loadKBList()
}
</script>
