import { create } from 'zustand'
import type { AppView } from '../types'

export interface CloudWorkspaceOption {
  id: string
  name: string
  role: string
  updatedAt: string
}

export interface WorkspaceStore {
  view: AppView
  /** @deprecated Web 主线已改为以 currentWorkspaceId 为主，此字段仅保留给尚未迁移的旧逻辑。 */
  currentWorkspaceRoot: string | null
  currentWorkspaceId: string | null
  availableWorkspaces: CloudWorkspaceOption[]
  workspaceSelectionLoading: boolean
  workspaceSelectionError: string
  skipAutoLoad: boolean
  showWorkspace: () => void
  /** @deprecated Web 主线不再依赖本地工作目录，后续待删除。 */
  setCurrentWorkspaceRoot: (workspaceRoot: string | null) => void
  setCurrentWorkspaceId: (workspaceId: string | null) => void
  setAvailableWorkspaces: (items: CloudWorkspaceOption[]) => void
  setWorkspaceSelectionLoading: (loading: boolean) => void
  setWorkspaceSelectionError: (message: string) => void
  resetWorkspace: () => void
  setSkipAutoLoad: (skip: boolean) => void
}

export const WORKSPACE_INITIAL_STATE: Pick<
  WorkspaceStore,
  | 'view'
  | 'currentWorkspaceRoot'
  | 'currentWorkspaceId'
  | 'availableWorkspaces'
  | 'workspaceSelectionLoading'
  | 'workspaceSelectionError'
  | 'skipAutoLoad'
> = {
  view: 'setup',
  currentWorkspaceRoot: null,
  currentWorkspaceId: null,
  availableWorkspaces: [],
  workspaceSelectionLoading: false,
  workspaceSelectionError: '',
  skipAutoLoad: false,
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  ...WORKSPACE_INITIAL_STATE,
  showWorkspace: () => set({ view: 'workspace' }),
  setCurrentWorkspaceRoot: (currentWorkspaceRoot) => set({ currentWorkspaceRoot }),
  setCurrentWorkspaceId: (currentWorkspaceId) => set({ currentWorkspaceId }),
  setAvailableWorkspaces: (availableWorkspaces) => set({ availableWorkspaces }),
  setWorkspaceSelectionLoading: (workspaceSelectionLoading) => set({ workspaceSelectionLoading }),
  setWorkspaceSelectionError: (workspaceSelectionError) => set({ workspaceSelectionError }),
  resetWorkspace: () => set({ ...WORKSPACE_INITIAL_STATE, skipAutoLoad: true }),
  setSkipAutoLoad: (skipAutoLoad) => set({ skipAutoLoad }),
}))
