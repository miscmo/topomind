import type { LoggingApi, LogsApi } from '../../../public'
import { logDayKey } from '../../../../shared/observability/logContract'

/**
 * 一键诊断包的唯一导出实现：原始日志工具条与「异常与崩溃」视图共用，
 * 保证两处都走同样的二次确认、二次脱敏提示与文件命名。
 * 主进程 exportDiagnosticBundle() 负责内容脱敏，这里只负责下载与确认。
 */
export async function downloadDiagnosticBundle(logs: LogsApi, log: LoggingApi): Promise<boolean> {
  if (!logs.exportBundle) return false
  if (!window.confirm('诊断包包含四类日志、错误指纹、运行环境与崩溃转储引用。虽已二次脱敏，分享前请仍检查内容。是否继续导出？')) return false
  log.info('export diagnostic bundle', { source: 'monitor-error-view' })
  const content = await logs.exportBundle()
  if (!content) return false
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `topomind-diagnostic-${logDayKey()}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
