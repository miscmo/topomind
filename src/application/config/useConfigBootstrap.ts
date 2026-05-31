import { useEffect, useRef, useState } from 'react'
import { useStorage } from '../../core/storage'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { hydrateGraphUiConfig } from './configService'

export function useConfigBootstrap() {
  const storage = useStorage()
  const currentWorkDir = useWorkspaceStore((s) => s.currentWorkDir)
  const view = useWorkspaceStore((s) => s.view)
  const requestSeqRef = useRef(0)
  const [configError, setConfigError] = useState('')

  useEffect(() => {
    if (!currentWorkDir || view !== 'workspace') return
    const requestSeq = ++requestSeqRef.current
    setConfigError('')
    storage.readConfig().then((config) => {
      if (requestSeqRef.current !== requestSeq) return
      hydrateGraphUiConfig(config)
    }).catch((e) => {
      if (requestSeqRef.current !== requestSeq) return
      setConfigError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      if (requestSeqRef.current === requestSeq) requestSeqRef.current += 1
    }
  }, [currentWorkDir, storage, view])

  return { configError }
}
