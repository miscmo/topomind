/**
 * 首页：知识库列表
 * 对应原 HomePage.vue
 */
import { useState, useEffect, useRef, memo } from 'react'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { useTabStore, tabStore } from '../stores/tabStore'
import { useStorage } from '../hooks/useStorage'
import { logAction } from '../core/log-backend'
import { logger } from '../core/logger'
import { useConfirmStore } from '../stores/confirmStore'
import { usePromptStore } from '../stores/promptStore'
import styles from './HomePage.module.css'

interface KBItem {
  path: string
  name: string
  order: number
  cover?: string
  nodeCount: number | null
  coverUrl: string | null
}

interface KBContextMenu {
  visible: boolean
  x: number
  y: number
  kb: KBItem | null
}

export default function HomePage() {
  const showGraph = useAppStore((s) => s.showGraph)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const addKBTab = useTabStore((s) => s.addKBTab)
  const restoreRoomStateToTab = useTabStore((s) => s.restoreRoomStateToTab)
  const tabs = useTabStore((s) => s.tabs)
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

  // KB 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState<KBContextMenu>({ visible: false, x: 0, y: 0, kb: null })

  // 点击外部关闭 KB 右键菜单
  useEffect(() => {
    if (!ctxMenu.visible) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      if (!target.closest('[data-testid="kb-context-menu"]') && !target.closest('[class*="card"]')) {
        closeCtxMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctxMenu.visible])

  // KB 右键菜单
  function handleKBRightClick(e: React.MouseEvent, kb: KBItem) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, kb })
  }

  function closeCtxMenu() {
    setCtxMenu((prev) => ({ ...prev, visible: false }))
  }

  async function handleKBDelete() {
    const kb = ctxMenu.kb
    if (!kb) return
    closeCtxMenu()
    const confirmed = await useConfirmStore.getState().open({
      title: '确认删除',
      message: `确定要删除知识库「${kb.name}」吗？此操作不可恢复。`,
    })
    if (!confirmed) return
    try {
      await storage.deleteKB(kb.name)
      logAction('知识库:删除', 'HomePage', { kbName: kb.name, kbPath: kb.path })
      useAppStore.getState().triggerKBRefresh()
      await loadKBList()
    } catch (err) {
      logger.catch('HomePage', 'handleKBDelete', err)
    }
  }

  async function handleKBRename() {
    const kb = ctxMenu.kb
    if (!kb) return
    closeCtxMenu()
    const newName = await usePromptStore.getState().open({
      title: '重命名知识库',
      placeholder: '输入新名称',
      defaultValue: kb.name,
    })
    if (!newName?.trim() || newName === kb.name) return
    try {
      await storage.renameKB(kb.path, newName.trim())
      logAction('知识库:重命名', 'HomePage', { kbName: kb.name, newName, kbPath: kb.path })
      useAppStore.getState().triggerKBRefresh()
      await loadKBList()
    } catch (err) {
      logger.catch('HomePage', 'handleKBRename', err)
    }
  }

  // 新建知识库弹窗生命周期日志
  const prevShowCreateSheet = useRef(false)
  useEffect(() => {
    if (showCreateSheet && !prevShowCreateSheet.current) {
      logAction('HomePage:新建知识库弹窗:打开', 'HomePage', {})
    } else if (!showCreateSheet && prevShowCreateSheet.current) {
      logAction('HomePage:新建知识库弹窗:关闭', 'HomePage', { createName })
    }
    prevShowCreateSheet.current = showCreateSheet
  }, [showCreateSheet])

  // 导入知识库弹窗生命周期日志
  const prevShowImportSheet = useRef(false)
  useEffect(() => {
    if (showImportSheet && !prevShowImportSheet.current) {
      logAction('HomePage:导入知识库弹窗:打开', 'HomePage', {})
    } else if (!showImportSheet && prevShowImportSheet.current) {
      logAction('HomePage:导入知识库弹窗:关闭', 'HomePage', { importDir })
    }
    prevShowImportSheet.current = showImportSheet
  }, [showImportSheet])

  useEffect(() => {
    loadKBList()
  }, [])

  async function loadKBList() {
    logAction('HomePage:开始加载知识库列表', 'HomePage', {})
    setLoading(true)
    try {
      const [list, dir] = await Promise.all([
        storage.listKBs(),
        storage.getRootDir(),
      ])
      setWorkDir(dir || '')
      logAction('HomePage:知识库列表加载成功', 'HomePage', {
        kbCount: (list || []).length,
        workDir: dir,
      })
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
      logAction('HomePage:开始加载子节点数量', 'HomePage', { kbCount: initial.length })
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
      logAction('HomePage:子节点数量加载完成', 'HomePage', { totalNodes: counts.reduce((a, b) => a + b, 0) })
    } catch (err) {
      logger.catch('HomePage', 'loadKBList', err)
      logAction('HomePage:加载知识库列表异常', 'HomePage', { error: (err as Error)?.message || String(err) })
    } finally {
      setLoading(false)
    }
  }

  function openKB(kb: KBItem) {
    const tabId = `kb:${kb.path}`
    const existing = tabs.find((t) => t.id === tabId)

    if (existing) {
      const roomState = tabStore.getState().getRoomStateFromTab(tabId)
      const restoredRoomState = {
        kbPath: kb.path,
        roomHistory: roomState?.roomHistory ?? [],
        currentRoomPath: roomState?.currentRoomPath ?? kb.path,
        currentRoomName: roomState?.currentRoomName || kb.name,
      }
      restoreRoomStateToTab(tabId, restoredRoomState)
      roomStore.getState().restoreRoomState(restoredRoomState)
      setActiveTab(tabId)
      showGraph()
    } else {
      addKBTab({
        id: tabId,
        label: kb.name,
        kbPath: kb.path,
        isDirty: false,
      })
      roomStore.getState().restoreRoomState({
        kbPath: kb.path,
        roomHistory: [],
        currentRoomPath: kb.path,
        currentRoomName: kb.name,
      })
      setActiveTab(tabId)
      showGraph()
    }

    logAction('知识库:打开', 'HomePage', { kbPath: kb.path, kbName: kb.name, nodeCount: kb.nodeCount })
  }

  async function switchWorkDir() {
    setMessage('')
    logAction('HomePage:点击切换工作目录', 'HomePage', {})
    logAction('HomePage:打开文件对话框', 'HomePage', { purpose: '切换工作目录' })
    const picked = await storage.selectWorkDirCandidate()
    if (!picked?.valid) {
      logAction('HomePage:文件对话框关闭', 'HomePage', {
        result: 'cancelled',
        reason: picked?.error || '用户取消',
      })
      return
    }
    logAction('HomePage:文件对话框已选择路径', 'HomePage', { selectedPath: picked.nodePath })
    const res = await storage.setWorkDir(picked.nodePath!)
    if (!res?.valid) {
      if (res?.error) {
        setMessageError(true)
        setMessage(res.error)
      }
      logAction('HomePage:切换工作目录失败', 'HomePage', {
        newWorkDir: picked.nodePath,
        error: res?.error || null,
      })
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
      useAppStore.getState().triggerKBRefresh()
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
    logAction('HomePage:点击选择导入文件夹', 'HomePage', {})
    const res = await storage.selectWorkDirCandidate()
    if (res?.valid) {
      setImportDir(res.nodePath || '')
      setImportError('')
      logAction('HomePage:选择导入文件夹完成', 'HomePage', { selectedPath: res.nodePath })
    } else {
      logAction('HomePage:选择导入文件夹取消', 'HomePage', {})
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
            <div
              key={kb.path}
              className={styles.card}
              onClick={() => { logAction('HomePage:点击知识库卡片', 'HomePage', { kbPath: kb.path, kbName: kb.name }); openKB(kb); }}
              onMouseEnter={() => logAction('HomePage:悬停知识库卡片', 'HomePage', { kbPath: kb.path, kbName: kb.name })}
              onContextMenu={(e) => handleKBRightClick(e, kb)}
            >
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
          <div className={styles.cardAdd} onClick={() => { logAction('HomePage:点击新建知识库', 'HomePage', {}); setShowCreateSheet(true); setCreateName(''); setCreateError(''); }}>
            <div className={styles.cardAddIcon}>＋</div>
            <div className={styles.cardAddText}>新建知识库</div>
          </div>

          {/* 导入按钮 */}
          <div className={styles.cardAdd} onClick={() => { logAction('HomePage:点击导入知识库', 'HomePage', {}); setShowImportSheet(true); setImportDir(''); setImportError(''); }}>
            <div className={styles.cardAddIcon}>📥</div>
            <div className={styles.cardAddText}>导入知识库</div>
          </div>
        </div>
      </div>

      {/* KB 右键菜单 */}
      {ctxMenu.visible && ctxMenu.kb && (
        <div
          data-testid="kb-context-menu"
          className={styles.ctxMenu}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseLeave={closeCtxMenu}
        >
          <button
            className={styles.ctxMenuItem}
            onClick={handleKBDelete}
            data-testid="ctx-delete"
          >
            删除
          </button>
          <button
            className={styles.ctxMenuItem}
            onClick={handleKBRename}
            data-testid="ctx-rename"
          >
            重命名
          </button>
        </div>
      )}

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
