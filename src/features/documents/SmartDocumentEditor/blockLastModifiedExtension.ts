import { createExtension, getBlockInfoWithManualOffset } from '@blocknote/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * 块「最后修改时间」——只负责**记录**，不负责展示。
 *
 * 存储：块属性（BlockNote 的 block props 落在块内容节点上），随文档持久化，块删除即消失。
 * 展示：由编辑器底部状态栏读取「当前选中块」的属性来渲染（见 DocumentStatusBar），
 *       因此代码块 / 图片块 / 分栏等任何块类型都能一致地显示，不再依赖块内布局。
 *
 * 值为 epoch 毫秒；0 表示从未记录（本功能上线前创建的块）。
 *
 * ⚠️ 写入时机：绝不能在用户输入过程中同步写入。
 *    写入需要 `setNodeMarkup` 修改块属性，它会用 ReplaceStep 替换块内容节点，并触发
 *    BlockNote 重建该块的 nodeView DOM。若每敲一个字符就重建一次，会偶发打断浏览器的
 *    连续输入状态和光标，导致 markdown 输入规则（如输入 "- " 自动转列表）匹配失败，
 *    表现为「有时候不生效」。Tiptap 的 input rule 在 `view.composing` 为真时也会直接
 *    跳过（见 @tiptap/core 的 run()），二者叠加使问题更隐蔽。
 *
 *    因此这里改为：**打字过程中只把脏块 id 记进 pending 集合，完全不改动文档**；
 *    停止输入 FLUSH_DELAY 毫秒后（或失焦、组件卸载时）再统一批量写入一次。
 */

const blockLastModifiedPluginKey = new PluginKey('topomind-block-last-modified')

/** 停止输入后多久统一写入时间戳（毫秒）。 */
const FLUSH_DELAY = 1000

/** IME 输入法组合（拼音）进行中的标记：组合中不写时间戳，避免改动块 DOM 打断中文输入。 */
let isComposing = false

/** 一个块中承载 props 的节点（时间戳读写的目标） */
type PropsNodeTarget = {
  /** props 节点在文档中的起始位置 */
  pos: number
  node: PMNode
  /** 所属块的 id（blockContainer 属性）。延迟写入时靠它在最新文档里重新定位块。 */
  blockId: string | null
}

/**
 * 解析一个块节点中承载 props 的节点。
 * blockContainer 只有 id，属性在其 blockContent 子节点上；
 * column / columnList 这类容器块没有 lastModified 属性，返回 null 以跳过。
 */
function resolvePropsNode(node: PMNode, pos: number): PropsNodeTarget | null {
  try {
    const info = getBlockInfoWithManualOffset(node, pos)
    const propsNode = info.isBlockContainer ? info.blockContent : info.bnBlock
    if (!propsNode || !('lastModified' in propsNode.node.attrs)) {
      return null
    }
    const rawId = (info.bnBlock.node.attrs as Record<string, unknown>).id
    return {
      pos: propsNode.beforePos,
      node: propsNode.node,
      blockId: typeof rawId === 'string' ? rawId : null,
    }
  } catch {
    // 结构异常的节点直接跳过，不影响编辑
    return null
  }
}

/**
 * 收集与 [from, to] 相交的块。
 * 父子块会同时命中（范围包含子块时），只保留最内层——
 * 编辑子块不该顺带刷新父块的时间戳。
 */
function collectBlocksInRange(doc: PMNode, from: number, to: number): PropsNodeTarget[] {
  const candidates: { start: number; end: number; target: PropsNodeTarget }[] = []

  doc.descendants((node, pos) => {
    if (!node.type.isInGroup('bnBlock')) {
      return true
    }
    const end = pos + node.nodeSize
    if (end >= from && pos <= to) {
      const target = resolvePropsNode(node, pos)
      if (target) {
        candidates.push({ start: pos, end, target })
      }
    }
    return true
  })

  return candidates
    .filter(
      (candidate) =>
        !candidates.some(
          (other) => other !== candidate && other.start >= candidate.start && other.end <= candidate.end,
        ),
    )
    .map((candidate) => candidate.target)
}

