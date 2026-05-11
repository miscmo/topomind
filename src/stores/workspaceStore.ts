import { create } from 'zustand'
import type { WorkspaceStoreState } from './uiStoreTypes'

interface WorkspaceStore extends WorkspaceStoreState {
  resetWorkspace: () => void
}

export const WORKSPACE_INITIAL_STATE: Pick<WorkspaceStoreState, 'view' | 'currentWorkDir'> = {
  view: 'setup',
  currentWorkDir: null,
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  ...WORKSPACE_INITIAL_STATE,
  showWorkspace: () => set({ view: 'workspace' }),
  setCurrentWorkDir: (currentWorkDir) => set({ currentWorkDir }),
  resetWorkspace: () => set({ ...WORKSPACE_INITIAL_STATE }),
}))
