/**
 * 容器全屏编辑宿主：唯一允许挂载 Excalidraw 实例的地方。
 *
 * v1.4：编辑从「节点内嵌」改成「全屏覆盖」。节点永久退化为只读 SVG 预览，
 * 双击只负责把会话写进 store；本宿主 portal 到 document.body，用 fixed 覆盖
 * 工作区，因此**不再有 React Flow 的 .react-flow__viewport CSS transform 祖先**——
 * 这正是节点内编辑时 Excalidraw 指针坐标偏移、很难操作的根因。
 *
 * 数据所有权也随之上移：读盘 / 400ms debounce 落盘 / close-guard / 卸载 flush
 * 全部在这里收口，成功后 bump revision 通知节点重读磁盘重建预览。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStorage } from '../../../../core/storage'
import { registerTabSaver } from '../../../../core/close-guard'
import { getContainerType } from '../../../../domain/container/containerTypes'
import { getContainerRenderer } from './containerRenderers'
import { useActiveContainerStore, type ActiveContainerSession } from './activeContainerStore'

/** 内容保存 debounce：比右栏 1500ms 更短，避免失焦 / 退出时丢笔画。 */
const CONTAINER_SAVE_DELAY_MS = 400
/** 自定义标题栏固定高度：全屏层从它下方开始，窗口拖拽区 / 菜单 / 关闭按钮始终可用。 */
const TITLEBAR_HEIGHT = 32
/** 低于标题栏菜单（z-3001/3002），高于所有工作区浮层。 */
const FULLSCREEN_Z_INDEX = 2800

type SaveState = 'idle' | 'pending' | 'saved' | 'error'

function FullscreenMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4 text-center text-[13px] text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

interface ContainerFullscreenEditorHostProps {
  tabId: string
  isActive: boolean
}

/**
 * 外层只订阅会话、做可见性开关。真正的读写 / saver / 编辑器实例都在
 * FullscreenSession 里，且用 key 隔离：换一个容器必定重新挂载、重新读盘。
 */
export function ContainerFullscreenEditorHost({ tabId, isActive }: ContainerFullscreenEditorHostProps) {
  const session = useActiveContainerStore((state) => state.session)
  const deactivate = useActiveContainerStore((state) => state.deactivate)

  // 切走标签页必须收口会话，否则切回来会莫名又弹出上一次的全屏编辑器。
  // 卸载 FullscreenSession 会触发 flush，笔画不会丢。
  useEffect(() => {
    if (isActive) return
    const current = useActiveContainerStore.getState().session
    if (current?.tabId === tabId) deactivate(current.nodeId)
  }, [isActive, tabId, deactivate])

  if (!isActive || !session || session.tabId !== tabId) return null
  return (
    <FullscreenSession
      key={`${session.nodeId}:${session.documentId}`}
      session={session}
      tabId={tabId}
    />
  )
}

