import { create } from 'zustand'
import type { AppView } from '../types'

interface WorkspaceStore {
  view: AppView
  currentWorkDir: string | null
  currentWorkspaceId: string | null
  skipAutoLoad: boolean
  showWorkspace: () => void
  setCurrentWorkDir: (workDir: string | null) => void
  setCurrentWorkspaceId: (workspaceId: string | null) => void
  resetWorkspace: () => void
  setSkipAutoLoad: (skip: boolean) => void
}

export const WORKSPACE_INITIAL_STATE: Pick<
  WorkspaceStore,
  'view' | 'currentWorkDir' | 'currentWorkspaceId' | 'skipAutoLoad'
> = {
  view: 'setup',
  currentWorkDir: null,
  currentWorkspaceId: null,
  skipAutoLoad: false,
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  ...WORKSPACE_INITIAL_STATE,
  showWorkspace: () => set({ view: 'workspace' }),
  setCurrentWorkDir: (currentWorkDir) => set({ currentWorkDir }),
  setCurrentWorkspaceId: (currentWorkspaceId) => set({ currentWorkspaceId }),
  resetWorkspace: () => set({ ...WORKSPACE_INITIAL_STATE, skipAutoLoad: true }),
  setSkipAutoLoad: (skipAutoLoad) => set({ skipAutoLoad }),
}))
