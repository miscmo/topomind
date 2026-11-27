/**
 * 标题栏 tab 栏右侧常驻的「+」与知识库列表浮窗。
 *
 * 职责边界（与 TabBar 一致）：TabBar 只负责「已打开的知识库之间切换」，
 * 这里负责「从当前工作区的知识库清单里打开 / 切到某一个」，最终统一走
 * tabStore.openKnowledgeBase()：已开过的只激活，没开过的补一个 tab。
 *
 * 与左栏旧面板的区别：旧入口是 NavRail 的竖 tab + 左栏 absolute 面板，
 * 现在收敛成浏览器标签栏尾部的「+」浮窗；取数仍是轻量 storage.listKBs()，
 * 不复用首页带封面 / 排序的重型网格。每次展开重新读一次目录，新建 / 导入
 * / 外部删除的知识库立刻可见。
 *
 * 显隐 / 遮罩 / Escape 由 TabBar 统一托管（标题栏是 app-region: drag 区，
 * 外部点击必须靠一层 no-drag 透明遮罩接管），本组件只做受控渲染。
 */
import { BookOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { TM_UI, tmUI } from '../../../shared/ui/controlStyles'
import { logAction } from '../../../core/log-backend'
import { useStorage } from '../../../core/storage'
import { tabStore, useTabStore } from '../../../stores/tabs/tabStore'
import type { KBListItem } from '../../../types'

interface KnowledgeBasePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 关闭浮层后把焦点还给「+」按钮，避免键盘焦点掉进 drag 区。 */
  triggerRef: RefObject<HTMLButtonElement | null>
}

export default function KnowledgeBasePicker({ open, onOpenChange, triggerRef }: KnowledgeBasePickerProps) {
  const storage = useStorage()
  const activeTabId = useTabStore((state) => state.activeTabId)
  /** null = 还没读到过清单。重新展开保留上次结果并在后台静默刷新，避免闪一下 loading，
   *  也不在 effect 里同步 setState（会触发级联渲染）。 */
  const [snapshot, setSnapshot] = useState<{ kbs: KBListItem[]; error: string } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void storage.listKBs()
      .then((list) => {
        if (!cancelled) setSnapshot({ kbs: list ?? [], error: '' })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSnapshot({ kbs: [], error: cause instanceof Error ? cause.message : String(cause) })
        }
      })
    return () => { cancelled = true }
  }, [open, storage])

  const kbs = snapshot?.kbs ?? []
  const loading = snapshot === null
  const error = snapshot?.error ?? ''

  const openKB = useCallback((name: string) => {
    const opened = tabStore.getState().openKnowledgeBase({ name })
    if (!opened) return
    logAction('kb.open', 'kb', { kbName: name, source: 'titlebar-picker' })
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <div className="relative flex h-full shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        data-tm-tab-add=""
        aria-label="打开知识库列表"
        title="打开知识库列表"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={TM_UI.tabAdd}
        onClick={() => onOpenChange(!open)}
      >
        <Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="知识库列表"
          data-tm-kb-picker=""
          className={tmUI(
            TM_UI.menu,
            TM_UI.kbPicker,
            'tm-fade-enter absolute right-0 top-[calc(100%+6px)] w-[240px]',
          )}
          style={{ WebkitAppRegion: 'no-drag', zIndex: 'var(--z-titlebar-menu)' }}
        >
          <div className={tmUI('flex shrink-0 items-center justify-between', TM_UI.menuGroupTitle)}>
            <span>打开知识库</span>
            <span>{kbs.length}</span>
          </div>

          <div className={tmUI(TM_UI.scroll, 'min-h-0 flex-1 overflow-y-auto')}>
            {loading && kbs.length === 0 && (
              <div className={tmUI(TM_UI.hint, 'px-2 py-2')}>正在加载知识库…</div>
            )}
            {error && <div className={tmUI(TM_UI.hint, 'px-2 py-2')}>{error}</div>}
            {!loading && !error && kbs.length === 0 && (
              <div className={tmUI(TM_UI.hint, 'px-2 py-2')}>当前工作区还没有知识库</div>
            )}
            {kbs.map((kb) => (
              <button
                key={kb.name}
                type="button"
                data-tm-kb-picker-item={kb.name}
                data-active={activeTabId === `kb:${kb.name}` ? 'true' : undefined}
                title={`打开知识库 ${kb.name}`}
                className={TM_UI.menuItem}
                onClick={() => openKB(kb.name)}
              >
                <BookOpen className={TM_UI.iconSm} aria-hidden="true" />
                <span className={TM_UI.tabMenuLabel} title={kb.name}>{kb.name}</span>
              </button>
            ))}
          </div>

          <div className={tmUI(TM_UI.hint, 'shrink-0 px-2 pb-1')}>新建与导入在首页</div>
        </div>
      )}
    </div>
  )
}
