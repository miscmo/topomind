/**
 * 首页：知识库列表
 */
import { useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useHomeKnowledgeBases, type KBItem } from './useHomeKnowledgeBases'
import { useHomeCreateKB } from './useHomeCreateKB'
import { useHomeImportKB } from './useHomeImportKB'
import { CreateKBDialog } from './CreateKBDialog'
import { ImportKBDialog } from './ImportKBDialog'
import { KBSettingsDialog } from './KBSettingsDialog'
import { KnowledgeBaseGrid } from './KnowledgeBaseGrid'
import styles from './HomePage.module.css'

export default function HomePage() {
  const currentWorkDir = useWorkspaceStore((s) => s.currentWorkDir)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const {
    loading,
    kbs,
    openKB,
    refreshKBList,
    reorderKBs,
  } = useHomeKnowledgeBases({
    currentWorkDir,
    setMessage,
    setMessageError,
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

  const [settingsKB, setSettingsKB] = useState<KBItem | null>(null)

  return (
    <div id="home-modal" className={styles.page}>
      {/* 知识库列表 */}
      <div className={styles.content}>
        {loading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner}></div>
            <span className={styles.loadingText}>加载中...</span>
          </div>
        )}

        <div className={styles.sectionTitle}>我的知识库</div>
        {message && (
          <div className={`${styles.contentMessage} ${messageError ? styles.error : ''}`}>{message}</div>
        )}
        <KnowledgeBaseGrid
          kbs={kbs}
          onOpenKB={openKB}
          onCreateKB={openCreateSheet}
          onImportKB={openImportSheet}
          onOpenSettings={setSettingsKB}
          onReorder={reorderKBs}
        />
      </div>

      <CreateKBDialog
        visible={showCreateSheet}
        name={createName}
        loading={createLoading}
        error={createError}
        onNameChange={setCreateName}
        onErrorClear={() => setCreateError('')}
        onClose={closeCreateSheet}
        onSubmit={handleCreateKB}
      />

      <ImportKBDialog
        visible={showImportSheet}
        dir={importDir}
        loading={importLoading}
        error={importError}
        onClose={closeImportSheet}
        onSelectDir={handleSelectImportDir}
        onSubmit={handleImportKB}
      />

      <KBSettingsDialog
        visible={!!settingsKB}
        kb={settingsKB}
        onClose={() => setSettingsKB(null)}
        refreshKBList={refreshKBList}
      />
    </div>
  )
}
