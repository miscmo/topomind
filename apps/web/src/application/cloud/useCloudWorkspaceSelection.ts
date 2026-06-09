import { useEffect, useRef } from 'react'

import { handleUnauthorizedCloudSession } from '../../core/auth-session'
import { cloudApi } from '../../core/cloud-api'
import { logger } from '../../core/logger'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import type { CloudWorkspaceOption } from '../../stores/workspaceStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const CLOUD_WORKSPACE_STORAGE_KEY = 'topomind_cloud_workspace_id'

function readStoredWorkspaceId() {
  try {
    return localStorage.getItem(CLOUD_WORKSPACE_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredWorkspaceId(workspaceId: string | null) {
  try {
    if (workspaceId) {
      localStorage.setItem(CLOUD_WORKSPACE_STORAGE_KEY, workspaceId)
      return
    }
    localStorage.removeItem(CLOUD_WORKSPACE_STORAGE_KEY)
  } catch {
    // Ignore persistence errors in restricted environments.
  }
}

function pickWorkspaceId(
  items: CloudWorkspaceOption[],
  currentWorkspaceId: string | null,
  storedWorkspaceId: string | null,
) {
  if (currentWorkspaceId && items.some((item) => item.id === currentWorkspaceId)) {
    return currentWorkspaceId
  }
  if (storedWorkspaceId && items.some((item) => item.id === storedWorkspaceId)) {
    return storedWorkspaceId
  }
  if (items.length === 1) {
    return items[0].id
  }
  return null
}

export function useCloudWorkspaceSelection() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId)
  const setAvailableWorkspaces = useWorkspaceStore((s) => s.setAvailableWorkspaces)
  const setWorkspaceSelectionLoading = useWorkspaceStore((s) => s.setWorkspaceSelectionLoading)
  const setWorkspaceSelectionError = useWorkspaceStore((s) => s.setWorkspaceSelectionError)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    if (!accessToken) {
      setAvailableWorkspaces([])
      setWorkspaceSelectionLoading(false)
      setWorkspaceSelectionError('')
      if (currentWorkspaceId) {
        setCurrentWorkspaceId(null)
      }
      return
    }

    const requestSeq = ++requestSeqRef.current
    setWorkspaceSelectionLoading(true)
    setWorkspaceSelectionError('')

    cloudApi
      .getWorkspaces()
      .then(({ items }) => {
        if (requestSeqRef.current !== requestSeq) {
          return
        }

        setAvailableWorkspaces(items)

        const storedWorkspaceId = readStoredWorkspaceId()
        const resolvedWorkspaceId = pickWorkspaceId(items, currentWorkspaceId, storedWorkspaceId)

        if (resolvedWorkspaceId) {
          if (resolvedWorkspaceId !== currentWorkspaceId) {
            setCurrentWorkspaceId(resolvedWorkspaceId)
          }
          writeStoredWorkspaceId(resolvedWorkspaceId)
          logger.info('CloudWorkspace', '云工作区选择已恢复', {
            workspaceId: resolvedWorkspaceId,
            workspaceCount: items.length,
          })
          return
        }

        if (currentWorkspaceId && !items.some((item) => item.id === currentWorkspaceId)) {
          setCurrentWorkspaceId(null)
        }
        if (storedWorkspaceId && !items.some((item) => item.id === storedWorkspaceId)) {
          writeStoredWorkspaceId(null)
        }
        logger.info('CloudWorkspace', '云工作区列表已加载，等待用户显式选择', {
          workspaceCount: items.length,
        })
      })
      .catch((error) => {
        if (requestSeqRef.current !== requestSeq) {
          return
        }
        if (handleUnauthorizedCloudSession(error)) {
          setAvailableWorkspaces([])
          setWorkspaceSelectionError('')
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setAvailableWorkspaces([])
        setWorkspaceSelectionError(message)
        logger.catch('CloudWorkspace', '恢复云工作区选择', error)
      })
      .finally(() => {
        if (requestSeqRef.current === requestSeq) {
          setWorkspaceSelectionLoading(false)
        }
      })

    return () => {
      if (requestSeqRef.current === requestSeq) {
        requestSeqRef.current += 1
      }
    }
  }, [
    accessToken,
    currentWorkspaceId,
    setAvailableWorkspaces,
    setCurrentWorkspaceId,
    setWorkspaceSelectionError,
    setWorkspaceSelectionLoading,
  ])
}
