<!-- Git 面板：提交、历史、同步、冲突解决 -->
<template>
  <!-- 非内联模式：使用 Teleport 模态框 -->
  <Teleport to="body" v-if="!inline">
    <div class="git-modal-overlay" :class="{ active: gitStore.isOpen }" @click.self="handleOverlayClick">
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
            <div v-for="f in gitStore.commitFiles" :key="f.path" class="git-file-item">
              <span class="git-file-status" :class="`git-file-status--${fileStatus(f).toLowerCase()}`">{{ fileStatus(f) }}</span>
              <span class="git-file-name">{{ f.path }}</span>
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
              <div v-if="logFileList.length > 1" class="git-diff-files">
                <button
                  v-for="f in logFileList"
                  :key="f"
                  class="git-diff-file-btn"
                  :class="{ active: selectedLogFile === f }"
                  @click="viewLogFile(f)"
                >{{ f }}</button>
              </div>
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
            <div v-else-if="gitStore.syncState === 'error'" class="git-sync-error">
              ✕ {{ gitStore.syncMessage }}
              <div v-if="gitStore.syncCode" class="git-sync-code">错误码：{{ gitStore.syncCode }}</div>
              <div class="git-sync-hint">{{ syncHint }}</div>
            </div>
          </div>
          <div v-if="gitStore.syncState === 'error'" class="git-sync-retry-wrap">
            <button class="git-btn" @click="doSync(lastSyncAction)">重试上次操作（{{ lastSyncAction === 'push' ? '推送' : '拉取' }}）</button>
          </div>
        </div>
        <div class="git-modal-footer">
          <button class="git-btn" @click="activePanel = 'main'">关闭</button>
          <button class="git-btn git-btn--primary" @click="doSync('pull')" :disabled="syncing">
            <span v-if="gitStore.syncState === 'pulling'">⏳ </span>{{ syncing && gitStore.syncState === 'pulling' ? '拉取中...' : '⬇ 拉取' }}
          </button>
          <button class="git-btn git-btn--primary" @click="doSync('push')" :disabled="syncing">
            <span v-if="gitStore.syncState === 'pushing'">⏳ </span>{{ syncing && gitStore.syncState === 'pushing' ? '推送中...' : '⬆ 推送' }}
          </button>
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
          <button class="git-btn git-btn--primary" @click="completeConflict" :disabled="gitStore.conflictFiles.length === 0">完成合并</button>
        </div>
      </div>

    </div>
  </Teleport>

  <!-- 内联模式：直接渲染在左侧面板中 -->
  <div v-else class="git-inline-panel">
    <!-- 主控制台面板 -->
    <div class="git-panel-section" v-if="activePanel === 'main'">
      <div class="git-status-summary">
        <div class="git-status-state" :class="`git-state--${statusState}`">{{ statusLabel }}</div>
      </div>
      <div class="git-action-grid">
        <button class="git-action-btn" @click="openCommit" :disabled="!hasDirty">
          <span>📝</span> 提交
          <span v-if="gitStore.commitFiles.length" class="git-count-badge">{{ gitStore.commitFiles.length }}</span>
        </button>
        <button class="git-action-btn" @click="openLog">
          <span>📜</span> 历史
        </button>
        <button class="git-action-btn" @click="openSync">
          <span>🔄</span> 同步
        </button>
        <button class="git-action-btn" @click="openRemote">
          <span>⚙</span> 远程
        </button>
        <button v-if="gitStore.hasConflicts" class="git-action-btn git-action-btn--danger" @click="openConflict">
          <span>⚡</span> 冲突 ({{ gitStore.conflictFiles.length }})
        </button>
      </div>
      <div class="git-panel-footer">
        <button class="git-btn git-btn--primary" @click="initRepo" v-if="statusState === 'uninit'">初始化</button>
      </div>
    </div>

    <!-- 提交面板 -->
    <div class="git-panel-section" v-else-if="activePanel === 'commit'">
      <div class="git-panel-header">
        <span>提交变更</span>
        <button class="git-inline-back" @click="activePanel = 'main'">← 返回</button>
      </div>
      <div class="git-file-list">
        <div v-for="f in gitStore.commitFiles" :key="f.path" class="git-file-item">
          <span class="git-file-status" :class="`git-file-status--${fileStatus(f).toLowerCase()}`">{{ fileStatus(f) }}</span>
          <span class="git-file-name">{{ f.path }}</span>
        </div>
        <div v-if="!gitStore.commitFiles.length" class="git-empty">没有待提交的变更</div>
      </div>
      <div class="git-commit-msg-label">提交说明</div>
      <textarea class="git-commit-msg-input" v-model="commitMsg" placeholder="留空则自动生成..."></textarea>
      <div class="git-panel-footer">
        <button class="git-btn" @click="activePanel = 'main'">取消</button>
        <button class="git-btn git-btn--primary" @click="doCommit" :disabled="!gitStore.commitFiles.length">提交</button>
      </div>
    </div>

    <!-- 历史/Diff 面板 -->
    <div class="git-panel-section" v-else-if="activePanel === 'log'">
      <div class="git-panel-header">
        <span>提交历史</span>
        <button class="git-inline-back" @click="activePanel = 'main'">← 返回</button>
      </div>
      <div class="git-diff-layout">
        <div class="git-diff-sidebar">
          <div
            v-for="entry in gitStore.logEntries" :key="entry.hash"
            class="git-log-item" :class="{ active: selectedLog?.hash === entry.hash }"
            @click="viewLogEntry(entry)"
          >
            <div class="git-log-hash">{{ entry.hash?.slice(0, 7) }}</div>
            <div class="git-log-msg">{{ entry.message }}</div>
          </div>
          <div v-if="!gitStore.logEntries.length" class="git-empty">暂无记录</div>
        </div>
        <div class="git-diff-main">
          <pre v-if="logDiff" class="git-diff-content">{{ logDiff }}</pre>
          <div v-else class="git-empty">点击查看</div>
        </div>
      </div>
    </div>

    <!-- 同步面板 -->
    <div class="git-panel-section" v-else-if="activePanel === 'sync'">
      <div class="git-panel-header">
        <span>同步</span>
        <button class="git-inline-back" @click="activePanel = 'main'">← 返回</button>
      </div>
      <div class="git-sync-summary">
        <div v-if="gitStore.syncState === 'idle'">准备就绪</div>
        <div v-else-if="gitStore.syncState === 'pushing'">⏳ 推送中...</div>
        <div v-else-if="gitStore.syncState === 'pulling'">⏳ 拉取中...</div>
        <div v-else-if="gitStore.syncState === 'done'" class="git-sync-success">✓ {{ gitStore.syncMessage }}</div>
        <div v-else-if="gitStore.syncState === 'error'" class="git-sync-error">✕ {{ gitStore.syncMessage }}</div>
      </div>
      <div class="git-panel-footer">
        <button class="git-btn" @click="activePanel = 'main'">返回</button>
        <button class="git-btn" @click="doSync('pull')" :disabled="syncing">⬇ 拉取</button>
        <button class="git-btn git-btn--primary" @click="doSync('push')" :disabled="syncing">⬆ 推送</button>
      </div>
    </div>

    <!-- 远程设置面板 -->
    <div class="git-panel-section" v-else-if="activePanel === 'remote'">
      <div class="git-panel-header">
        <span>远程仓库</span>
        <button class="git-inline-back" @click="activePanel = 'main'">← 返回</button>
      </div>
      <div class="git-form-group">
        <label class="git-form-label">认证</label>
        <div class="git-radio-group">
          <label><input type="radio" v-model="remoteForm.authType" value="token" /> Token</label>
          <label><input type="radio" v-model="remoteForm.authType" value="ssh" /> SSH</label>
        </div>
      </div>
      <div class="git-form-group">
        <label class="git-form-label">仓库 URL</label>
        <input class="git-form-input" v-model="remoteForm.url" placeholder="https://github.com/..." />
      </div>
      <div v-if="remoteForm.authType === 'token'" class="git-form-group">
        <label class="git-form-label">Token</label>
        <input class="git-form-input" v-model="remoteForm.token" type="password" placeholder="ghp_xxx" />
      </div>
      <div v-else class="git-form-group">
        <label class="git-form-label">SSH 公钥</label>
        <div class="git-ssh-pubkey">{{ gitStore.sshPublicKey || '加载中...' }}</div>
        <button class="git-ssh-copy-btn" @click="copySSHKey">复制</button>
      </div>
      <div class="git-panel-footer">
        <button class="git-btn" @click="activePanel = 'main'">取消</button>
        <button class="git-btn git-btn--primary" @click="saveRemote">保存</button>
      </div>
    </div>

    <!-- 冲突解决面板 -->
    <div class="git-panel-section" v-else-if="activePanel === 'conflict'">
      <div class="git-panel-header">
        <span>解决冲突</span>
        <button class="git-inline-back" @click="activePanel = 'main'">← 返回</button>
      </div>
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
              <button class="git-btn" @click="resolveConflict('ours')">本地</button>
              <button class="git-btn" @click="resolveConflict('theirs')">远程</button>
            </div>
            <pre class="git-conflict-content">{{ gitStore.conflictContent }}</pre>
          </template>
          <div v-else class="git-empty">点击文件查看</div>
        </div>
      </div>
      <div class="git-panel-footer">
        <button class="git-btn" @click="activePanel = 'main'">返回</button>
        <button class="git-btn git-btn--primary" @click="completeConflict" :disabled="gitStore.conflictFiles.length === 0">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useGitStore } from '@/stores/git'
