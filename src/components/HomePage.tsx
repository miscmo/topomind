/**
 * 首页：知识库列表
 * 对应原 HomePage.vue
 */
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { useStorage } from '../hooks/useStorage'
import { logAction } from '../core/log-backend'
import { logger } from '../core/logger'
import styles from './HomePage.module.css'

interface KBItem {
  path: string
  name: string
  order: number
  cover?: string
  nodeCount: number | null
  coverUrl: string | null
}

export default function HomePage() {
  const showGraph = useAppStore((s) => s.showGraph)
  const storage = useStorage()
  const [loading, setLoading] = useState(false)
  const [kbs, setKbs] = useState<KBItem[]>([])
  const [workDir, setWorkDir] = useState('')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)

  // 新建知识库弹窗状态
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  // 导入知识库弹窗状态
  const [showImportSheet, setShowImportSheet] = useState(false)
  const [importDir, setImportDir] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')

  useEffect(() => {
    loadKBList()
  }, [])

  async function loadKBList() {
    setLoading(true)
    try {
      const [list, dir] = await Promise.all([
        storage.listKBs(),
        storage.getRootDir(),
      ])
      setWorkDir(dir || '')
      // listKBs() already returns only KB directories as KBListItem[]
      const kbList = list || []
      const initial: KBItem[] = kbList.map((kb) => ({
        path: kb.path,
        name: kb.name,
        order: kb.order ?? 0,
        nodeCount: null,
        coverUrl: null,
      }))
      setKbs(initial)

      // 加载子节点数量（使用初始值避免 stale closure）
      const counts = await Promise.all(
        initial.map(async (kb) => {
          try {
            return await storage.countChildren(kb.path)
          } catch {
            return 0
          }
        })
      )
      setKbs(initial.map((kb, i) => ({ ...kb, nodeCount: counts[i] })))
    } catch (err) {
      logger.catch('HomePage', 'loadKBList', err)
    } finally {
      setLoading(false)
    }
  }

  async function openKB(kb: KBItem) {
    try {
      await storage.setLastOpenedKB(kb.path)
    } catch { /* ignore */ }
    roomStore.getState().setCurrentKB(kb.path)
    showGraph()
    logAction('知识库:打开', 'HomePage', { kbPath: kb.path, kbName: kb.name, nodeCount: kb.nodeCount })
  }

  async function switchWorkDir() {
    setMessage('')
    const picked = await storage.selectWorkDirCandidate()
    if (!picked?.valid) return
    const res = await storage.setWorkDir(picked.nodePath!)
    if (!res?.valid) {
      if (res?.error) {
        setMessageError(true)
        setMessage(res.error)
      }
      return
    }
    logAction('工作目录:切换', 'HomePage', { newWorkDir: picked.nodePath })
    await loadKBList()
  }

  function truncatedWorkDir() {
    if (!workDir) return ''
    return workDir.length <= 48 ? workDir : workDir.slice(0, 12) + '...' + workDir.slice(-32)
  }

  // ===== 新建知识库 =====
  async function handleCreateKB() {
    const name = createName.trim()
    if (!name) {
      setCreateError('知识库名称不能为空')
      return
    }
    setCreateError('')
    setCreateLoading(true)
    try {
      await storage.createKB(name)
      logAction('知识库:创建', 'HomePage', { kbName: name })
      setShowCreateSheet(false)
      setCreateName('')
      await loadKBList()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCreateError(msg || '创建失败')
    } finally {
      setCreateLoading(false)
    }
  }

  // ===== 导入知识库 =====
  async function handleSelectImportDir() {
    const res = await storage.selectWorkDirCandidate()
    if (res?.valid) {
      setImportDir(res.nodePath || '')
      setImportError('')
    }
  }

  async function handleImportKB() {
    if (!importDir) {
      setImportError('请先选择一个文件夹')
      return
    }
    setImportError('')
    setImportLoading(true)
    try {
      await storage.importKB(importDir)
      logAction('知识库:导入', 'HomePage', { sourcePath: importDir })
      setShowImportSheet(false)
      setImportDir('')
      await loadKBList()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportError(msg || '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div id="home-modal" className={styles.page}>
      {/* 头部 */}
      <div className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🧠</span>
          <div>
            <h1>TopoMind</h1>
            <span>可漫游拓扑知识大脑</span>
          </div>
        </div>
        {workDir && (
          <div className={styles.workdirBar}>
            <span className={styles.workdirPath} title={workDir}>📂 {truncatedWorkDir()}</span>
            <button className={styles.workdirSwitch} onClick={switchWorkDir} title="切换工作目录">切换</button>
          </div>
        )}
        {message && (
          <div className={`${styles.workdirMsg} ${messageError ? styles.error : ''}`}>{message}</div>
        )}
      </div>

      {/* 知识库列表 */}
      <div className={styles.content}>
        {loading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner}></div>
            <span className={styles.loadingText}>加载中...</span>
          </div>
        )}

        <div className={styles.sectionTitle}>我的知识库</div>
        <div className={styles.grid}>
          {kbs.map((kb) => (
            <div key={kb.path} className={styles.card} onClick={() => openKB(kb)}>
              <div className={styles.cardImage}>
                {kb.coverUrl ? (
                  <img src={kb.coverUrl} alt={kb.name} />
                ) : (
                  <span className={styles.cardImageIcon}>📚</span>
                )}
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>
                  <span>{kb.name}</span>
                </div>
                <div className={styles.cardMeta}>
                  <div className={styles.cardMetaRow}>
                    <span>📊 {kb.nodeCount !== null ? `${kb.nodeCount} 个节点` : '··· 个节点'}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* 新建按钮 */}
          <div className={styles.cardAdd} onClick={() => { setShowCreateSheet(true); setCreateName(''); setCreateError(''); }}>
            <div className={styles.cardAddIcon}>＋</div>
            <div className={styles.cardAddText}>新建知识库</div>
          </div>

          {/* 导入按钮 */}
          <div className={styles.cardAdd} onClick={() => { setShowImportSheet(true); setImportDir(''); setImportError(''); }}>
            <div className={styles.cardAddIcon}>📥</div>
            <div className={styles.cardAddText}>导入知识库</div>
          </div>
        </div>
      </div>

      {/* 新建知识库弹窗 */}
      <div
        className={`${styles.formOverlay} ${showCreateSheet ? styles.active : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) setShowCreateSheet(false) }}
      >
        <div className={styles.form}>
          <div className={styles.formHeader}>
            <h3>新建知识库</h3>
            <button className={styles.formClose} onClick={() => setShowCreateSheet(false)}>✕</button>
          </div>
          <div className={styles.formBody}>
            <div className={styles.formGroup}>
              <label htmlFor="kb-name">知识库名称</label>
              <input
                id="kb-name"
                type="text"
                value={createName}
                onChange={(e) => { setCreateName(e.target.value); setCreateError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !createLoading) handleCreateKB() }}
                placeholder="输入知识库名称"
                autoFocus
              />
              {createError && <div className={styles.formError}>{createError}</div>}
            </div>
          </div>
          <div className={styles.formFooter}>
            <button className={styles.btnCancel} onClick={() => setShowCreateSheet(false)} disabled={createLoading}>取消</button>
            <button className={styles.btnPrimary} onClick={handleCreateKB} disabled={createLoading}>
              {createLoading ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </div>

      {/* 导入知识库弹窗 */}
      <div
        className={`${styles.formOverlay} ${showImportSheet ? styles.active : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) setShowImportSheet(false) }}
      >
        <div className={styles.form}>
          <div className={styles.formHeader}>
            <h3>导入知识库</h3>
            <button className={styles.formClose} onClick={() => setShowImportSheet(false)}>✕</button>
          </div>
          <div className={styles.formBody}>
            <div className={styles.formGroup}>
              <label>选择文件夹</label>
              <div className={styles.importInputRow}>
                <input
                  type="text"
                  value={importDir}
                  readOnly
                  placeholder="点击「选择文件夹」按钮选择"
                  className={styles.importInputField}
                />
                <button
                  className={styles.selectFolderBtn}
                  onClick={handleSelectImportDir}
                >
                  选择文件夹
                </button>
              </div>
              {importError && <div className={styles.formError}>{importError}</div>}
            </div>
          </div>
          <div className={styles.formFooter}>
            <button className={styles.btnCancel} onClick={() => setShowImportSheet(false)} disabled={importLoading}>取消</button>
            <button className={styles.btnPrimary} onClick={handleImportKB} disabled={importLoading || !importDir}>
              {importLoading ? '导入中...' : '导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
