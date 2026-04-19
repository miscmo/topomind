/**
 * Git 状态 store
 * 替代原 git.js 中的模块级变量：
 *   _kbPath, _commitFiles, _logEntries, _syncState, _conflictFiles 等
 */
import { defineStore } from 'pinia'

/**
 * 管理 Git 面板、同步状态、冲突处理和远程配置的全局 store。
 *
 * @returns {import('pinia').StoreDefinition} Git store 定义
 */
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
    /** 当前知识库是否存在未提交改动。 */
    hasDirtyFiles: (state) => state.dirtyCount > 0,
    /** 当前知识库是否存在冲突文件。 */
    hasConflicts: (state) => state.conflictFiles.length > 0,
  },

  actions: {
    /** 打开指定知识库的 Git 面板。 */
    openForKB(kbPath) {
      this.kbPath = kbPath
      this.isOpen = true
    },
    /** 关闭 Git 面板。 */
    close() {
      this.isOpen = false
    },
    /** 更新未提交变更数量。 */
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
      this.conflictFiles = this.conflictFiles.filter(f => f !== file)
      if (this.currentConflictFile === file) {
        this.currentConflictFile = null
        this.conflictContent = ''
      }
    },
  },
})
