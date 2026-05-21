import { useState, useEffect } from 'react'
import { useStorage } from '../../core/storage'
import { usePromptStore } from '../../stores/promptStore'
import { logAction } from '../../core/log-backend'
import type { KBItem } from './useHomeKnowledgeBases'

interface KBSettingsDialogProps {
  visible: boolean
  kb: KBItem | null
  onClose: () => void
  refreshKBList: () => Promise<void>
}

export function KBSettingsDialog({ visible, kb, onClose, refreshKBList }: KBSettingsDialogProps) {
  const storage = useStorage()
  const prompt = usePromptStore(s => s.open)

  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [coverRef, setCoverRef] = useState('') // the ref path saved to config
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (visible && kb) {
      setName(kb.name)
      setCoverUrl(kb.coverUrl || '')
      setCoverRef('')
      setError('')
    }
  }, [visible, kb])

  if (!visible || !kb) return null

  const handleSave = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const isRenamed = name.trim() !== kb.name
      let newName = kb.name

      if (isRenamed) {
        await storage.renameKB(kb.name, name.trim())
        newName = name.trim()
      }
      
      // Update config for kbOrder and kbCovers
      if (isRenamed || coverRef) {
        const config = await storage.readConfig()
        let updated = false
        const newConfig = { ...config }
        
        if (isRenamed && config.kbOrder) {
          const idx = config.kbOrder.indexOf(kb.name)
          if (idx !== -1) {
            const newOrder = [...config.kbOrder]
            newOrder[idx] = newName
            newConfig.kbOrder = newOrder
            updated = true
          }
        }
        
        // Handle cover updates
        if (isRenamed || coverRef) {
          const newCovers = { ...(newConfig.kbCovers || config.kbCovers || {}) }
          
          // If renamed, move the old cover reference to the new name if it existed and wasn't overwritten
          if (isRenamed && newCovers[kb.name]) {
            if (!coverRef) {
              newCovers[newName] = newCovers[kb.name]
            }
            delete newCovers[kb.name]
            updated = true
          }
          
          // If a new cover was uploaded, apply it to the new/current name
          if (coverRef) {
            newCovers[newName] = coverRef
            updated = true
          }
          
          newConfig.kbCovers = newCovers
        }
        
        if (updated) {
          await storage.writeConfig(newConfig)
        }
      }

      await refreshKBList()
      logAction('HomePage:知识库设置已保存', 'KBSettings', { kbName: kb.name, newName, updatedCover: !!coverRef })
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
      placeholder: `输入 "${kb.name}" 确认删除`,
    })
    if (!confirmed || confirmed !== kb.name) return

    setLoading(true)
    try {
      await storage.deleteKB(kb.name)
      
      // Clean up config
      const config = await storage.readConfig()
      let updated = false
      const newConfig = { ...config }
      
      if (config.kbOrder) {
        const idx = config.kbOrder.indexOf(kb.name)
        if (idx !== -1) {
          newConfig.kbOrder = config.kbOrder.filter(n => n !== kb.name)
          updated = true
        }
      }
      
      if (config.kbCovers && config.kbCovers[kb.name]) {
        const newCovers = { ...config.kbCovers }
        delete newCovers[kb.name]
        newConfig.kbCovers = newCovers
        updated = true
      }
      
      if (updated) {
        await storage.writeConfig(newConfig)
      }

      await refreshKBList()
      logAction('HomePage:成功删除知识库', 'KBSettings', { kbName: kb.name })
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
    <div inert={!visible ? "" : undefined} className={`fixed inset-0 bg-black/40 z-[10000] flex items-center justify-center opacity-0 invisible transition-all duration-250 backdrop-blur-[2px] ${visible ? '!opacity-100 !visible [&>div]:!scale-100 [&>div]:!translate-y-0 [&>div]:!opacity-100' : ''}`} onClick={onClose}>
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-[440px] max-w-[90%] overflow-hidden scale-95 translate-y-2.5 opacity-0 transition-all duration-300 shadow-[var(--shadow-lg)]" onClick={e => e.stopPropagation()}>
        <div className="p-[18px_24px] bg-[var(--color-bg)] border-b border-[var(--color-border-light)] flex justify-between items-center [&>h3]:text-[var(--color-primary)] [&>h3]:text-[16px] [&>h3]:m-0 [&>h3]:font-bold">
          <h3>知识库设置 - {kb.name}</h3>
          <button className="w-7 h-7 rounded-md border-none bg-[var(--color-hover-bg)] text-[var(--color-text-muted)] cursor-pointer text-[14px] transition-all duration-150 hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]" onClick={onClose}>×</button>
        </div>
        <div className="p-[20px_24px]">
          {error && <div className="text-[#e74c3c] text-[13px] mb-3">{error}</div>}

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-200 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>知识库名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              placeholder="请输入知识库名称"
            />
          </div>

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-200 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>封面设置</label>
            <label className="w-full h-[140px] bg-[var(--color-bg-muted)] rounded-xl overflow-hidden relative cursor-pointer flex items-center justify-center border border-[var(--color-border)] transition-all duration-200 hover:border-[var(--color-accent)] group">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverUpload}
                disabled={loading}
              />
              {coverUrl ? (
                <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <div className="text-[#aaa] text-[13px]">尚未设置封面</div>
              )}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 transition-opacity duration-200 text-white text-[14px] font-medium backdrop-blur-[2px] group-hover:opacity-100">
                点击替换封面图
              </div>
            </label>
          </div>

          <div className="mb-4 [&>label]:block [&>label]:text-[var(--color-text-secondary)] [&>label]:text-[13px] [&>label]:mb-1.5 [&>label]:font-medium [&>input]:w-full [&>input]:p-[10px_14px] [&>input]:border [&>input]:border-[var(--color-border)] [&>input]:rounded-lg [&>input]:bg-[var(--color-surface)] [&>input]:text-[var(--color-text-primary)] [&>input]:text-[13px] [&>input]:transition-all [&>input]:duration-200 [&>input]:box-border focus:[&>input]:outline-none focus:[&>input]:border-[var(--color-accent)] focus:[&>input]:shadow-[0_0_0_2px_var(--color-accent-soft)] [&>input::placeholder]:text-[var(--color-text-muted)]">
            <label>基础信息</label>
            <div className="text-[#666] text-[13px] py-2.5 px-3.5 bg-[#f8f9fa] rounded-lg border border-[#eee]">
              节点数量：<span className="font-semibold text-[#333]">{kb.nodeCount ?? '未知'}</span>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--color-border-light)] flex justify-between items-center">
            <button className="bg-transparent text-[var(--color-danger)] border border-transparent p-[8px_16px] rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-200 hover:bg-[var(--color-danger-soft)] hover:border-[var(--color-danger)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleDelete} disabled={loading}>
              删除知识库
            </button>
            <div className="flex gap-3">
              <button className="bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] border-none p-[8px_20px] rounded-lg text-[14px] font-medium cursor-pointer transition-all duration-200 hover:bg-[var(--color-bg-muted)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose} disabled={loading}>
                取消
              </button>
              <button className="bg-[var(--color-accent)] text-white border-none p-[8px_24px] rounded-lg text-[14px] font-semibold cursor-pointer transition-all duration-200 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleSave} disabled={loading || !name.trim()}>
                保存设置
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
