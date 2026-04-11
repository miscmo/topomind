<!-- Git 面板：提交、历史、同步、冲突解决 -->
<template>
  <Teleport to="body">
    <div class="git-modal-overlay" :class="{ active: gitStore.isOpen }" @click.self="gitStore.close()">

      <!-- 主控制台面板 -->
      <div class="git-modal git-modal--md" v-if="activePanel === 'main'">
        <div class="git-modal-header">
          <h3>⎇ Git 版本管理</h3>
          <button class="git-modal-close" @click="gitStore.close()">✕</button>
        </div>
        <div class="git-modal-body">
          <div class="git-status-summary">
            <div class="git-status-state" :class="`git-state--${statusState}`">{{ statusLabel }}</div>
          </div>
          <div class="git-action-grid">
            <button class="git-action-btn" @click="openCommit" :disabled="!hasDirty">
              <span>📝</span> 提交变更
              <span v-if="gitStore.commitFiles.length" class="git-count-badge">{{ gitStore.commitFiles.length }}</span>
            </button>
            <button class="git-action-btn" @click="openLog">
              <span>📜</span> 提交历史
            </button>
            <button class="git-action-btn" @click="openSync">
              <span>🔄</span> 同步（推/拉）
            </button>
            <button class="git-action-btn" @click="openRemote">
              <span>⚙</span> 远程仓库
            </button>
            <button v-if="gitStore.hasConflicts" class="git-action-btn git-action-btn--danger" @click="openConflict">
              <span>⚡</span> 解决冲突 ({{ gitStore.conflictFiles.length }})
            </button>
          </div>
        </div>
        <div class="git-modal-footer">
          <button class="git-btn" @click="gitStore.close()">关闭</button>
          <button class="git-btn git-btn--primary" @click="initRepo" v-if="statusState === 'uninit'">初始化仓库</button>
        </div>
      </div>

      <!-- 提交面板 -->
      <div class="git-modal git-modal--md" v-else-if="activePanel === 'commit'">
        <div class="git-modal-header">
          <h3>提交变更</h3>
          <button class="git-modal-close" @click="activePanel = 'main'">✕</button>
        </div>
        <div class="git-modal-body">
          <div class="git-file-list">
            <div v-for="f in gitStore.commitFiles" :key="f.file" class="git-file-item">
              <span class="git-file-status" :class="`git-file-status--${f.status?.toLowerCase()}`">{{ f.status }}</span>
              <span class="git-file-name">{{ f.file }}</span>
            </div>
            <div v-if="!gitStore.commitFiles.length" class="git-empty">没有待提交的变更</div>
          </div>
          <div class="git-commit-msg-label">提交说明</div>
          <textarea class="git-commit-msg-input" v-model="commitMsg" placeholder="留空则自动生成..."></textarea>
        </div>
        <div class="git-modal-footer">
          <button class="git-btn" @click="activePanel = 'main'">取消</button>
          <button class="git-btn git-btn--primary" @click="doCommit" :disabled="!gitStore.commitFiles.length">提交</button>
        </div>
      </div>

      <!-- 历史/Diff 面板 -->
      <div class="git-modal git-modal--lg" v-else-if="activePanel === 'log'">
        <div class="git-modal-header">
          <h3>提交历史</h3>
          <button class="git-modal-close" @click="activePanel = 'main'">✕</button>
        </div>
        <div class="git-modal-body" style="padding:0">
          <div class="git-diff-layout">
            <div class="git-diff-sidebar">
              <div
                v-for="entry in gitStore.logEntries" :key="entry.hash"
                class="git-log-item" :class="{ active: selectedLog?.hash === entry.hash }"
                @click="viewLogEntry(entry)"
              >
                <div class="git-log-hash">{{ entry.hash?.slice(0, 7) }}</div>
                <div class="git-log-msg">{{ entry.message }}</div>
                <div class="git-log-date">{{ formatDate(entry.date) }}</div>
              </div>
              <div v-if="!gitStore.logEntries.length" class="git-empty">暂无提交记录</div>
            </div>
            <div class="git-diff-main">
              <pre v-if="logDiff" class="git-diff-content">{{ logDiff }}</pre>
              <div v-else class="git-empty">点击左侧提交查看变更</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 同步面板 -->
      <div class="git-modal git-modal--sm" v-else-if="activePanel === 'sync'">
        <div class="git-modal-header">
          <h3>同步</h3>
          <button class="git-modal-close" @click="activePanel = 'main'">✕</button>
        </div>
        <div class="git-modal-body">
          <div class="git-sync-summary">
            <div v-if="gitStore.syncState === 'idle'">准备就绪，可推送或拉取</div>
            <div v-else-if="gitStore.syncState === 'pushing'">⏳ 正在推送...</div>
            <div v-else-if="gitStore.syncState === 'pulling'">⏳ 正在拉取...</div>
            <div v-else-if="gitStore.syncState === 'done'" class="git-sync-success">✓ {{ gitStore.syncMessage }}</div>
            <div v-else-if="gitStore.syncState === 'error'" class="git-sync-error">✕ {{ gitStore.syncMessage }}</div>
          </div>
        </div>
        <div class="git-modal-footer">
          <button class="git-btn" @click="activePanel = 'main'">关闭</button>
          <button class="git-btn git-btn--primary" @click="doSync('pull')" :disabled="syncing">⬇ 拉取</button>
          <button class="git-btn git-btn--primary" @click="doSync('push')" :disabled="syncing">⬆ 推送</button>
        </div>
      </div>

      <!-- 远程设置面板 -->
      <div class="git-modal git-modal--md" v-else-if="activePanel === 'remote'">
        <div class="git-modal-header">
          <h3>远程仓库设置</h3>
          <button class="git-modal-close" @click="activePanel = 'main'">✕</button>
        </div>
        <div class="git-modal-body">
          <div class="git-form-group">
            <label class="git-form-label">认证方式</label>
            <div class="git-radio-group">
              <label><input type="radio" v-model="remoteForm.authType" value="token" /> Token (HTTPS)</label>
              <label><input type="radio" v-model="remoteForm.authType" value="ssh" /> SSH 密钥</label>
            </div>
          </div>
          <div class="git-form-group">
            <label class="git-form-label">远程仓库 URL</label>
            <input class="git-form-input" v-model="remoteForm.url" placeholder="https://github.com/user/repo.git" />
            <div class="git-form-hint">支持 GitHub、Gitee 等 Git 托管服务</div>
          </div>
          <div v-if="remoteForm.authType === 'token'" class="git-form-group">
            <label class="git-form-label">Personal Access Token</label>
            <input class="git-form-input" v-model="remoteForm.token" type="password" placeholder="ghp_xxxxxxxxxxxx" />
          </div>
          <div v-else class="git-form-group">
            <label class="git-form-label">SSH 公钥</label>
            <div class="git-ssh-pubkey">{{ gitStore.sshPublicKey || '加载中...' }}</div>
            <button class="git-ssh-copy-btn" @click="copySSHKey">复制公钥</button>
          </div>
        </div>
        <div class="git-modal-footer">
          <button class="git-btn" @click="activePanel = 'main'">取消</button>
          <button class="git-btn git-btn--primary" @click="saveRemote">保存</button>
        </div>
      </div>

      <!-- 冲突解决面板 -->
      <div class="git-modal git-modal--lg" v-else-if="activePanel === 'conflict'">
        <div class="git-modal-header">
          <h3>解决冲突</h3>
          <button class="git-modal-close" @click="activePanel = 'main'">✕</button>
        </div>
        <div class="git-modal-body" style="padding:0">
          <div class="git-conflict-layout">
            <div class="git-conflict-sidebar">
              <div
                v-for="file in gitStore.conflictFiles" :key="file"
                class="git-conflict-file-item"
                :class="{ active: gitStore.currentConflictFile === file }"
                @click="viewConflict(file)"
              >{{ file }}</div>
            </div>
            <div class="git-conflict-main">
              <template v-if="gitStore.currentConflictFile">
                <div class="git-conflict-actions">
                  <button class="git-btn" @click="resolveConflict('ours')">采用本地版本</button>
                  <button class="git-btn" @click="resolveConflict('theirs')">采用远程版本</button>
                </div>
                <pre class="git-conflict-content">{{ gitStore.conflictContent }}</pre>
              </template>
              <div v-else class="git-empty">点击左侧文件查看冲突</div>
            </div>
          </div>
        </div>
        <div class="git-modal-footer">
          <button class="git-btn" @click="activePanel = 'main'">取消</button>
          <button class="git-btn git-btn--primary" @click="completeConflict" :disabled="gitStore.conflictFiles.length > 0">完成合并</button>
        </div>
      </div>

    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useGitStore } from '@/stores/git'
