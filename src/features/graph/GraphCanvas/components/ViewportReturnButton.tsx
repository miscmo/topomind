/**
 * 一次性「返回上个视野」胶囊按钮（挂在 React Flow 的 bottom-center Panel）。
 *
 * 只在程序化跳转到远处节点后出现，不常驻、不落盘。消失策略全部由
 * `domain/graph/viewportReturn.ts` 的规则源决定：超时 / hover 暂停 / 手动操作 /
 * 离开落点 / 点击返回 / 主动关闭。所有交互都要 nodrag nowheel，否则会被画布手势抢走。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, useReactFlow, useStore } from '@xyflow/react'
import { CornerUpLeft, X } from 'lucide-react'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import {
  VIEWPORT_RETURN_ANIMATION_MS,
  VIEWPORT_RETURN_TTL_MS,
  hasUserMovedAway,
  type ViewportReturnEntry,
} from '../../../../domain/graph/viewportReturn'
import { useViewportReturnStore } from '../model/viewportReturnStore'

export default function ViewportReturnButton({ tabId }: { tabId: string }) {
  const entry = useViewportReturnStore((s) => s.entries[tabId] ?? null)
  const dismiss = useViewportReturnStore((s) => s.dismiss)
  const reactFlow = useReactFlow()
  const graphStoreApi = useGraphStoreApi()

  // 订阅「是否已经偏离落点」的布尔，而不是每帧变化的浮点 transform：
  // 缩放时 transform 每帧都变，订阅布尔只在跨阈值时重渲染一次。
  const movedAway = useStore((s) => {
    if (!entry) return false
    return hasUserMovedAway(entry, {
      x: s.transform[0],
      y: s.transform[1],
      zoom: s.transform[2],
    })
  })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [rendered, setRendered] = useState<ViewportReturnEntry | null>(entry)
  const [hovered, setHovered] = useState(false)
  const [remainingMs, setRemainingMs] = useState(VIEWPORT_RETURN_TTL_MS)

  // 卸载时留 200ms 做淡出，避免按钮「啪」地一下消失。
  useEffect(() => {
    if (entry) {
      setRendered(entry)
      setRemainingMs(VIEWPORT_RETURN_TTL_MS)
      return
    }
    const timer = window.setTimeout(() => setRendered(null), 200)
    return () => window.clearTimeout(timer)
  }, [entry])

  // 倒计时：hover 暂停（正在犹豫时不打断），离开后继续。用递减计数而不是
  // wall clock 差值，避免暂停结束后时间一次性跳到过期。
  useEffect(() => {
    if (!entry || hovered) return
    const timer = window.setInterval(() => {
      setRemainingMs((value) => Math.max(0, value - 100))
    }, 100)
    return () => window.clearInterval(timer)
  }, [entry, hovered])

  useEffect(() => {
    if (entry && remainingMs <= 0) dismiss(tabId)
  }, [entry, remainingMs, dismiss, tabId])

  useEffect(() => {
    if (entry && movedAway) dismiss(tabId)
  }, [entry, movedAway, dismiss, tabId])

  // 用户一旦自己操作画布 / 点别处，就说明已经在新视野里开工，提示立刻失效。
  // 点击胶囊自身除外（捕获阶段拦下，用 contains 排除）。
  useEffect(() => {
    if (!entry) return
    const onInteract = (event: Event) => {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      dismiss(tabId)
    }
    window.addEventListener('pointerdown', onInteract, true)
    window.addEventListener('wheel', onInteract, true)
    return () => {
      window.removeEventListener('pointerdown', onInteract, true)
      window.removeEventListener('wheel', onInteract, true)
    }
  }, [entry, dismiss, tabId])

  const handleReturn = useCallback(() => {
    if (!entry) return
    const from = { ...entry.from }
    dismiss(tabId)
    void reactFlow.setViewport(from, { duration: VIEWPORT_RETURN_ANIMATION_MS })
    // 程序化 setViewport 不保证触发 onMoveEnd，动画结束后把落盘视口对齐一次，
    // 否则下次进入房间又会跳回跳转后的镜头。
    window.setTimeout(() => {
      graphStoreApi.getState().setViewport({ ...from })
    }, VIEWPORT_RETURN_ANIMATION_MS + 40)
  }, [entry, dismiss, tabId, reactFlow, graphStoreApi])

  if (!rendered) return null
  const visible = entry !== null
  const ratio = Math.max(0, Math.min(1, remainingMs / VIEWPORT_RETURN_TTL_MS))

  return (
    <Panel position="bottom-center" className="!m-3">
      <div
        ref={containerRef}
        data-tm-viewport-back=""
        data-tm-viewport-back-available={visible ? 'true' : 'false'}
        data-tm-viewport-back-label={rendered.label}
        data-tm-viewport-back-remaining={String(Math.ceil(remainingMs / 1000))}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`nodrag nowheel pointer-events-auto relative flex items-center gap-1 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1 pl-1.5 pr-1 shadow-[var(--shadow-popover)] transition-all duration-200 ${
          visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1.5 opacity-0'
        }`}
      >
        <button
          type="button"
          data-tm-viewport-back-action=""
          onClick={handleReturn}
          title="返回跳转前的视野（稍后自动消失）"
          className="nodrag nowheel flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]"
        >
          <CornerUpLeft size={13} className="text-[var(--color-accent)]" aria-hidden="true" />
          <span className="max-w-[180px] truncate">返回「{rendered.label}」</span>
        </button>
        <button
          type="button"
          data-tm-viewport-back-dismiss=""
          aria-label="关闭返回提示"
          onClick={() => dismiss(tabId)}
          className="nodrag nowheel flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]"
        >
          <X size={11} aria-hidden="true" />
        </button>
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-[var(--color-accent)] transition-[width] duration-100 ease-linear"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </Panel>
  )
}
