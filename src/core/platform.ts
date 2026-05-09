import { FSB } from './fs-backend'

export interface PlatformDialogResult {
  valid: boolean
  nodePath?: string | null
  path?: string
  error?: string
}

export interface PlatformService {
  selectDirectory: () => Promise<PlatformDialogResult>
  openPath: (path: string) => Promise<void>
}

export const electronPlatformService: PlatformService = {
  selectDirectory: () => FSB.selectWorkDirCandidate(),
  openPath: async (path) => {
    await FSB.openInFinder(path)
  },
}