import { useRoomStore } from '@/stores/room'
import { useGit } from '@/composables/useGit'
import { GitBackend } from '@/core/git-backend.js'

const gitStore = useGitStore()
const roomStore = useRoomStore()
const git = useGit()

const activePanel = ref('main')
const commitMsg = ref('')
const selectedLog = ref(null)
const logDiff = ref('')
const syncing = computed(() => ['pushing', 'pulling'].includes(gitStore.syncState))
const hasDirty = computed(() => gitStore.commitFiles.length > 0)

const statusState = ref('uninit')
const statusLabel = computed(() => {
  const map = {
    uninit: '○ 未初始化',
    dirty: '● 有未提交变更',
    clean: '✓ 干净',
    ahead: '⬆ 超前远程',
    behind: '⬇ 落后远程',
    diverged: '⇅ 与远程分叉',
    conflict: '⚡ 有冲突',
    'no-remote': '○ 未设置远程',
  }
  return map[statusState.value] || statusState.value
})

const remoteForm = reactive({ url: '', token: '', authType: 'token' })

// 打开时加载状态
watch(() => gitStore.isOpen, async (open) => {
  if (!open) return
  activePanel.value = 'main'
  await refreshStatus()
})

async function refreshStatus() {
  const kbPath = gitStore.kbPath
  if (!kbPath) return
  const status = await git.loadStatus(kbPath)
  if (status) statusState.value = status.state || 'uninit'
  await git.loadCommitFiles(kbPath)
}

