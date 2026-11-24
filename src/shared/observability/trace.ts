/**
 * 跨渲染 → 主进程 → 异步回调的链路 id（兼容门面）。
 *
 * v3 起 trace 状态内聚到 logContract.ts（唯一真源），buildLogEntry 能直接读取
 * 当前作用域，避免出现「两份 activeTraceId」导致同一操作内每条日志各生成 id。
 * 本文件保留原有 API，业务代码无需改动 import 路径。
 */
export { newTraceId, getCurrentTraceId, withTraceId } from './logContract.ts'
