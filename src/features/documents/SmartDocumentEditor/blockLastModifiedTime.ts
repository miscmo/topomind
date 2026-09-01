/**
 * 块「最后修改时间」的纯展示 / 解析工具。
 *
 * ⚠️ 刻意不依赖 BlockNote / ProseMirror：状态栏等 UI 模块可安全 import，
 *    不会把编辑器核心（@blocknote/core）拉进首屏 bundle，也不受
 *    patchBlockSpecs 的模块加载顺序约束影响。
 *
 * 记录逻辑（写 lastModified 属性）见 blockLastModifiedExtension.ts；这里只管
 * 「时间戳 → 文案」与「原始 props 值 → 有效时间戳」的纯函数。
 */

/** 本功能上线时刻。此前创建的块没有记录，统一回退到该时刻，避免显示 1970 年这类无意义时间。 */
export const BLOCK_LAST_MODIFIED_EPOCH = new Date('2026-09-01T12:48:00+08:00').getTime()

export function formatBlockLastModified(timestamp: number): string {
  const date = new Date(timestamp > 0 ? timestamp : BLOCK_LAST_MODIFIED_EPOCH)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 从块 props 里取出有效的时间戳（无效则回退到本功能上线时刻）。 */
export function resolveBlockLastModified(raw: unknown): number {
  return typeof raw === 'number' && raw > 0 ? raw : BLOCK_LAST_MODIFIED_EPOCH
}
