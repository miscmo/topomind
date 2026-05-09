import { createContext, useContext } from 'react'
import { electronPlatformService, type PlatformService } from './platform'

const PlatformContext = createContext<PlatformService>(electronPlatformService)

export interface PlatformProviderProps {
  children: React.ReactNode
  platform?: PlatformService
}

export function PlatformProvider({ children, platform = electronPlatformService }: PlatformProviderProps) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

export function usePlatform() {
  return useContext(PlatformContext)
}
