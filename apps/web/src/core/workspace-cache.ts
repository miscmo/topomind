export const RECENT_WORKSPACES_KEY = 'topomind_recent_workspace_roots'
export const LAST_WORKSPACE_KEY = 'topomind_last_workspace_root'

export interface RecentWorkspace {
  workspaceRoot: string
  lastOpened: number
}

export function getRecentWorkspaces(): RecentWorkspace[] {
  try {
    const data = localStorage.getItem(RECENT_WORKSPACES_KEY)
    if (data) {
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('Failed to parse recent workspaces', e)
  }
  return []
}

export function addRecentWorkspace(workspaceRoot: string) {
  const workspaces = getRecentWorkspaces()
  const existingIndex = workspaces.findIndex((workspace) => workspace.workspaceRoot === workspaceRoot)
  if (existingIndex >= 0) {
    workspaces.splice(existingIndex, 1)
  }
  workspaces.unshift({ workspaceRoot, lastOpened: Date.now() })
  if (workspaces.length > 10) {
    workspaces.length = 10
  }
  localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(workspaces))
  localStorage.setItem(LAST_WORKSPACE_KEY, workspaceRoot)
}

export function getLastWorkspace(): string | null {
  return localStorage.getItem(LAST_WORKSPACE_KEY)
}

export function clearLastWorkspace() {
  localStorage.removeItem(LAST_WORKSPACE_KEY)
}

export function removeRecentWorkspace(workspaceRoot: string) {
  const workspaces = getRecentWorkspaces()
  const newWorkspaces = workspaces.filter((workspace) => workspace.workspaceRoot !== workspaceRoot)
  localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(newWorkspaces))
  if (getLastWorkspace() === workspaceRoot) {
    clearLastWorkspace()
  }
}
