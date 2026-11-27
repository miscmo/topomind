/**
 * AI 会话「提问记录」轨道（左栏消息区左缘）。
 *
 * 形态参考主流 Agent 的对话大纲：平时只有垂直居中的一小段紧凑细刻度（不贯穿
 * 整个消息区、没有竖向导引线），不占正文宽度；鼠标滑到某条刻度 / 键盘聚焦时，
 * 右侧浮出该次提问的详情卡（序号、时间、标题、摘要），点刻度平滑定位回对应的
 * 消息气泡并短时高亮。
 *
 * 数据口径：
 *  - 只消费 agentSessionStore 的当前会话 messages，过滤 role === 'user'，
 *    切换 / 新建会话时随 hydrate 自动重建，不额外引入第二份会话状态；
 *  - 提问时间从消息 id 解析（newId() 形如 `user-<Date.now().toString(36)>-<rand>`，
 *    且 sessions.json 原样保留 id）。这样无需给落盘消息加字段、无需迁移主进程
 *    白名单，重开软件后时间依旧准确；解析失败时降级为不显示时间，绝不编造。
 *  - 轨道不随消息区滚动：它是滚动容器的兄弟覆盖层，刻度收拢在垂直居中的一小段里；
 *    激活刻度跟随滚动位置（滚到底 = 最后一条提问），提问多到超出段高时自动把激活
 *    刻度滚进段内，避免高亮落在看不见的地方。
 *
 * 交互安全性：浮层根 pointer-events: none，只有刻度与卡片接收事件；卡片与刻度
 * 之间用 180ms 延迟关闭，鼠标可以在两者之间移动而不闪断。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import type { AiChatMessage } from '@/core/ai-types'

interface AgentQuestionRailProps {
  messages: readonly AiChatMessage[]
  /** 消息滚动容器：用于计算激活刻度。 */
  scrollRef: RefObject<HTMLDivElement | null>
  /** 点刻度定位：由 AgentPanel 负责实际滚动与高亮。 */
  onJump: (id: string) => void
}

interface QuestionEntry {
  id: string
  index: number
  title: string
  rest: string
  time: string
}

/** 与 --space-sm 对齐的浮卡上下留白；只是布局边距，不是视觉真源色值。 */
const CARD_EDGE = 8
const CARD_CLOSE_DELAY_MS = 180

function timeFromMessageId(id: string): number | null {
  const match = /^(?:user|assistant|msg)-([0-9a-z]+)-/.exec(id)
  if (!match) return null
  const ts = Number.parseInt(match[1], 36)
  const now = Date.now()
  if (!Number.isFinite(ts) || ts < 1600000000000 || ts > now + 86400000) return null
  return ts
}

