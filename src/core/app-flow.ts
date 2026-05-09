import { useAppStore } from '../stores/appStore'

export async function enterHome(workDir: string, options: { applyWindowState?: boolean } = {}) {
  if (options.applyWindowState !== false) {
    await window.electronAPI?.invoke('app:navigateHome')
  }
  useAppStore.getState().setCurrentWorkDir(workDir)
  useAppStore.getState().showWorkspace()
}