import { useRoomStore } from '@/stores/room'
import { useGit } from '@/composables/useGit'
import { GitBackend } from '@/core/git-backend.js'

const props = defineProps({
  inline: { type: Boolean, default: false }
})

const gitStore = useGitStore()
const roomStore = useRoomStore()
const git = useGit()

const activePanel = ref('main')
const commitMsg = ref('')
const selectedLog = ref(null)
const logDiff = ref('')
const logFileList = ref([])
const selectedLogFile = ref('')
const syncing = computed(() => ['pushing', 'pulling'].includes(gitStore.syncState))
const hasDirty = computed(() => gitStore.commitFiles.length > 0)
const lastSyncAction = ref('pull')
const syncHint = computed(() => {
  const code = gitStore.syncCode
  if (code === 'AUTH_FAILED') return '请检查 Token / SSH 密钥与远程仓库权限。'
  if (code === 'TIMEOUT') return '网络超时，请检查网络后重试。'
  if (code === 'PUSH_REJECTED') return '远程有新提交，先拉取再推送。'
  if (code === 'CONFLICT') return '检测到冲突，请进入冲突解决流程。'
  return '可点击重试；若持续失败请检查远程地址与认证配置。'
})

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
}, { immediate: true })

// 在 inline 模式下，切换到该 Tab 时自动打开
watch(() => props.inline, (inline) => {
  if (inline && !gitStore.isOpen) {
    gitStore.isOpen = true
  }
})

