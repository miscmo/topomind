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
        <!-- 空状态 -->
        <template v-if="kbs.length === 0 && !loading">
          <div class="home-empty">
            <div class="home-empty-icon">📚</div>
            <h3>还没有知识库</h3>
            <p>点击 ＋ 创建你的第一个知识图谱</p>
          </div>
        </template>

        <!-- 知识库卡片 -->
        <div
          v-for="kb in kbs"
          :key="kb.path"
          class="home-card"
          @click="openKB(kb)"
        >
          <div class="home-card-image">
            <img v-if="kb.coverUrl" :src="kb.coverUrl" />
            <span v-else class="home-card-image-icon">📚</span>
            <button
              class="home-card-cover-btn"
              title="更换封面"
              @click.stop="changeKBCover(kb)"
            >📷 更换</button>
            <!-- Git 状态徽标 -->
            <span
              v-if="kb.gitStatus"
              :class="['git-badge', `git-badge--${kb.gitStatus.state}`]"
              @click.stop="openGit(kb)"
              :title="`Git 状态: ${kb.gitStatus.state}`"
            >{{ gitBadgeLabel(kb.gitStatus) }}</span>
          </div>
          <div class="home-card-body">
            <div class="home-card-title">
              <span>{{ kb.name }}</span>
              <div class="home-card-actions">
                <button
                  class="home-card-action-btn danger"
                  title="删除"
                  @click.stop="deleteKBConfirm(kb)"
                >🗑</button>
              </div>
            </div>
            <div class="home-card-meta">
              <span>📊 {{ kb.nodeCount ?? '...' }} 个节点</span>
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

    <!-- 更换封面的隐藏文件输入 -->
    <input ref="changeCoverInputRef" type="file" accept="image/*" style="display:none" @change="changeCoverSelected" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useModalStore } from '@/stores/modal'
import { useGitStore } from '@/stores/git'
import { useStorage } from '@/composables/useStorage'
import { useGit } from '@/composables/useGit'

const appStore = useAppStore()
const roomStore = useRoomStore()
const modalStore = useModalStore()
const gitStore = useGitStore()
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
const changeCoverInputRef = ref(null)
let _changeCoverKB = null

const newKB = reactive({
  name: '',
  customDir: '',
  coverBlob: null,
  coverPreviewUrl: null,
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

    // 异步获取节点数
    kbs.value.forEach(async (kb, i) => {
      try {
        const count = await storage.countChildren(kb.path)
        kbs.value[i].nodeCount = count
      } catch (e) {}

      // 加载封面
      if (kb.cover) {
        try {
          const url = await storage.loadImage(kb.path + '/' + kb.cover)
          kbs.value[i].coverUrl = url
        } catch (e) {}
      }
    })

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

// ─── 打开 Git 面板 ─────────────────────────────────────────────
function openGit(kb) {
  gitStore.openForKB(kb.path)
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
    // 保存封面
    if (newKB.coverBlob) {
      const ext = (newKB.coverBlob.name || 'png').split('.').pop()
      const r = await storage.saveImage(name, newKB.coverBlob, `cover.${ext}`)
      const meta = await storage.getKBMeta(name)
      meta.cover = r.markdownRef
      await storage.saveKBMeta(name, meta)
    }
    cancelCreate()
    await loadKBList()
  } catch (err) {
    console.error('[HomePage] 创建知识库失败:', err)
  }
}

// ─── 删除知识库 ────────────────────────────────────────────────
async function deleteKBConfirm(kb) {
  const ok = await modalStore.showConfirm(`确定删除知识库「${kb.name}」？此操作不可恢复。`)
  if (!ok) return
  await storage.deleteKB(kb.path)
  await loadKBList()
}

// ─── 更换封面 ──────────────────────────────────────────────────
function changeKBCover(kb) {
  _changeCoverKB = kb
  if (changeCoverInputRef.value) changeCoverInputRef.value.value = ''
  changeCoverInputRef.value?.click()
}

async function changeCoverSelected(e) {
  const file = e.target.files?.[0]
  if (!file || !_changeCoverKB) return
  const kb = _changeCoverKB
  _changeCoverKB = null
  const ext = (file.name || 'png').split('.').pop()
  const r = await storage.saveImage(kb.path, file, `cover.${ext}`)
  const meta = await storage.getKBMeta(kb.path)
  meta.cover = r.markdownRef
  await storage.saveKBMeta(kb.path, meta)
  await loadKBList()
}

// ─── 工具函数 ──────────────────────────────────────────────────
function gitBadgeLabel(st) {
  const map = {
    'uninit': '○ 未追踪',
    'dirty': '● 有变更',
    'clean': '✓ 本地',
    'ahead': `⬆ ${st.ahead || ''}`,
    'behind': `⬇ ${st.behind || ''}`,
    'diverged': '⇅ 分叉',
    'conflict': '⚡ 冲突',
    'no-remote': '○ 无远程',
    'git-unavailable': '— Git 不可用',
  }
  return map[st.state] || st.state
}
</script>
