/**
 * Git 状态管理（Zustand）
 * 替代 Vue3 Pinia 的 git store
 */
import { create } from 'zustand'

interface GitState {
  // Git 认证
  token: string
  authType: 'token' | 'ssh'
  sshKey: string
  // Git 可用性
  available: boolean
  // 当前 KB 的 Git 状态
  status: GitRepoStatus

  // Actions
  setToken: (token: string) => void
  setAuthType: (type: 'token' | 'ssh') => void
  setSSHKey: (key: string) => void
  setAvailable: (available: boolean) => void
  setStatus: (status: Partial<GitRepoStatus>) => void
  clearGit: () => void
}

export interface GitRepoStatus {
  initialized: boolean
  clean: boolean
  untrackedCount: number
  modifiedCount: number
  ahead: number
  behind: number
  diverged: boolean
  hasConflict: boolean
  conflictFiles: string[]
  hasRemote: boolean
  remoteUrl: string
}

/** 初始 Git 状态 */
const initialStatus: GitRepoStatus = {
  initialized: false,
  clean: true,
  untrackedCount: 0,
  modifiedCount: 0,
  ahead: 0,
  behind: 0,
  diverged: false,
  hasConflict: false,
  conflictFiles: [],
  hasRemote: false,
  remoteUrl: '',
}

export const useGitStore = create<GitState>((set) => ({
  token: '',
  authType: 'token',
  sshKey: '',
  available: false,
  status: { ...initialStatus },

  setToken: (token) => set({ token }),
  setAuthType: (authType) => set({ authType }),
  setSSHKey: (sshKey) => set({ sshKey }),
  setAvailable: (available) => set({ available }),
  setStatus: (partial) => set((state) => ({
    status: { ...state.status, ...partial },
  })),
  clearGit: () => set({
    status: { ...initialStatus },
  }),
}))
