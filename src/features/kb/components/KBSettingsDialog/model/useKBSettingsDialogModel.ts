import { useCallback, useEffect, useState, useRef } from 'react'
import { useStorage } from '../../../../../core/storage'
import { usePromptStore } from '../../../../../shared/ui/PromptModal/promptStore'
import { tabStore } from '../../../../../stores/tabs/tabStore'
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

  const [dialogKb, setDialogKb] = useState<KBItem | null>(kb)
  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [coverRef, setCoverRef] = useState('') // the ref path saved to config
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
      setCoverOffset(kb.coverOffset ?? 50)
      setInitialCoverOffset(kb.coverOffset ?? 50)
      setError('')
    }
  }, [visible, kb])

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
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handleCoverKeyDown = (e: React.KeyboardEvent) => {
    if (!coverUrl || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const delta = e.shiftKey ? 10 : 2
    setCoverOffset((current) => Math.max(0, Math.min(100, current + (e.key === 'ArrowDown' ? delta : -delta))))
  }

  const handleSave = async () => {
    if (!currentKb || !name.trim()) return
    setLoading(true)
    try {
      const isRenamed = name.trim() !== currentKb.name
      let newName = currentKb.name

      if (isRenamed) {
        await storage.renameKB(currentKb.name, name.trim())
        tabStore.getState().renameKBTab(currentKb.name, name.trim())
        newName = name.trim()
      }
      
      if (isRenamed || coverRef || coverOffset !== initialCoverOffset) {
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
        
        if (coverRef) {
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
      logAction('HomePage:知识库设置已保存', 'KBSettings', { kbName: currentKb.name, newName, updatedCover: !!coverRef })
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
      await storage.deleteKB(currentKb.name)
      
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
      const reader = new FileReader()
      reader.onload = async (event) => {
        const base64 = (event.target?.result as string).split(',')[1]
        const ext = file.name.split('.').pop() || 'png'
        const fileName = `cover_${Date.now()}.${ext}`

        const ref = await storage.writeAttachmentBase64('__ROOT__', fileName, file.type, base64)
        
        const dataUrl = await storage.readAttachmentDataUrl('__ROOT__', ref)
        setCoverUrl(dataUrl)
        setCoverRef(ref)
        
        setLoading(false)
      }
      reader.readAsDataURL(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

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
      isDragging
    },
    actions: {
      setName,
      setCoverUrl,
      setCoverRef,
      setCoverOffset,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleCoverKeyDown,
      handleSave,
      handleDelete,
      handleCoverUpload
    },
    refs: {
      imageRef
    }
  }
}
