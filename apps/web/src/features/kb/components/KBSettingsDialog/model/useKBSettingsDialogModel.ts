import { useCallback, useEffect, useState, useRef } from 'react'
import { CLOUD_LOCALDB_UPDATED_EVENT } from '../../../../../application/cloud/events'
import { syncWorkspacePullIntoLocalMirror } from '../../../../../application/cloud/localdb-sync'
import { cloudApi } from '../../../../../core/cloud-api'
import { LocalDB } from '../../../../../core/localdb-backend'
import { useStorage } from '../../../../../core/storage'
import { normalizeAttachmentMimeType } from '../../../../../core/attachment-upload-ticket'
import { usePromptStore } from '../../../../../shared/ui/PromptModal/promptStore'
import { tabStore } from '../../../../../stores/tabs/tabStore'
import { useWorkspaceStore } from '../../../../../stores/workspaceStore'
import { logAction } from '../../../../../core/log-backend'
import type { KBItem } from '../../../model/useHomeKnowledgeBases'

export interface KBSettingsDialogProps {
  visible: boolean
  kb: KBItem | null
  onClose: () => void
  refreshKBList: () => Promise<void>
}

export function useKBSettingsDialogModel({ visible, kb, onClose, refreshKBList }: KBSettingsDialogProps) {
  const storage = useStorage()
  const prompt = usePromptStore((s: any) => s.open)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const isCloudMode = Boolean(currentWorkspaceId)

  const [dialogKb, setDialogKb] = useState<KBItem | null>(kb)
  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [coverRef, setCoverRef] = useState('') // the ref path saved to config
  const [pendingCoverAttachmentId, setPendingCoverAttachmentId] = useState<string | null | undefined>(undefined)
  const [coverOffset, setCoverOffset] = useState(50) // Percentage offset for object-position (0-100)
  const [initialCoverOffset, setInitialCoverOffset] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const imageRef = useRef<HTMLImageElement>(null)
  const isDragging = useRef(false)
  const startY = useRef(0)
  const startOffset = useRef(50)
  const currentKb = kb ?? dialogKb

  useEffect(() => {
    if (visible && kb) {
      setDialogKb(kb)
    }
  }, [visible, kb])

  useEffect(() => {
    if (visible && kb) {
      setName(kb.name)
      setCoverUrl(kb.coverUrl || '')
      setCoverRef('')
      setPendingCoverAttachmentId(undefined)
      setCoverOffset(kb.coverOffset ?? 50)
      setInitialCoverOffset(kb.coverOffset ?? 50)
      setError('')
    }
  }, [visible, kb])

  const hasCoverAttachmentIdChange =
    isCloudMode
      && currentKb
      && pendingCoverAttachmentId !== undefined
      && pendingCoverAttachmentId !== currentKb.coverAttachmentId
  const hasUnsavedChanges =
    Boolean(currentKb)
    && (
      name.trim() !== (currentKb?.name ?? '')
      || coverOffset !== initialCoverOffset
      || (!isCloudMode && !!coverRef)
      || Boolean(hasCoverAttachmentIdChange)
    )

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!coverUrl) return
    isDragging.current = true
    startY.current = e.clientY
    startOffset.current = coverOffset
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || !imageRef.current) return
    
    const deltaY = e.clientY - startY.current
    const containerHeight = imageRef.current.parentElement?.clientHeight || 200
    
    const dragPercentage = (deltaY / containerHeight) * 100
    const newOffset = Math.max(0, Math.min(100, startOffset.current - dragPercentage))
    
    setCoverOffset(newOffset)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const handleSave = async () => {
    if (!currentKb || !name.trim()) return
    setLoading(true)
    try {
      const isRenamed = name.trim() !== currentKb.name
      const nextCoverAttachmentId = pendingCoverAttachmentId
      let newName = currentKb.name

      if (isRenamed || hasCoverAttachmentIdChange) {
        if (isCloudMode) {
          if (!currentWorkspaceId) {
            throw new Error('当前工作区未就绪，暂时无法保存知识库设置')
          }
          await cloudApi.updateWorkspaceKnowledgeBase(currentWorkspaceId, currentKb.id, {
            ...(isRenamed ? { name: name.trim() } : {}),
            ...(nextCoverAttachmentId !== undefined
              ? { coverAttachmentId: nextCoverAttachmentId }
              : {}),
          })
          await syncWorkspacePullIntoLocalMirror(currentWorkspaceId)
        } else {
          await LocalDB.updateKnowledgeBase({
            knowledgeBaseId: currentKb.id,
            ...(isRenamed ? { name: name.trim() } : {}),
            ...(nextCoverAttachmentId !== undefined
              ? { coverAttachmentId: nextCoverAttachmentId }
              : {}),
          })
        }
        if (isRenamed) {
          tabStore.getState().renameKBTab(currentKb.id, name.trim())
          newName = name.trim()
        }
      }

      if (isRenamed || (!isCloudMode && coverRef) || coverOffset !== initialCoverOffset) {
        const config = await storage.readConfig()
        let updated = false
        const newConfig = { ...config }
        
        if (isRenamed && config.kbOrder) {
          const idx = config.kbOrder.indexOf(currentKb.name)
          if (idx !== -1) {
            const newOrder = [...config.kbOrder]
            newOrder[idx] = newName
            newConfig.kbOrder = newOrder
            updated = true
          }
        }
        
        const newCovers = { ...(newConfig.kbCovers || config.kbCovers || {}) }
        const newOffsets = { ...(newConfig.kbCoverOffsets || config.kbCoverOffsets || {}) }
        
        if (isRenamed && newCovers[currentKb.name]) {
          if (!coverRef) {
            newCovers[newName] = newCovers[currentKb.name]
          }
          delete newCovers[currentKb.name]
          updated = true
        }
        
        if (isRenamed && newOffsets[currentKb.name] !== undefined) {
          newOffsets[newName] = newOffsets[currentKb.name]
          delete newOffsets[currentKb.name]
          updated = true
        }
        
        if (!isCloudMode && coverRef) {
          newCovers[newName] = coverRef
          updated = true
        }
        
        if (coverOffset !== initialCoverOffset || newOffsets[newName] !== undefined) {
          newOffsets[newName] = coverOffset
          updated = true
        }
        
        newConfig.kbCovers = newCovers
        newConfig.kbCoverOffsets = newOffsets
        
        if (updated) {
          await storage.writeConfig(newConfig)
        }
      }

      await refreshKBList()
      if (currentWorkspaceId) {
        window.dispatchEvent(
          new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
            detail: {
              workspaceId: currentWorkspaceId,
            },
          }),
        )
      }
      logAction('HomePage:知识库设置已保存', 'KBSettings', {
        kbName: currentKb.name,
        newName,
        updatedCover: isCloudMode ? hasCoverAttachmentIdChange : !!coverRef,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logAction('HomePage:保存知识库设置失败', 'KBSettings', { error: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!currentKb) return
    const confirmed = await prompt({
      title: '确认删除知识库',
      placeholder: `输入 "${currentKb.name}" 确认删除`,
    })
    if (!confirmed || confirmed !== currentKb.name) return

    setLoading(true)
    try {
      if (isCloudMode) {
        if (!currentWorkspaceId) {
          throw new Error('当前工作区未就绪，暂时无法删除知识库')
        }
        await cloudApi.deleteWorkspaceKnowledgeBase(currentWorkspaceId, currentKb.id)
        await syncWorkspacePullIntoLocalMirror(currentWorkspaceId)
        tabStore.getState().removeTab(`kb:${currentKb.id}`)
      } else {
        await storage.deleteKB(currentKb.name)
      }
      
      const config = await storage.readConfig()
      let updated = false
      const newConfig = { ...config }
      
      if (config.kbOrder) {
        const idx = config.kbOrder.indexOf(currentKb.name)
        if (idx !== -1) {
          newConfig.kbOrder = config.kbOrder.filter((n: any) => n !== currentKb.name)
          updated = true
        }
      }
      
      if (config.kbCovers && config.kbCovers[currentKb.name]) {
        const newCovers = { ...config.kbCovers }
        delete newCovers[currentKb.name]
        newConfig.kbCovers = newCovers
        updated = true
      }
      
      if (config.kbCoverOffsets && config.kbCoverOffsets[currentKb.name] !== undefined) {
        const newOffsets = { ...config.kbCoverOffsets }
        delete newOffsets[currentKb.name]
        newConfig.kbCoverOffsets = newOffsets
        updated = true
      }
      
      if (updated) {
        await storage.writeConfig(newConfig)
      }

      await refreshKBList()
      if (currentWorkspaceId) {
        window.dispatchEvent(
          new CustomEvent(CLOUD_LOCALDB_UPDATED_EVENT, {
            detail: {
              workspaceId: currentWorkspaceId,
            },
          }),
        )
      }
      logAction('HomePage:成功删除知识库', 'KBSettings', { kbName: currentKb.name })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logAction('HomePage:删除知识库失败', 'KBSettings', { error: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      setError('')
      if (isCloudMode) {
        if (!currentKb || !currentWorkspaceId) {
          throw new Error('当前工作区未就绪，暂时无法上传封面')
        }
        const dataUrl = await readFileAsDataUrl(file)
        const attachmentId = await uploadKnowledgeBaseCoverToCloud({
          workspaceId: currentWorkspaceId,
          knowledgeBaseId: currentKb.id,
          file,
        })
        await syncWorkspacePullIntoLocalMirror(currentWorkspaceId)
        setCoverUrl(dataUrl)
        setPendingCoverAttachmentId(attachmentId)
        setCoverRef('')
        return
      }
      const dataUrl = await readFileAsDataUrl(file)
      const base64 = dataUrl.split(',')[1]
      const ext = file.name.split('.').pop() || 'png'
      const fileName = `cover_${Date.now()}.${ext}`

      const ref = await storage.writeAttachmentBase64('__ROOT__', fileName, file.type, base64)
      const localDataUrl = await storage.readAttachmentDataUrl('__ROOT__', ref)
      setCoverUrl(localDataUrl)
      setCoverRef(ref)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleCoverClear = useCallback(() => {
    setCoverUrl('')
    setCoverRef('')
    setCoverOffset(50)
    if (isCloudMode) {
      setPendingCoverAttachmentId(null)
    }
  }, [isCloudMode])

  return {
    state: {
      currentKb,
      name,
      coverUrl,
      coverRef,
      coverOffset,
      initialCoverOffset,
      loading,
      error,
      isDragging,
      isCloudMode,
      hasUnsavedChanges,
    },
    actions: {
      setName,
      setCoverUrl,
      setCoverRef,
      setCoverOffset,
      handleCoverClear,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleSave,
      handleDelete,
      handleCoverUpload
    },
    refs: {
      imageRef
    }
  }
}

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取封面文件失败'))
    reader.readAsDataURL(file)
  })
}

async function uploadKnowledgeBaseCoverToCloud(input: {
  workspaceId: string
  knowledgeBaseId: string
  file: File
}) {
  const extension = input.file.name.split('.').pop()?.trim() || 'png'
  const fileName = `cover_${Date.now()}.${extension}`
  const mimeType = normalizeAttachmentMimeType(input.file.type, fileName)
  const ticket = await cloudApi.createWorkspaceAttachmentUploadTicket(input.workspaceId, {
    knowledgeBaseId: input.knowledgeBaseId,
    fileName,
    mimeType,
    sizeBytes: input.file.size,
  })
  const buffer = await input.file.arrayBuffer()
  const uploadResponse = await fetch(ticket.uploadUrl, {
    method: ticket.method || 'PUT',
    headers: {
      ...(ticket.headers || {}),
      ...((ticket.headers || {})['Content-Type'] ? {} : { 'Content-Type': mimeType }),
    },
    body: buffer,
  })
  if (!uploadResponse.ok) {
    throw new Error(`上传知识库封面失败: ${uploadResponse.status}`)
  }

  const sha256 = await computeSha256Hex(buffer)
  const commitResponse = await fetch(ticket.commitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sha256,
    }),
  })
  let commitPayload: unknown = null
  try {
    commitPayload = await commitResponse.json()
  } catch {}
  if (!commitResponse.ok) {
    throw new Error(`提交知识库封面元数据失败: ${commitResponse.status}`)
  }
  const attachmentId = extractCommittedAttachmentId(commitPayload)
  if (!attachmentId) {
    throw new Error('知识库封面上传成功，但未返回附件 ID')
  }
  return attachmentId
}

async function computeSha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function extractCommittedAttachmentId(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const response = payload as {
    ok?: boolean
    data?: {
      attachment?: {
        id?: string
      }
    }
  }
  const attachmentId = response.data?.attachment?.id
  return typeof attachmentId === 'string' && attachmentId.trim() ? attachmentId.trim() : null
}
