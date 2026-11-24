/**
 * v3 会话关联键门面：一次操作 = 一个 trace + 一棵 span 树。
 *
 * 设计取舍：sessionId / seq / workspaceId 由主进程统一生成并补全（渲染侧不伪造）；
 * 渲染侧只负责「作用域」，即把同一个 traceId、嵌套的 span/parent 传给随后
 * 产生的所有日志。P2 的 IPC / 命令 / 插件生命周期拦截层只需包一层
 * `startOperation` 或 `withSpan`，无需改各业务调用点。
 *
 * 注意：withTraceId / withSpan 是同步作用域，异步任务要在 await 之后继续保持
 * 关联时，应在任务开始时重新开 scope 并显式传 traceId（P2 拦截层会这么做）。
 */
import {
  newTraceId,
  getCurrentTraceId,
  withTraceId,
  newSpanId,
  getActiveSpan,
  withSpan,
  withSpanContext,
  type LogTarget,
} from './logContract.ts'

export {
  newTraceId,
  getCurrentTraceId,
  withTraceId,
  newSpanId,
  getActiveSpan,
  withSpan,
  withSpanContext,
}

/** 一次用户操作：同时建立 trace 与根 span，内部步骤自动获得 parentId。 */
export function startOperation<T>(name: string, fn: (traceId: string, spanId: string) => T): T {
  return withTraceId(name, (traceId) => withSpan(name, (spanId) => fn(traceId, spanId)))
}

/**
 * 构建用户事件的目标对象（v3 D3）。label 在契约层会被替换为长度摘要，
 * 因此这里可以安全地传入文档标题 / 节点名，磁盘上不会留明文。
 */
export function describeTarget(type: string, id?: string, label?: string): LogTarget {
  return { type, ...(id ? { id } : {}), ...(label ? { label } : {}) }
}