function handleOverlayClick() {
  // 模态框模式下点击遮罩层不关闭（在 GraphView 切换 Tab 时会处理）
}

// 刷新状态
async function refreshStatus() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  if (!kbPath) return
  const status = await git.loadStatus(kbPath)
  if (status) statusState.value = status.state || 'uninit'
  await git.loadCommitFiles(kbPath)
}

async function initRepo() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await GitBackend.init(kbPath)
  await refreshStatus()
}

// 提交
async function openCommit() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.loadCommitFiles(kbPath)
  activePanel.value = 'commit'
}

async function doCommit() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.doCommit(kbPath, commitMsg.value)
  commitMsg.value = ''
  activePanel.value = 'main'
  await refreshStatus()
}

// 历史
async function openLog() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.loadLog(kbPath)
  activePanel.value = 'log'
}

async function viewLogEntry(entry) {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  selectedLog.value = entry
  logDiff.value = ''
  logFileList.value = []
  const filesRes = await GitBackend.commitDiffFiles(kbPath, entry.hash)
  const files = Array.isArray(filesRes?.files) ? filesRes.files : []
  logFileList.value = files.map(f => f.path).filter(Boolean)
  if (logFileList.value.length) {
    selectedLogFile.value = logFileList.value[0]
    const diffRes = await GitBackend.commitFileDiff(kbPath, entry.hash, selectedLogFile.value)
    logDiff.value = diffRes?.diff || ''
  }
}

async function viewLogFile(file) {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  selectedLogFile.value = file
  const diffRes = await GitBackend.commitFileDiff(kbPath, selectedLog.value.hash, file)
  logDiff.value = diffRes?.diff || ''
}

// 同步
async function openSync() {
  gitStore.syncState = 'idle'
  gitStore.syncMessage = ''
  activePanel.value = 'sync'
}

async function doSync(action) {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  lastSyncAction.value = action
  await git.doSync(kbPath, action)
}

// 远程
async function openRemote() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.loadRemote(kbPath)
  remoteForm.url = gitStore.remoteUrl
  remoteForm.authType = gitStore.authType
  remoteForm.token = ''
  if (gitStore.authType === 'ssh') await git.loadSSHKey()
  activePanel.value = 'remote'
}

async function saveRemote() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.saveRemote(kbPath, remoteForm.url, remoteForm.token, remoteForm.authType)
  activePanel.value = 'main'
}

async function copySSHKey() {
  if (gitStore.sshPublicKey) {
    await navigator.clipboard.writeText(gitStore.sshPublicKey)
  }
}

// 冲突
async function openConflict() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.loadConflicts(kbPath)
  activePanel.value = 'conflict'
}

async function viewConflict(file) {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.showConflict(kbPath, file)
}

async function resolveConflict(resolution) {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  if (!gitStore.currentConflictFile) return
  await git.resolveConflict(kbPath, gitStore.currentConflictFile, resolution)
}

