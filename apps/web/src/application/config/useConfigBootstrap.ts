import { useEffect, useRef, useState } from 'react'
import { CLOUD_LOCALDB_UPDATED_EVENT } from '../cloud/events'
import { LocalDB } from '../../core/localdb-backend'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { hydrateGraphUiConfig } from './configService'

export function useConfigBootstrap() {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const view = useWorkspaceStore((s) => s.view)
  const requestSeqRef = useRef(0)
  const [configError, setConfigError] = useState('')

  const hydrateCurrentWorkspaceConfig = () => {
    if (!currentWorkspaceId || view !== 'workspace') {
      return
    }
    const requestSeq = ++requestSeqRef.current
    setConfigError('')
    LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
      .then((snapshot) => {
        if (requestSeqRef.current !== requestSeq) return
        hydrateGraphUiConfig(snapshot.config.configJson)
      })
      .catch((e) => {
        if (requestSeqRef.current !== requestSeq) return
        setConfigError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      if (requestSeqRef.current === requestSeq) requestSeqRef.current += 1
    }
  }

  useEffect(() => hydrateCurrentWorkspaceConfig(), [currentWorkspaceId, view])

  useEffect(() => {
    function onBootstrapApplied(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      if (!detail?.workspaceId || detail.workspaceId !== currentWorkspaceId) {
        return
      }
      hydrateCurrentWorkspaceConfig()
    }

    window.addEventListener(CLOUD_LOCALDB_UPDATED_EVENT, onBootstrapApplied)
    return () => {
      window.removeEventListener(CLOUD_LOCALDB_UPDATED_EVENT, onBootstrapApplied)
    }
  }, [currentWorkspaceId, view])

  return { configError }
}
