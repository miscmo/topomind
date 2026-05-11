import { create } from 'zustand'
import type { AppView } from '../types'

interface WorkspaceStore {
  view: AppView
  currentWorkDir: string | null
  showWorkspace: () => void
  setCurrentWorkDir: (workDir: string | null) => void
  resetWorkspace: () => void
}

export const WORKSPACE_INITIAL_STATE: Pick<WorkspaceStore, 'view' | 'currentWorkDir'> = {
  view: 'setup',
  currentWorkDir: null,
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  ...WORKSPACE_INITIAL_STATE,
  showWorkspace: () => set({ view: 'workspace' }),
  setCurrentWorkDir: (currentWorkDir) => set({ currentWorkDir }),
  resetWorkspace: () => set({ ...WORKSPACE_INITIAL_STATE }),
}))
