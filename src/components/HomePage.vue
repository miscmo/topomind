<!-- 首页：知识库列表 -->
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
    </div>

    <!-- 知识库列表 -->
    <div class="home-content">
      <div class="home-section-title">我的知识库</div>
      <div class="home-grid">
        <!-- 知识库卡片 -->
        <div
          v-for="kb in kbs"
          :key="kb.path"
          class="home-card"
          :class="{ loading: kb.nodeCount === null && !kb.gitStatus }"
          @click="openKB(kb)"
        >
          <div class="home-card-image">
            <img v-if="kb.coverUrl" :src="kb.coverUrl" />
            <span v-else class="home-card-image-icon">📚</span>
            <button
              class="home-card-settings-btn"
              title="知识库设置"
              @click.stop="openKBSettings(kb)"
            >⚙</button>

          </div>
          <div class="home-card-body">
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
            <div
              class="home-card-path"
              title="在 Finder 中打开"
              @click.stop="openInFinder(kb)"
            >📁 {{ rootDir }}/{{ kb.path }}</div>
          </div>
        </div>

        <!-- 新建按钮 -->
        <div class="home-card-add" @click="showCreateForm = true">
          <div class="home-card-add-icon">＋</div>
          <div class="home-card-add-text">新建知识库</div>
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
            <label>存储位置</label>
            <div style="display:flex;gap:8px;align-items:center">
              <div
                style="flex:1;padding:10px 14px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#888;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              >{{ newKB.customDir || '默认目录' }}</div>
              <button class="home-btn home-btn-cancel" @click="selectDir" style="white-space:nowrap;padding:10px 14px">📁 选择</button>
            </div>
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

const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const storage = useStorage()
const git = useGit()

// ─── 状态 ──────────────────────────────────────────────────────
const loading = ref(false)
const kbs = ref([])
const rootDir = ref('')
const showCreateForm = ref(false)
const nameError = ref(false)
const nameInputRef = ref(null)
const coverInputRef = ref(null)

const showSettingsForm = ref(false)
const settingsNameError = ref(false)
const settingsCoverInputRef = ref(null)
const settingsTargetKB = ref(null)

const newKB = reactive({
  name: '',
  customDir: '',
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
  return rootDir.value ? `${rootDir.value}/${settingsForm.path}` : settingsForm.path
})

// ─── 生命周期 ──────────────────────────────────────────────────
onMounted(() => { loadKBList() })

// ─── 加载知识库列表 ────────────────────────────────────────────
async function loadKBList() {
  loading.value = true
  try {
    const [list, dir] = await Promise.all([storage.listKBs(), storage.getRootDir()])
    rootDir.value = dir || ''
    kbs.value = (list || []).map(kb => ({ ...kb, nodeCount: null, gitStatus: null, coverUrl: null }))

    // 并发获取节点数和封面（避免串行 await 导致首页变慢）
    await Promise.all(
      kbs.value.map(async (kb, i) => {
        try {
          const count = await storage.countChildren(kb.path)
          kbs.value[i].nodeCount = count
        } catch (e) { console.warn('[HomePage] 加载节点数失败:', kb.path, e) }

        if (kb.cover) {
          try {
            const imgPath = `${kb.path}/${kb.cover}`
            const url = await storage.loadImage(imgPath)
            kbs.value[i].coverUrl = url
          } catch (e) { console.warn('[HomePage] 加载封面失败:', kb.path, e) }
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
    console.error('[HomePage] 加载知识库列表失败:', err)
  } finally {
    loading.value = false
  }
}

// ─── 打开知识库 ────────────────────────────────────────────────
function openKB(kb) {
  roomStore.openTab(kb.path, kb.name)
  appStore.showGraph()
}

// ─── 在 Finder 中打开 ─────────────────────────────────────────
function openInFinder(kb) {
  storage.openInFinder(kb.path)
}

// ─── 新建知识库 ────────────────────────────────────────────────
async function selectDir() {
  const dir = await storage.selectDir()
  if (dir) newKB.customDir = dir
}

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
  newKB.customDir = ''
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
    await storage.createKB(name, newKB.customDir ? { rootDir: newKB.customDir } : undefined)
    const kbPath = newKB.customDir ? `${newKB.customDir}/${name}` : name
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
    console.error('[HomePage] 创建知识库失败:', err)
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
  } catch (e) {}
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
  settingsForm.coverBlob = file
  settingsForm.keepCurrentCover = false
  const reader = new FileReader()
  reader.onload = (ev) => { settingsForm.coverPreviewUrl = ev.target.result }
  reader.readAsDataURL(file)
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
</script>
