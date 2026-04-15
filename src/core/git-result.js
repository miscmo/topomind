/**
 * Git IPC 返回解析工具
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
