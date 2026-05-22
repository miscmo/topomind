import { useWorkspaceStore } from '../stores/workspaceStore'
import { addRecentWorkspace } from './workspace-cache'

export async function enterHome(workDir: string) {
  await window.electronAPI?.invoke('app:enterWorkDir', workDir)
  useWorkspaceStore.getState().setCurrentWorkDir(workDir)
  addRecentWorkspace(workDir)
  useWorkspaceStore.getState().showWorkspace()
}
