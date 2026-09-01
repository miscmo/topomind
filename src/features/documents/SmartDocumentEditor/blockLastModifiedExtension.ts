import { createExtension, getBlockInfoWithManualOffset } from '@blocknote/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * 块「最后修改时间」——只负责**记录**，不负责展示。
 *
 * 存储：块属性（BlockNote 的 block props 落在块内容节点上），随文档持久化，块删除即消失。
 * 展示：由编辑器底部状态栏读取「当前选中块」的属性来渲染（见 DocumentStatusBar），
 *       因此代码块 / 图片块 / 分栏等任何块类型都能一致地显示，不再依赖块内布局。
 *
 * 值为 epoch 毫秒；0 表示从未记录（本功能上线前创建的块）。
 */

const blockLastModifiedPluginKey = new PluginKey('topomind-block-last-modified')

/** IME 输入法组合（拼音）进行中的标记：组合时跳过时间戳写入，避免改动块 DOM 打断中文输入。 */
let isComposing = false

/** 一个块中承载 props 的节点（时间戳读写的目标） */
type PropsNodeTarget = {
  /** props 节点在文档中的起始位置 */
  pos: number
  node: PMNode
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
    return { pos: propsNode.beforePos, node: propsNode.node }
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

export const blockLastModifiedExtension = createExtension(({ editor }) => ({
  key: 'topomind-block-last-modified',
  prosemirrorPlugins: [
    new Plugin({
      key: blockLastModifiedPluginKey,
      props: {
        handleDOMEvents: {
          // 输入法组合开始/结束：标记 isComposing，供 appendTransaction 跳过时间戳写入
          compositionstart: () => {
            isComposing = true
            return false
          },
          compositionend: () => {
            isComposing = false
            return false
          },
        },
      },
      appendTransaction(transactions, _oldState, newState) {
        if (!editor.isEditable) {
          return null
        }
        // IME 输入法组合（拼音）进行中时不要写时间戳：此刻对块节点执行 setNodeMarkup 会改动
        // 块容器 DOM，打断正在进行的拼音组合，导致中文没法正常上屏。组合结束后的提交事务
        // （isComposing 已为 false）会照常写入时间戳，不丢失。
        if (isComposing) {
          return null
        }
        if (!transactions.some((tr) => tr.docChanged)) {
          return null
        }
        // 自己产生的时间戳 transaction 不再处理，避免无限递归
        if (transactions.some((tr) => tr.getMeta(blockLastModifiedPluginKey))) {
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

        if (targets.size === 0) {
          return null
        }

        const now = Date.now()
        const nextTr = newState.tr
        let changed = false
        // 降序应用，避免 setNodeMarkup 之间互相影响定位
        Array.from(targets.values())
          .sort((a, b) => b.pos - a.pos)
          .forEach((target) => {
            const node = nextTr.doc.nodeAt(target.pos)
            if (!node) {
              return
            }
            // 防御：仅当该节点类型在编辑器 schema 的 propSchema 中确实含 lastModified 时才写入，
            // 避免把 lastModified 写进 propSchema 不含它的节点（如 column/columnList），导致渲染时
            // props 与 propSchema 不一致而崩编辑器。
            const spec = (editor.schema.blockSpecs as any)?.[node.type.name]
            if (!spec?.config?.propSchema?.lastModified) {
              return
            }
            if (node.attrs.lastModified === now) {
              return
            }
            nextTr.setNodeMarkup(target.pos, undefined, { ...node.attrs, lastModified: now })
            changed = true
          })

        if (!changed) {
          return null
        }

        // 时间戳属于元数据：不进撤销栈，否则撤销时会被单独回滚、打断内容撤销
        nextTr.setMeta('addToHistory', false)
        nextTr.setMeta(blockLastModifiedPluginKey, { skip: true })
        return nextTr
      },
    }),
  ],
}))
