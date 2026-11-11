import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnifiedTreeNode } from '../../../core/fs-backend'
import type { UnifiedTreeDataSource, UnifiedTreeRow } from './types'

/** 与主进程 UNIFIED_TREE_ROOT_KEY 一致；渲染层除此之外不解析任何 key。 */
export const UNIFIED_TREE_ROOT_KEY = 'root'

export interface UnifiedTreeApi {
  /** 已展开分支深度优先展平后的可见行。 */
  rows: UnifiedTreeRow[]
  loadingRoot: boolean
  /** 累计的按层请求次数（诊断 / 回归用：打开弹窗应恰好为 1）。 */
  loadCount: number
  error: string | null
  expandedKeys: string[]
  isExpanded: (key: string) => boolean
  toggle: (key: string) => void
  /** 依次展开一条 key 链，用于搜索结果「在树中定位」或已选回显。 */
  expandPath: (keys: string[]) => Promise<void>
  /** 丢弃全部缓存重新加载根层（弹窗每次打开调用）。 */
  refresh: () => void
}

/**
 * 通用惰性树状态：按 key 缓存层、合并并发请求、乐观展开空层回填。
 *
 * 约定（与项目其它外部 store 一致）：**先写 ref 快照再 setState 通知**，
 * 避免同一 tick 内的连续 toggle 读到旧值。key 一律视为不透明字符串，
 * 主进程以后加分组 / 换层级规则都不需要改这个 hook。
 */
export function useUnifiedTree(dataSource: UnifiedTreeDataSource): UnifiedTreeApi {
  const [levels, setLevels] = useState<Record<string, UnifiedTreeNode[]>>({})
  const levelsRef = useRef<Record<string, UnifiedTreeNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef<Set<string>>(new Set())
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set())
  const [loadCount, setLoadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(new Map<string, Promise<UnifiedTreeNode[]>>())
  const generation = useRef(0)

  const loadLevel = useCallback(async (parentKey: string): Promise<UnifiedTreeNode[]> => {
    const cached = levelsRef.current[parentKey]
    if (cached) return cached
    const pending = inflight.current.get(parentKey)
    if (pending) return pending
    const gen = generation.current
    // 用 token 持有自身引用，避免 finally 里直接闭包引用 task 触发「赋值前使用」。
    const token: { task?: Promise<UnifiedTreeNode[]> } = {}
    const task = (async () => {
      setLoadCount((count) => count + 1)
      setLoadingKeys((prev) => new Set(prev).add(parentKey))
      try {
        const level = await dataSource.loadLevel(parentKey)
        const nodes = Array.isArray(level?.nodes) ? level.nodes : []
        if (gen !== generation.current) return nodes
        const next: Record<string, UnifiedTreeNode[]> = { ...levelsRef.current, [parentKey]: nodes }
        // card 节点是乐观可展开的；真的展开到空层就回填 hasChildren=false 并收起箭头。
        if (nodes.length === 0) {
          for (const [ownerKey, list] of Object.entries(levelsRef.current)) {
            if (list.some((node) => node.key === parentKey && node.hasChildren)) {
              next[ownerKey] = list.map((node) =>
                node.key === parentKey ? { ...node, hasChildren: false } : node)
            }
          }
          const collapsed = new Set(expandedRef.current)
          collapsed.delete(parentKey)
          expandedRef.current = collapsed
          setExpanded(collapsed)
        }
        levelsRef.current = next
        setLevels(next)
        return nodes
      } catch (cause) {
        if (gen === generation.current) setError((cause as Error)?.message || String(cause))
        return []
      } finally {
        setLoadingKeys((prev) => {
          const nextKeys = new Set(prev)
          nextKeys.delete(parentKey)
          return nextKeys
        })
        if (inflight.current.get(parentKey) === token.task) inflight.current.delete(parentKey)
      }
    })()
    token.task = task
    inflight.current.set(parentKey, task)
    return task
  }, [dataSource])

  useEffect(() => { void loadLevel(UNIFIED_TREE_ROOT_KEY) }, [loadLevel])

  const toggle = useCallback((key: string) => {
    setError(null)
    if (expandedRef.current.has(key)) {
      const collapsed = new Set(expandedRef.current)
      collapsed.delete(key)
      expandedRef.current = collapsed
      setExpanded(collapsed)
      return
    }
    const next = new Set(expandedRef.current)
    next.add(key)
    expandedRef.current = next
    setExpanded(next)
    if (!levelsRef.current[key]) void loadLevel(key)
  }, [loadLevel])

  const expandPath = useCallback(async (keys: string[]) => {
    const chain = keys.filter(Boolean)
    for (let i = 0; i < chain.length - 1; i += 1) {
      await loadLevel(chain[i])
      const next = new Set(expandedRef.current)
      next.add(chain[i])
      expandedRef.current = next
      setExpanded(next)
    }
  }, [loadLevel])

  const refresh = useCallback(() => {
    generation.current += 1
    inflight.current.clear()
    levelsRef.current = {}
    expandedRef.current = new Set()
    setLevels({})
    setExpanded(new Set())
    setLoadingKeys(new Set())
    setLoadCount(0)
    setError(null)
    void loadLevel(UNIFIED_TREE_ROOT_KEY)
  }, [loadLevel])

  const rows = useMemo(() => {
    const out: UnifiedTreeRow[] = []
    const visited = new Set<string>([UNIFIED_TREE_ROOT_KEY])
    const visit = (parentKey: string, depth: number) => {
      if (depth > 64 || visited.has(parentKey) && depth > 0) return
      if (depth > 0) visited.add(parentKey)
      for (const node of levels[parentKey] ?? []) {
        const isExpanded = expanded.has(node.key)
        out.push({
          node,
          depth,
          parentKey,
          expanded: isExpanded,
          loading: loadingKeys.has(node.key),
        })
        if (isExpanded && levels[node.key] && !visited.has(node.key)) visit(node.key, depth + 1)
      }
    }
    visit(UNIFIED_TREE_ROOT_KEY, 0)
    return out
  }, [levels, expanded, loadingKeys])

  return {
    rows,
    loadingRoot: loadingKeys.has(UNIFIED_TREE_ROOT_KEY) && !levels[UNIFIED_TREE_ROOT_KEY],
    loadCount,
    error,
    expandedKeys: useMemo(() => [...expanded], [expanded]),
    isExpanded: (key: string) => expanded.has(key),
    toggle,
    expandPath,
    refresh,
  }
}
