/**
 * 首页：知识库列表
 * 对应原 HomePage.vue
 */
import { useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { logAction } from '../../core/log-backend'
import { useHomeKnowledgeBases } from './useHomeKnowledgeBases'
import { useHomeKBContextMenu } from './useHomeKBContextMenu'
import { useHomeCreateKB } from './useHomeCreateKB'
import { useHomeImportKB } from './useHomeImportKB'
import styles from './HomePage.module.css'

export default function HomePage() {
  const currentWorkDir = useAppStore((s) => s.currentWorkDir)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const {
    loading,
    kbs,
    openKB,
    refreshKBList,
  } = useHomeKnowledgeBases({
    currentWorkDir,
    setMessage,
    setMessageError,
  })
  const {
    ctxMenu,
    closeCtxMenu,
    handleKBRightClick,
    handleKBDelete,
    handleKBRename,
  } = useHomeKBContextMenu({
    ctxMenuClassName: styles.ctxMenu,
    refreshKBList,
  })
  const {
    showCreateSheet,
    createName,
    createLoading,
    createError,
    setCreateName,
    setCreateError,
    openCreateSheet,
    closeCreateSheet,
    handleCreateKB,
  } = useHomeCreateKB({ refreshKBList })
  const {
    showImportSheet,
    importDir,
    importLoading,
    importError,
    openImportSheet,
    closeImportSheet,
    handleSelectImportDir,
    handleImportKB,
  } = useHomeImportKB({ refreshKBList })

  async function switchWorkDir() {
    setMessage('')
    setMessageError(false)
    const resetResult = await window.electronAPI?.invoke('app:switchWorkDir') as { ok?: boolean; cancelled?: boolean } | undefined
    if (!resetResult?.ok) {
      return
    }
    setMessage('工作目录已切换')
    setMessageError(false)
  }

  function truncatedWorkDir() {
    if (!currentWorkDir) return ''
    return currentWorkDir.length <= 48 ? currentWorkDir : currentWorkDir.slice(0, 12) + '...' + currentWorkDir.slice(-32)
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
        {currentWorkDir && (
          <div className={styles.workdirBar}>
            <span className={styles.workdirPath} title={currentWorkDir}>📂 {truncatedWorkDir()}</span>
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
              onClick={() => { 
                logAction('HomePage:点击知识库卡片', 'HomePage', { kbInfo: kb }); 
                openKB(kb); 
              }}
              onContextMenu={(e) => handleKBRightClick(e, kb)}
            >
              <div className={styles.cardImage}>
                <span className={styles.cardImageIcon}>📚</span>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>
                  <span>{kb.name}</span>
                </div>
                <div className={styles.cardMeta}>
                  <div className={styles.cardMetaRow}>
                    <span>
                      📊 {kb.nodeCount !== null ? `${kb.nodeCount} 个节点` : '··· 个节点'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* 新建按钮 */}
          <div className={styles.cardAdd} onClick={openCreateSheet}>
            <div className={styles.cardAddIcon}>＋</div>
            <div className={styles.cardAddText}>新建知识库</div>
          </div>

          {/* 导入按钮 */}
          <div className={styles.cardAdd} onClick={openImportSheet}>
            <div className={styles.cardAddIcon}>📥</div>
            <div className={styles.cardAddText}>导入知识库</div>
          </div>
        </div>
      </div>

      {/* KB 右键菜单 */}
      {ctxMenu.visible && ctxMenu.kb && (
        <div
          className={styles.ctxMenu}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseLeave={closeCtxMenu}
        >
          <button
            className={styles.ctxMenuItem}
            onClick={handleKBDelete}
          >
            删除
          </button>
          <button
            className={styles.ctxMenuItem}
            onClick={handleKBRename}
          >
            重命名
          </button>
        </div>
      )}

      {/* 新建知识库弹窗 */}
      <div
        className={`${styles.formOverlay} ${showCreateSheet ? styles.active : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) closeCreateSheet() }}
      >
        <div className={styles.form}>
          <div className={styles.formHeader}>
            <h3>新建知识库</h3>
            <button className={styles.formClose} onClick={closeCreateSheet}>✕</button>
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
            <button className={styles.btnCancel} onClick={closeCreateSheet} disabled={createLoading}>取消</button>
            <button className={styles.btnPrimary} onClick={handleCreateKB} disabled={createLoading}>
              {createLoading ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </div>

      {/* 导入知识库弹窗 */}
      <div
        className={`${styles.formOverlay} ${showImportSheet ? styles.active : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) closeImportSheet() }}
      >
        <div className={styles.form}>
          <div className={styles.formHeader}>
            <h3>导入知识库</h3>
            <button className={styles.formClose} onClick={closeImportSheet}>✕</button>
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
            <button className={styles.btnCancel} onClick={closeImportSheet} disabled={importLoading}>取消</button>
            <button className={styles.btnPrimary} onClick={handleImportKB} disabled={importLoading || !importDir}>
              {importLoading ? '导入中...' : '导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