async function completeConflict() {
  const kbPath = gitStore.kbPath || roomStore.currentKBPath
  await git.completeConflict(kbPath)
  activePanel.value = 'main'
  await refreshStatus()
}

// 工具
function fileStatus(f) {
  if (f?.isNew) return 'A'
  if ((f?.deletions || 0) > 0 && (f?.insertions || 0) === 0) return 'D'
  return 'M'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<style>
/* 内联模式样式 */
.git-inline-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.git-panel-section {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.git-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #e8ecf0;
  font-size: 13px;
  font-weight: 600;
  color: #1a3a5c;
  flex-shrink: 0;
}

.git-inline-back {
  border: none;
  background: transparent;
  color: #3498db;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.git-inline-back:hover {
  background: #e8f4fc;
}

.git-panel-footer {
  padding: 8px 10px;
  border-top: 1px solid #e8ecf0;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.git-inline-panel .git-status-summary {
  margin-bottom: 8px;
}

.git-inline-panel .git-action-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.git-inline-panel .git-action-btn {
  padding: 8px 6px;
  font-size: 11px;
  border-radius: 6px;
}

.git-inline-panel .git-status-state {
  font-size: 11px;
  padding: 4px 8px;
}

.git-inline-panel .git-form-group {
  margin-bottom: 8px;
}

.git-inline-panel .git-form-label {
  font-size: 11px;
  margin-bottom: 3px;
  color: #7b8794;
}

.git-inline-panel .git-form-input {
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid #e0e4ea;
  width: 100%;
  box-sizing: border-box;
}

.git-inline-panel .git-radio-group {
  font-size: 12px;
}

.git-inline-panel .git-radio-group label {
  margin-right: 8px;
}

.git-inline-panel .git-file-list {
  max-height: 100px;
  overflow-y: auto;
  margin-bottom: 8px;
}

.git-inline-panel .git-commit-msg-input {
  font-size: 12px;
  min-height: 50px;
  border-radius: 6px;
  padding: 6px 8px;
  resize: vertical;
  border: 1px solid #e0e4ea;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 8px;
}

.git-inline-panel .git-diff-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.git-inline-panel .git-diff-sidebar {
  width: 100px;
  flex-shrink: 0;
  border-right: 1px solid #e8ecf0;
  overflow-y: auto;
  padding: 4px;
}

.git-inline-panel .git-diff-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 4px;
}

.git-inline-panel .git-log-item {
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 10px;
  margin-bottom: 2px;
  cursor: pointer;
}

.git-inline-panel .git-log-item:hover {
  background: #f0f2f5;
}

.git-inline-panel .git-log-item.active {
  background: #e8f4fc;
}

.git-inline-panel .git-log-hash {
  font-size: 9px;
  color: #888;
  margin-bottom: 2px;
}

.git-inline-panel .git-log-msg {
  color: #333;
  word-break: break-all;
}

.git-inline-panel .git-diff-content {
  font-size: 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  padding: 4px;
}

.git-inline-panel .git-sync-summary {
  padding: 8px 0;
  font-size: 12px;
  color: #333;
}

.git-inline-panel .git-conflict-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.git-inline-panel .git-conflict-sidebar {
  width: 80px;
  flex-shrink: 0;
  border-right: 1px solid #e8ecf0;
  overflow-y: auto;
  padding: 4px;
}

.git-inline-panel .git-conflict-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.git-inline-panel .git-conflict-file-item {
  padding: 6px 8px;
  font-size: 10px;
  border-radius: 4px;
  cursor: pointer;
  word-break: break-all;
}

.git-inline-panel .git-conflict-file-item:hover {
  background: #f0f2f5;
}

.git-inline-panel .git-conflict-file-item.active {
  background: #e8f4fc;
}

.git-inline-panel .git-conflict-actions {
  padding: 6px;
  display: flex;
  gap: 6px;
}

.git-inline-panel .git-conflict-actions .git-btn {
  padding: 4px 8px;
  font-size: 11px;
}

.git-inline-panel .git-conflict-content {
  padding: 8px;
  font-size: 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.git-inline-panel .git-empty {
  padding: 12px;
  font-size: 11px;
  color: #aaa;
  text-align: center;
}

.git-inline-panel .git-ssh-pubkey {
  font-size: 9px;
  padding: 6px;
  word-break: break-all;
  background: #f5f5f5;
  border-radius: 4px;
  margin-top: 4px;
}

.git-inline-panel .git-ssh-copy-btn {
  font-size: 10px;
  padding: 3px 8px;
  margin-top: 4px;
}
</style>