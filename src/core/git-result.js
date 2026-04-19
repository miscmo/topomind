/**
 * 统一解析 Git IPC 返回结果。
 * 可按需提取指定字段、提供回退值，或在 `ok === false` 时直接抛错。
 *
 * @param {object} res Git IPC 返回结果
 * @param {{dataKey?: string|null, fallback?: any, errorMessage?: string, requireOk?: boolean}} [options={}] 解析选项
 * @returns {any} 提取后的结果值
 * @throws {Error} 当 `requireOk` 为 `true` 且返回结果显式失败时抛出异常
 */
export function unwrapGitResult(res, options = {}) {
  const {
    dataKey = null,
    fallback = null,
    errorMessage = '操作失败',
    requireOk = false,
  } = options

  if (requireOk && res?.ok === false) {
    const err = new Error(res?.error || errorMessage)
    if (res?.code) err.code = res.code
    throw err
  }

  if (dataKey) {
    if (res && Object.prototype.hasOwnProperty.call(res, dataKey)) {
      return res[dataKey]
    }
    return fallback
  }

  return res ?? fallback
}
