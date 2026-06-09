import { createContext, useContext } from 'react'
import { browserPlatformService, type PlatformService } from './platform'

const PlatformContext = createContext<PlatformService>(browserPlatformService)

export interface PlatformProviderProps {
  children: React.ReactNode
  platform?: PlatformService
}

export function PlatformProvider({ children, platform = browserPlatformService }: PlatformProviderProps) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

export function usePlatform() {
  return useContext(PlatformContext)
}
