/**
 * 首页：知识库列表
 */
import { useState } from 'react'
import { Plus, Download, Book, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useHomeKnowledgeBases, type KBItem } from './model/useHomeKnowledgeBases'
import { useHomeCreateKB } from './model/useHomeCreateKB'
import { useHomeImportKB } from './model/useHomeImportKB'
import { CreateKBDialog } from './components/CreateKBDialog'
import { ImportKBDialog } from './components/ImportKBDialog'
import { KBSettingsDialog } from './components/KBSettingsDialog'
import { KnowledgeBaseGrid } from './components/KnowledgeBaseGrid'
import { TrashDialog } from './components/TrashDialog'
import { EmptyState } from '../../shared/ui/EmptyState'

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
    selectingImportDir,
    importError,
    openImportSheet,
    closeImportSheet,
    handleSelectImportDir,
    handleImportKB,
  } = useHomeImportKB({ refreshKBList })

  const [settingsKB, setSettingsKB] = useState<KBItem | null>(null)
  const [showTrashDialog, setShowTrashDialog] = useState(false)

  return (
    <div id="home-modal" className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 知识库列表 */}
      <div className="flex-1 overflow-y-auto bg-background p-8 md:p-12 relative">
        <div className="mx-auto w-full max-w-7xl">
          {loading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              <span className="ml-3 text-sm font-medium text-muted-foreground">加载中...</span>
            </div>
          )}

          <div className="mb-8 flex items-end justify-between">
            <div className="flex flex-col gap-2">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">我的知识库</h2>
              <p className="text-sm text-muted-foreground">管理和构建您的专属知识网络</p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowTrashDialog(true)}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground  disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                回收站
              </button>
              <button
                onClick={openImportSheet}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground  disabled:pointer-events-none disabled:opacity-50"
              >
                <Download className="mr-2 h-4 w-4" />
                导入
              </button>
              <button
                onClick={openCreateSheet}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90  disabled:pointer-events-none disabled:opacity-50"
              >
                <Plus className="mr-2 h-4 w-4" />
                新建
              </button>
            </div>
          </div>
          
          {message && (
            <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${messageError ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
              {message}
            </div>
          )}
          
          {!loading && kbs.length === 0 ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg-muted)_45%,transparent)]">
              <EmptyState
                size="lg"
                icon={<Book className="h-10 w-10" strokeWidth={1.5} />}
                title="暂无知识库"
                description="您还没有创建任何知识库。创建一个新的知识库或导入现有内容，开始构建您的知识网络。"
                action={
                  <>
                    <button
                      onClick={openCreateSheet}
                      className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] shadow transition-opacity hover:opacity-90"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      新建知识库
                    </button>
                    <button
                      onClick={openImportSheet}
                      className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--color-bg-muted)]"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      导入知识库
                    </button>
                  </>
                }
              />
            </div>
          ) : (
            <KnowledgeBaseGrid
              kbs={kbs}
              onOpenKB={openKB}
              onOpenSettings={setSettingsKB}
              onReorder={reorderKBs}
            />
          )}
        </div>
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
        selectingDir={selectingImportDir}
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

      <TrashDialog
        visible={showTrashDialog}
        onClose={() => setShowTrashDialog(false)}
        refreshKBList={refreshKBList}
      />
    </div>
  )
}
