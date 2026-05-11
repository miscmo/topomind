import { useWorkspaceStore } from '../stores/workspaceStore'

export async function enterHome(workDir: string) {
  await window.electronAPI?.invoke('app:enterWorkDir', workDir)
  useWorkspaceStore.getState().setCurrentWorkDir(workDir)
  useWorkspaceStore.getState().showWorkspace()
}
