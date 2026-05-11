import { useWorkspaceStore } from '../stores/workspaceStore'

export async function enterHome(workDir: string, options: { applyWindowState?: boolean } = {}) {
  if (options.applyWindowState !== false) {
    await window.electronAPI?.invoke('app:navigateHome')
  }
  useWorkspaceStore.getState().setCurrentWorkDir(workDir)
  useWorkspaceStore.getState().showWorkspace()
}
