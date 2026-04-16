/**
 * Git 状态 store
 * 替代原 git.js 中的模块级变量：
 *   _kbPath, _commitFiles, _logEntries, _syncState, _conflictFiles 等
 */
import { defineStore } from 'pinia'

export const useGitStore = defineStore('git', {
  state: () => ({
    /** 当前操作的知识库路径 */
    kbPath: null,
    /** Git 面板是否打开 */
    isOpen: false,
    /** 待提交文件列表 [{ file, status }] */
    commitFiles: [],
    /** 提交历史 */
    logEntries: [],
    /** 同步状态：'idle' | 'pushing' | 'pulling' | 'done' | 'error' */
    syncState: 'idle',
    syncMessage: '',
    syncCode: '',
    /** 冲突文件列表 */
    conflictFiles: [],
    /** 当前查看的冲突文件 */
    currentConflictFile: null,
    /** 冲突内容 */
    conflictContent: '',
    /** 远程 URL */
    remoteUrl: '',
    /** 认证方式：'token' | 'ssh' */
    authType: 'token',
    /** SSH 公钥 */
    sshPublicKey: '',
    /** 未提交变更数量（用于工具栏 Git 徽标） */
    dirtyCount: 0,
  }),

  getters: {
    hasDirtyFiles: (state) => state.dirtyCount > 0,
    hasConflicts: (state) => state.conflictFiles.length > 0,
  },

  actions: {
    openForKB(kbPath) {
      this.kbPath = kbPath
      this.isOpen = true
    },
    close() {
      this.isOpen = false
    },
    setDirtyCount(count) {
      this.dirtyCount = count
    },
    setCommitFiles(files) {
      this.commitFiles = files || []
    },
    setSyncState(state, message = '', code = '') {
      this.syncState = state
      this.syncMessage = message
      this.syncCode = code
    },
    setConflictFiles(files) {
      this.conflictFiles = files || []
    },
    setLogEntries(entries) {
      this.logEntries = entries || []
    },
    setRemote(url, authType) {
      this.remoteUrl = url || ''
      this.authType = authType || 'token'
    },
    setSSHKey(publicKey) {
      this.sshPublicKey = publicKey || ''
    },
    setConflictContent(file, content) {
      this.currentConflictFile = file
      this.conflictContent = content || ''
    },
    removeConflictFile(file) {
      const idx = this.conflictFiles.indexOf(file)
      if (idx !== -1) this.conflictFiles.splice(idx, 1)
      if (this.currentConflictFile === file) {
        this.currentConflictFile = null
        this.conflictContent = ''
      }
    },
  },
})
