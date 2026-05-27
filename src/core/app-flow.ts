import { useWorkspaceStore } from '../stores/workspaceStore'
import { addRecentWorkspace } from './workspace-cache'

export async function enterHome(workDir: string) {
  const result = await window.electronAPI?.invoke('app:enterWorkDir', workDir) as { ok?: boolean; error?: string } | undefined
  if (!result?.ok) {
    throw new Error(result?.error || '进入工作目录失败')
  }
  useWorkspaceStore.getState().setCurrentWorkDir(workDir)
  addRecentWorkspace(workDir)
  useWorkspaceStore.getState().showWorkspace()
}