export const blockLastModifiedExtension = createExtension(({ editor }) => {
  /** 等待写入时间戳的块 id */
  const pendingBlockIds = new Set<string>()
  let pmView: EditorView | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function scheduleFlush(delay: number = FLUSH_DELAY) {
    clearTimer()
    flushTimer = setTimeout(() => {
      flushTimer = null
      flush()
    }, delay)
  }

  /** 把 pending 的块统一写入一次当前时间戳。 */
  function flush() {
    clearTimer()
    if (pendingBlockIds.size === 0 || !pmView) {
      return
    }
    // 组合输入进行中：推迟到组合结束后再写，避免打断中文输入
    if (isComposing) {
      scheduleFlush()
      return
    }
    // 变为只读时丢弃待写入项，避免反复重试
    if (!editor.isEditable) {
      pendingBlockIds.clear()
      return
    }

    const view = pmView
    const now = Date.now()
    const targets = collectBlocksInRange(view.state.doc, 0, view.state.doc.content.size)
      .filter((target) => target.blockId !== null && pendingBlockIds.has(target.blockId))
      .sort((a, b) => b.pos - a.pos)

    // 块可能已被删除，直接清空，未命中的不再重试
    pendingBlockIds.clear()
    if (targets.length === 0) {
      return
    }

    const tr = view.state.tr
    let changed = false
    for (const target of targets) {
      const node = tr.doc.nodeAt(target.pos)
      if (!node) {
        continue
      }
      // 防御：仅当该节点类型在编辑器 schema 的 propSchema 中确实含 lastModified 时才写入，
      // 避免把 lastModified 写进 propSchema 不含它的节点（如 column/columnList），导致渲染时
      // props 与 propSchema 不一致而崩编辑器。
      const spec = (editor.schema.blockSpecs as any)?.[node.type.name]
      if (!spec?.config?.propSchema?.lastModified) {
        continue
      }
      if (node.attrs.lastModified === now) {
        continue
      }
      tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, lastModified: now })
      changed = true
    }

    if (!changed) {
      return
    }

    // 时间戳属于元数据：不进撤销栈，否则撤销时会被单独回滚、打断内容撤销
    tr.setMeta('addToHistory', false)
    // 标记为自己产生的事务，appendTransaction 不再重复收集，避免无限循环
    tr.setMeta(blockLastModifiedPluginKey, { skip: true })
    view.dispatch(tr)
  }

  return {
    key: 'topomind-block-last-modified',
    prosemirrorPlugins: [
      new Plugin({
        key: blockLastModifiedPluginKey,
        view(editorView) {
          pmView = editorView
          return {
            destroy() {
              try {
                // 卸载前尽力把待写入的时间戳落盘
                flush()
              } catch {
                // 视图正在销毁，忽略
              }
              clearTimer()
              pmView = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            // 输入法组合开始/结束：标记 isComposing，供 flush 推迟时间戳写入
            compositionstart: () => {
              isComposing = true
              return false
            },
            compositionend: () => {
              isComposing = false
              scheduleFlush()
              return false
            },
            // 失焦时立刻写入，避免用户直接切走/关闭导致时间戳丢失
            blur: () => {
              scheduleFlush(0)
              return false
            },
          },
        },
        appendTransaction(transactions, _oldState, newState) {
          if (!editor.isEditable) {
            return null
          }
          // 自己产生的时间戳事务不再处理，避免无限递归
          if (transactions.some((tr) => tr.getMeta(blockLastModifiedPluginKey))) {
            return null
          }
          if (!transactions.some((tr) => tr.docChanged)) {
            return null
          }

          const targets = new Map<number, PropsNodeTarget>()
          for (const tr of transactions) {
            if (!tr.docChanged) {
              continue
            }
            tr.steps.forEach((step, index) => {
              // 后续 step 会再次改变位置，需要把范围映射到最终文档
              const rest = tr.mapping.slice(index + 1)
              step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                const from = rest.map(newStart, -1)
                const to = rest.map(newEnd, 1)
                collectBlocksInRange(newState.doc, from, to).forEach((target) => {
                  targets.set(target.pos, target)
                })
              })
            })
          }

          let hasPending = false
          for (const target of targets.values()) {
            if (target.blockId) {
              pendingBlockIds.add(target.blockId)
              hasPending = true
            }
          }

          if (hasPending) {
            scheduleFlush()
          }

          // 关键：输入过程中绝不改动文档，交给 flush 在停止输入后统一写入，
          // 避免 setNodeMarkup 重建块 DOM 打断连续输入与 markdown 输入规则。
          return null
        },
      }),
    ],
  }
})