async function initRepo() {
  await GitBackend.init(gitStore.kbPath)
  await refreshStatus()
}

// 提交
async function openCommit() {
  await git.loadCommitFiles(gitStore.kbPath)
  activePanel.value = 'commit'
}

async function doCommit() {
  await git.doCommit(gitStore.kbPath, commitMsg.value)
  commitMsg.value = ''
  activePanel.value = 'main'
  await refreshStatus()
}

// 历史
async function openLog() {
  await git.loadLog(gitStore.kbPath)
  activePanel.value = 'log'
}

async function viewLogEntry(entry) {
  selectedLog.value = entry
  const files = await GitBackend.commitDiffFiles(gitStore.kbPath, entry.hash)
  if (files?.length) {
    const diff = await GitBackend.commitFileDiff(gitStore.kbPath, entry.hash, files[0])
    logDiff.value = diff || ''
  }
}

// 同步
async function openSync() {
  gitStore.syncState = 'idle'
  gitStore.syncMessage = ''
  activePanel.value = 'sync'
}

async function doSync(action) {
  await git.doSync(gitStore.kbPath, action)
}

// 远程
async function openRemote() {
  await git.loadRemote(gitStore.kbPath)
  remoteForm.url = gitStore.remoteUrl
  remoteForm.authType = gitStore.authType
  remoteForm.token = ''
  if (gitStore.authType === 'ssh') await git.loadSSHKey()
  activePanel.value = 'remote'
}

async function saveRemote() {
  await git.saveRemote(gitStore.kbPath, remoteForm.url, remoteForm.token, remoteForm.authType)
  activePanel.value = 'main'
}

async function copySSHKey() {
  if (gitStore.sshPublicKey) {
    await navigator.clipboard.writeText(gitStore.sshPublicKey)
  }
}

// 冲突
async function openConflict() {
  await git.loadConflicts(gitStore.kbPath)
  activePanel.value = 'conflict'
}

async function viewConflict(file) {
  await git.showConflict(gitStore.kbPath, file)
}

async function resolveConflict(resolution) {
  if (!gitStore.currentConflictFile) return
  await git.resolveConflict(gitStore.kbPath, gitStore.currentConflictFile, resolution)
}

async function completeConflict() {
  await git.completeConflict(gitStore.kbPath)
  activePanel.value = 'main'
  await refreshStatus()
}

// 工具
function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>
