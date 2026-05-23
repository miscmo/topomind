import { useState, useEffect, useRef } from 'react'
import { useStorage } from '../../core/storage'
import { usePromptStore } from '../../stores/promptStore'
import { logAction } from '../../core/log-backend'
import type { KBItem } from './useHomeKnowledgeBases'
import { modalOverlayBaseClassName, modalOverlayEnterClassName, modalPanelEnterClassName } from '../ui/modal'

interface KBSettingsDialogProps {
  visible: boolean
  kb: KBItem | null
  onClose: () => void
  refreshKBList: () => Promise<void>
}

export function KBSettingsDialog({ visible, kb, onClose, refreshKBList }: KBSettingsDialogProps) {
  const storage = useStorage()
  const prompt = usePromptStore(s => s.open)

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
      setCoverOffset(kb.coverOffset ?? 50) // Assuming kbItem might store offset in future, default to 50
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
    
    // Calculate how much the image can actually move
    // We adjust the percentage based on the drag distance relative to container
    const dragPercentage = (deltaY / containerHeight) * 100
    
    // Calculate new offset, clamp between 0 and 100
    // Note: deltaY > 0 means moving down, which means object-position should decrease
    const newOffset = Math.max(0, Math.min(100, startOffset.current - dragPercentage))
    
    setCoverOffset(newOffset)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  if (!visible || !currentKb) return null

  const handleSave = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const isRenamed = name.trim() !== currentKb.name
      let newName = currentKb.name

      if (isRenamed) {
        await storage.renameKB(currentKb.name, name.trim())
        newName = name.trim()
      }
      
      // Update config for kbOrder and kbCovers
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
        
        // Handle cover updates
        const newCovers = { ...(newConfig.kbCovers || config.kbCovers || {}) }
        const newOffsets = { ...(newConfig.kbCoverOffsets || config.kbCoverOffsets || {}) }
        
        // If renamed, move the old cover reference to the new name if it existed and wasn't overwritten
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
        
        // If a new cover was uploaded, apply it to the new/current name
        if (coverRef) {
          newCovers[newName] = coverRef
          updated = true
        }
        
        // Save cover offset
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
    const confirmed = await prompt({
      title: '确认删除知识库',
      placeholder: `输入 "${currentKb.name}" 确认删除`,
    })
    if (!confirmed || confirmed !== currentKb.name) return

    setLoading(true)
    try {
      await storage.deleteKB(currentKb.name)
      
      // Clean up config
      const config = await storage.readConfig()
      let updated = false
      const newConfig = { ...config }
      
      if (config.kbOrder) {
        const idx = config.kbOrder.indexOf(currentKb.name)
        if (idx !== -1) {
          newConfig.kbOrder = config.kbOrder.filter(n => n !== currentKb.name)
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
      // Read file as Base64
      const reader = new FileReader()
      reader.onload = async (event) => {
        const base64 = (event.target?.result as string).split(',')[1]
        const ext = file.name.split('.').pop() || 'png'
        const fileName = `cover_${Date.now()}.${ext}`

        // Write to root _attach/
        const ref = await storage.writeAttachmentBase64('__ROOT__', fileName, file.type, base64)
        
        const dataUrl = await storage.readAttachmentDataUrl('__ROOT__', ref)
        setCoverUrl(dataUrl)
        setCoverRef(ref) // save ref to state, write to config on save
        
        setLoading(false)
      }
      reader.readAsDataURL(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

  return (
    <div className={`${modalOverlayBaseClassName} ${modalOverlayEnterClassName} z-[10000]`} onClick={onClose}>
      <div className={`w-[440px] max-w-[90%] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-surface shadow-[var(--shadow-lg)] ${modalPanelEnterClassName}`} onClick={e => e.stopPropagation()}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>知识库设置 - {currentKb.name}</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-75 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>×</button>
        </div>
        <div className="p-[20px_24px]">
          {error && <div className="text-[#e74c3c] text-[13px] mb-3">{error}</div>}

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-75 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>知识库名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              placeholder="请输入知识库名称"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[var(--color-text-secondary)] text-[13px] mb-1.5 font-medium">封面设置</label>
            <div className="flex gap-6 items-start">
              {/* Preview Box - matches 1:1 aspect ratio of grid */}
              <div 
                className="w-[140px] h-[140px] bg-gradient-to-br from-muted to-muted/50 rounded-xl overflow-hidden relative flex-shrink-0 border border-[var(--color-border)] shadow-sm group"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                {coverUrl ? (
                  <>
                    <img 
                      ref={imageRef}
                      src={coverUrl} 
                      alt="Cover Preview" 
                      className={`w-full h-full object-cover select-none ${isDragging.current ? 'cursor-grabbing' : 'cursor-grab'}`}
                      style={{ objectPosition: `50% ${coverOffset}%` }}
                      draggable={false}
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center justify-center">
                      <div className="bg-background/80 backdrop-blur-sm text-foreground text-xs px-2 py-1 rounded-md shadow-sm">
                        上下拖动调整
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                  </div>
                )}
              </div>
              
              {/* Controls */}
              <div className="flex-1 flex flex-col justify-center h-[140px]">
                <p className="text-xs text-muted-foreground mb-4">
                  推荐上传 1:1 比例的图片作为封面。上传后，您可以在左侧预览区上下拖动图片来调整展示区域。
                </p>
                <label className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-[var(--color-hover-bg)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] shadow-sm transition-colors hover:bg-[var(--color-bg-muted)] focus-visible:outline-none cursor-pointer border border-[var(--color-border)] w-fit">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCoverUpload}
                    disabled={loading}
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                  {coverUrl ? '更换封面图片' : '上传封面图片'}
                </label>
                {coverUrl && (
                  <button 
                    onClick={() => { setCoverUrl(''); setCoverRef(''); setCoverOffset(50); }}
                    className="text-xs text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] text-left mt-3 w-fit bg-transparent border-none cursor-pointer p-0"
                    disabled={loading}
                  >
                    移除封面
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-75 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>基础信息</label>
            <div className="text-[#666] text-[13px] py-2.5 px-3.5 bg-[#f8f9fa] rounded-lg border border-[#eee]">
              节点数量：<span className="font-semibold text-[#333]">{currentKb.nodeCount ?? '未知'}</span>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--color-border-light)] flex justify-between items-center">
            <button className="bg-transparent text-[var(--color-danger)] border border-[var(--color-danger)] p-[8px_16px] rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-75 hover:bg-[var(--color-danger-soft)] hover:border-[var(--color-danger)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleDelete} disabled={loading}>
              删除知识库
            </button>
            <div className="flex gap-3">
              <button className="bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] border-none p-[8px_20px] rounded-lg text-[14px] font-medium cursor-pointer transition-all duration-75 hover:bg-[var(--color-bg-muted)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>
                取消
              </button>
              <button className="bg-[var(--color-accent)] text-white border-none p-[8px_24px] rounded-lg text-[14px] font-semibold cursor-pointer transition-all duration-75 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleSave} disabled={loading || !name.trim() || (name.trim() === currentKb.name && !coverRef && coverOffset === initialCoverOffset)}>
                保存设置
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