function FullscreenSession({ session, tabId }: { session: ActiveContainerSession; tabId: string }) {
  const storage = useStorage()
  const spec = getContainerType(session.containerType)
  const renderer = getContainerRenderer(session.containerType)
  const deactivate = useActiveContainerStore((state) => state.deactivate)
  const bumpRevision = useActiveContainerStore((state) => state.bumpRevision)

  const [loaded, setLoaded] = useState<{ key: string; value: unknown } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const pendingRef = useRef<unknown>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const lastVersionRef = useRef<number | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  const docKey = `${session.cardPath}:${session.documentId}`
  const content = loaded?.key === docKey ? loaded.value : undefined
  const Editor = renderer?.Editor

  // 只在会话建立时读盘一次；之后的 onChange 由本组件自己持有，绝不回读覆盖未落盘内容。
  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    if (!spec) { setLoadError(true); return }
    void storage.readTopoDocument(session.cardPath, session.documentId).then((raw) => {
      if (cancelled) return
      try { setLoaded({ key: docKey, value: spec.normalize(raw, session.title) }) }
      catch { setLoadError(true) }
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [docKey, session.cardPath, session.documentId, session.title, spec, storage])

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!dirtyRef.current) return
    setSaveState('pending')
    try {
      await storage.writeTopoDocument(session.cardPath, session.documentId, pendingRef.current)
      dirtyRef.current = false
      // 节点是只读预览，只能靠这个信号知道磁盘变了。
      bumpRevision()
      setSaveState('saved')
    } catch {
      // 保留 dirty：close-guard / 下一次编辑 / 退出动作都会重试，绝不覆盖更晚的输入。
      setSaveState('error')
    }
  }, [session.cardPath, session.documentId, storage, bumpRevision])

  const handleChange = useCallback((next: unknown) => {
    const version = spec?.getSceneVersion?.(next) ?? null
    if (version !== null && version === lastVersionRef.current) return
    lastVersionRef.current = version
    setLoaded({ key: docKey, value: next })
    pendingRef.current = next
    dirtyRef.current = true
    setSaveState('pending')
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flush() }, CONTAINER_SAVE_DELAY_MS)
  }, [docKey, flush, spec])

  // 关窗 / 切标签 / 切房间 / 退出：先落盘再允许编辑器实例消失。
  useEffect(() => registerTabSaver(tabId, flush, () => dirtyRef.current), [tabId, flush])
  useEffect(() => () => { void flush() }, [flush])

  const requestClose = useCallback(() => {
    void flush().finally(() => {
      bumpRevision()
      deactivate(session.nodeId)
    })
  }, [flush, bumpRevision, deactivate, session.nodeId])

  // 全屏刚打开时焦点还在画布节点上，编辑器容器内收不到按键；
  // 用 window 捕获阶段兜底，保证 Esc 一定能回到画布。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      // Excalidraw 文本编辑中的 Esc 是「结束文本」，不能顺手关掉整个编辑器。
      const active = document.activeElement as HTMLElement | null
      if (active?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      requestClose()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [requestClose])

  useEffect(() => { hostRef.current?.focus({ preventScroll: true }) }, [])

  return createPortal(
    <div
      ref={hostRef}
      data-tm-fullscreen-editor={session.nodeId}
      data-tm-container-session={session.tabId}
      className="tm-fade-enter flex flex-col bg-[var(--color-surface)] outline-none"
      style={{
        position: 'fixed',
        top: TITLEBAR_HEIGHT,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: FULLSCREEN_Z_INDEX,
      }}
      tabIndex={-1}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 text-[12px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-[var(--color-text-primary)]">{session.title}</span>
          <span className="shrink-0 text-[var(--color-text-muted)]">全屏编辑 · 按 Esc 返回画布</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[var(--color-text-muted)]" data-tm-fullscreen-save={saveState}>
            {saveState === 'pending' ? '保存中…'
              : saveState === 'error' ? '保存失败，退出时重试'
                : saveState === 'saved' ? '已保存' : ''}
          </span>
          <button
            type="button"
            data-tm-fullscreen-close="true"
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]"
            onClick={requestClose}
          >
            退出编辑
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {!renderer || !spec ? (
          <FullscreenMessage text={`未知容器类型：${session.containerType}（原始数据已保留）`} />
        ) : loadError ? (
          <FullscreenMessage text="载荷读取失败或版本不受支持，原始文件已保留，不提供编辑入口" />
        ) : content === undefined ? (
          <FullscreenMessage text="正在加载容器内容..." />
        ) : Editor ? (
          <Suspense fallback={<FullscreenMessage text="正在加载编辑器..." />}>
            <Editor
              nodeId={session.nodeId}
              documentId={session.documentId}
              cardPath={session.cardPath}
              content={content}
              title={session.title}
              active
              onChange={handleChange}
            />
          </Suspense>
        ) : (
          <FullscreenMessage text="容器缺少全屏编辑渲染器" />
        )}
      </div>
    </div>,
    document.body,
  )
}
