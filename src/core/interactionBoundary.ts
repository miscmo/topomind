/**
 * P7.2 交互边界：全应用**唯一**生成 traceId 的地方。
 *
 * 旧模型里 `recordUser()` 自己 newTraceId()，但业务埋点往往排在 React 事件处理的
 * 第三、第四位，前面的 logAction 已经各自生成了别的 traceId，一次点击因此被拆成
 * 3 个 trace。这里把边界前移到 window 捕获阶段的真实输入（pointerdown / keydown）：
 * 输入发生的瞬间就开启交互窗口并镜像给 preload，后续所有埋点只**复用**这个 id。
 *
 * 设计约束：
 *  - 纯函数 nextInteraction() 可被门禁直接 import 验证，不依赖 DOM；
 *  - 惰性窗口不建定时器（P0 教训），TTL 由 logContract 的 startInteraction 管理；
 *  - 不写任何日志、不调用 invoke，避免自放大；
 *  - 150ms 内的连点（双击）视为同一交互，键盘输入只延长窗口不换 trace。
 */
import {
  INTERACTION_TTL_MS,
  startInteraction,
  endInteraction,
} from '../shared/observability/logContract.ts'
import { newTraceId } from '../shared/observability/session.ts'
import { syncTraceContext } from './observe.ts'

export interface InteractionState {
  traceId: string
  at: number
}

/** 连点合并窗口：小于该间隔的 pointerdown 视为同一次交互（如双击）。 */
export const POINTER_MERGE_MS = 150

/**
 * 决定一次输入是延续当前交互还是开启新交互。导出为纯函数供 UI 与 C15 共用。
 */
export function nextInteraction(
  current: InteractionState | null,
  type: 'pointerdown' | 'keydown',
  now: number,
): InteractionState {
  if (current && now - current.at < INTERACTION_TTL_MS) {
    // 键盘连续输入只延长窗口，不因为每敲一个键就把同一次操作切成 N 条链。
    if (type === 'keydown') return { traceId: current.traceId, at: now }
    if (type === 'pointerdown' && now - current.at < POINTER_MERGE_MS) {
      return { traceId: current.traceId, at: now }
    }
  }
  return { traceId: newTraceId('interaction'), at: now }
}

let _state: InteractionState | null = null
let _installed = false

function handleInput(type: 'pointerdown' | 'keydown'): void {
  const next = nextInteraction(_state, type, Date.now())
  _state = next
  startInteraction(next.traceId)
  syncTraceContext(next.traceId)
}

/** 在渲染入口最外层安装一次；重复调用幂等，非浏览器环境静默跳过。 */
export function installInteractionBoundary(): void {
  if (_installed || typeof window === 'undefined') return
  _installed = true
  window.addEventListener('pointerdown', () => handleInput('pointerdown'), true)
  window.addEventListener('keydown', () => handleInput('keydown'), true)
}

/** 仅供诊断/测试：读取当前交互状态。 */
export function currentInteraction(): InteractionState | null {
  return _state
}

/** 仅供测试：清空交互状态与窗口，避免用例之间互相污染。 */
export function resetInteractionBoundary(): void {
  _state = null
  endInteraction()
}
