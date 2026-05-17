import { useState, useEffect } from 'react'
import { useStorage } from '../../core/storage'
import { usePromptStore } from '../../stores/promptStore'
import { logAction } from '../../core/log-backend'
import type { KBItem } from './useHomeKnowledgeBases'
import styles from './HomePage.module.css'

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
    <div inert={!visible ? "" : undefined} className={`${styles.formOverlay} ${visible ? styles.active : ''}`} onClick={onClose}>
      <div className={styles.form} onClick={e => e.stopPropagation()}>
        <div className={styles.formHeader}>
          <h3>知识库设置 - {kb.name}</h3>
          <button className={styles.formClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.formBody}>
          {error && <div className={styles.errorText} style={{ color: '#e74c3c', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

          <div className={styles.formGroup}>
            <label>知识库名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              placeholder="请输入知识库名称"
            />
          </div>

          <div className={styles.formGroup}>
            <label>封面设置</label>
            <label className={styles.settingsCoverUpload}>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleCoverUpload}
                disabled={loading}
              />
              {coverUrl ? (
                <img src={coverUrl} alt="Cover" className={styles.settingsCoverImg} />
              ) : (
                <div style={{ color: '#aaa', fontSize: '13px' }}>尚未设置封面</div>
              )}
              <div className={styles.settingsCoverOverlay}>
                点击替换封面图
              </div>
            </label>
          </div>

          <div className={styles.formGroup}>
            <label>基础信息</label>
            <div style={{ color: '#666', fontSize: '13px', padding: '10px 14px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #eee' }}>
              节点数量：<span style={{ fontWeight: 600, color: '#333' }}>{kb.nodeCount ?? '未知'}</span>
            </div>
          </div>

          <div className={styles.settingsFooter}>
            <button className={styles.settingsBtnDelete} onClick={handleDelete} disabled={loading}>
              删除知识库
            </button>
            <div className={styles.settingsFooterActions}>
              <button className={styles.settingsBtnCancel} onClick={onClose} disabled={loading}>
                取消
              </button>
              <button className={styles.settingsBtnSave} onClick={handleSave} disabled={loading || !name.trim()}>
                保存设置
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
