import { FSB } from './fs-backend'

export interface PlatformDialogResult {
  valid: boolean
  nodePath?: string | null
  path?: string
  error?: string
}

export interface PlatformService {
  selectDirectory: () => Promise<PlatformDialogResult>
}

export const electronPlatformService: PlatformService = {
  selectDirectory: () => FSB.selectDirectory(),
}