function formatQuestionTime(ts: number | null): string {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export default function AgentQuestionRail({ messages, scrollRef, onJump }: AgentQuestionRailProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [cardTop, setCardTop] = useState(CARD_EDGE)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const tickRefs = useRef(new Map<string, HTMLButtonElement>())
  const closeTimer = useRef<number | null>(null)

  const entries = useMemo<QuestionEntry[]>(() => {
    const list = messages.filter((item) => item.role === 'user')
    return list.map((item, position) => {
      const text = item.content.trim()
      const newline = text.indexOf('\n')
      const first = (newline >= 0 ? text.slice(0, newline) : text).trim()
      return {
        id: item.id,
        index: position + 1,
        title: first || '（空提问）',
        rest: newline >= 0 ? text.slice(newline + 1).trim() : '',
        time: formatQuestionTime(timeFromMessageId(item.id)),
      }
    })
  }, [messages])

  const hovered = entries.find((item) => item.id === hoveredId) ?? null

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      setHoveredId(null)
      closeTimer.current = null
    }, CARD_CLOSE_DELAY_MS)
  }, [cancelClose])

  const showCard = useCallback((id: string) => {
    cancelClose()
    setHoveredId(id)
  }, [cancelClose])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  /** 激活刻度 = 当前视口顶部对应的提问；滚到底（短会话也算）时是最后一条。 */
  const updateActive = useCallback(() => {
    const container = scrollRef.current
    if (!container || entries.length === 0) {
      setActiveId(null)
      return
    }
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= CARD_EDGE
    if (atBottom) {
      setActiveId(entries[entries.length - 1].id)
      return
    }
    const containerTop = container.getBoundingClientRect().top
    const rows = container.querySelectorAll<HTMLElement>(
      '[data-tm-ai-message-row="user"][data-tm-ai-message-id]',
    )
    let current = entries[0].id
    for (const row of rows) {
      const id = row.getAttribute('data-tm-ai-message-id')
      if (!id) continue
      if (row.getBoundingClientRect().top - containerTop <= 24) current = id
      else break
    }
    setActiveId(current)
  }, [scrollRef, entries])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateActive)
    }
    container.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    observer?.observe(container)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('scroll', schedule)
      observer?.disconnect()
    }
  }, [scrollRef, updateActive])

  /** 刻度段被压短后，激活刻度可能在段外：只滚动轨道自身，绝不牵动消息正文。 */
  useEffect(() => {
    if (!activeId) return
    const track = trackRef.current
    const tick = tickRefs.current.get(activeId)
    if (!track || !tick) return
    const trackRect = track.getBoundingClientRect()
    const tickRect = tick.getBoundingClientRect()
    const above = tickRect.top - trackRect.top
    const below = tickRect.bottom - trackRect.bottom
    if (above < 0) track.scrollTop += above
    else if (below > 0) track.scrollTop += below
  }, [activeId, entries.length])

  /** 卡片以刻度中心对齐，并在消息可视区内上下钳制，绝不越出面板。 */
  useLayoutEffect(() => {
    if (!hoveredId) return
    const layer = layerRef.current
    const card = cardRef.current
    const tick = tickRefs.current.get(hoveredId)
    if (!layer || !card || !tick) return
    const layerRect = layer.getBoundingClientRect()
    const tickRect = tick.getBoundingClientRect()
    const centered = tickRect.top - layerRect.top + tickRect.height / 2 - card.offsetHeight / 2
    const maxTop = Math.max(CARD_EDGE, layerRect.height - card.offsetHeight - CARD_EDGE)
    setCardTop(Math.min(Math.max(CARD_EDGE, centered), maxTop))
  }, [hoveredId, entries.length])

  // 会话切换后 hoveredId 可能已失效：hovered 由 entries 派生，查不到就不会渲染卡片，
  // 无需在 effect 里再同步一次 state。

  const jump = (id: string) => {
    cancelClose()
    setHoveredId(null)
    onJump(id)
  }

  if (entries.length === 0) return null

  return (
    <div
      ref={layerRef}
      className={TM_UI.aiQuestionLayer}
      aria-label="本会话提问记录"
      data-tm-ai-question-rail=""
      data-tm-ai-question-count={entries.length}
    >
      <div
        ref={trackRef}
        className={TM_UI.aiQuestionTrack}
        data-tm-ai-question-track=""
        onKeyDown={(event) => {
          if (event.key === 'Escape') setHoveredId(null)
        }}
      >
        {entries.map((item) => (
          <button
            key={item.id}
            type="button"
            ref={(node) => {
              if (node) tickRefs.current.set(item.id, node)
              else tickRefs.current.delete(item.id)
            }}
            className={TM_UI.aiQuestionTick}
            aria-label={`第 ${item.index} 条提问：${item.title.slice(0, 40)}`}
            aria-current={activeId === item.id ? 'true' : undefined}
            data-tm-ai-question-tick={item.id}
            onMouseEnter={() => showCard(item.id)}
            onMouseLeave={scheduleClose}
            onFocus={() => showCard(item.id)}
            onBlur={scheduleClose}
            onClick={() => jump(item.id)}
          />
        ))}
      </div>

      {hovered && (
        <div
          ref={cardRef}
          className={tmUI(TM_UI.aiQuestionCard, 'tm-fade-enter')}
          style={{ top: cardTop }}
          role="tooltip"
          data-tm-ai-question-card={hovered.id}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className={TM_UI.aiQuestionCardHead}>
            <span className={TM_UI.aiQuestionCardIndex}>
              提问 {pad2(hovered.index)} / {pad2(entries.length)}
            </span>
            <span>{hovered.time || '当前会话'}</span>
          </div>
          <div className={TM_UI.aiQuestionCardTitle}>{hovered.title}</div>
          {hovered.rest && <div className={TM_UI.aiQuestionCardBody}>{hovered.rest}</div>}
          <div className={TM_UI.aiQuestionCardFoot}>
            <CornerDownLeft className={TM_UI.icon} strokeWidth={1.8} />
            <span>点击刻度定位到这条提问</span>
          </div>
        </div>
      )}
    </div>
  )
}
