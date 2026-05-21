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
    <div id="home-modal" className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 知识库列表 */}
      <div className="flex-1 overflow-y-auto bg-background p-8 md:p-12 relative">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            <span className="ml-3 text-sm font-medium text-muted-foreground">加载中...</span>
          </div>
        )}

        <div className="mb-6 flex items-center gap-3">
          <div className="h-5 w-1.5 rounded-full bg-accent"></div>
          <h2 className="text-lg font-semibold text-foreground">我的知识库</h2>
        </div>
        
        {message && (
          <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${messageError ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
            {message}
          </div>
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
