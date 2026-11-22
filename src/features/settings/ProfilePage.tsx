/**
 * 用户信息 / 工作区概览（宿主视图 host.profile）
 * 账号能力尚未接入，先提供一个稳定的落点：本地工作区身份、数据概览、后续能力说明。
 */
import { memo, useEffect, useState } from 'react'
import { Book, FolderOpen, Settings, ShieldCheck } from 'lucide-react'
import { useStorage } from '@/core/storage'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useTabStore } from '@/stores/tabs/tabStore'
import { executeCommand } from '@/application/commands'
import { HOST_VIEW_IDS } from '@/features/layout/NavRail/navModel'

const SECTION = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5'
const BTN = 'h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-hover-bg)]'

export default memo(function ProfilePage() {
  const storage = useStorage()
  const currentWorkDir = useWorkspaceStore((state) => state.currentWorkDir)
  const [kbCount, setKbCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void storage.listKBs()
      .then((list) => { if (alive) setKbCount((list ?? []).length) })
      .catch(() => { if (alive) setKbCount(null) })
    return () => { alive = false }
  }, [storage])

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-app)] px-8 py-10">
      <div className="mx-auto w-full max-w-[720px]">
        <div className={`${SECTION} flex items-center gap-4`}>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[20px] font-medium text-[var(--color-accent)]">本</div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-[var(--color-text-primary)]">本地工作区</h1>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">当前以本地模式使用，数据不上传、不依赖账号</p>
          </div>
        </div>

        <div className={`${SECTION} mt-4`}>
          <h2 className="mb-4 flex items-center gap-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            <FolderOpen className="h-4 w-4 text-[var(--color-accent)]" />数据概览
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[var(--color-bg-muted)] p-4">
              <div className="text-[11px] text-[var(--color-text-muted)]">知识库</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-[var(--color-text-primary)]">
                {kbCount === null ? '—' : kbCount}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--color-bg-muted)] p-4">
              <div className="text-[11px] text-[var(--color-text-muted)]">存储位置</div>
              <div className="mt-1 truncate text-[13px] text-[var(--color-text-primary)]" title={currentWorkDir ?? ''}>
                {currentWorkDir ? '本地磁盘' : '未选择'}
              </div>
            </div>
          </div>
          <p className="mt-3 truncate text-[11px] text-[var(--color-text-muted)]" title={currentWorkDir ?? ''}>
            {currentWorkDir ?? '尚未选择工作目录'}
          </p>
        </div>

        <div className={`${SECTION} mt-4`}>
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            <ShieldCheck className="h-4 w-4 text-[var(--color-accent)]" />账号与同步
          </h2>
          <p className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            这里预留用户信息、云端同步与多设备入口。当前版本所有内容保存在本地工作目录，
            左侧导航栏底部的位置即为后续账号入口，接入时无需改动画布与编辑器布局。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => useTabStore.getState().openSecondaryViewTab({ viewId: HOST_VIEW_IDS.settings, label: '设置' })}
              className={BTN}
            >
              <Settings className="mr-1.5 inline h-3.5 w-3.5" />打开设置
            </button>
            <button type="button" onClick={() => useTabStore.getState().activateTab('home')} className={BTN}>
              <Book className="mr-1.5 inline h-3.5 w-3.5" />返回首页
            </button>
            <button
              type="button"
              onClick={() => void executeCommand('workspace.switch').catch(() => undefined)}
              className={BTN}
            >
              切换工作目录
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
