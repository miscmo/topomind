import { Link2 } from 'lucide-react'
import { createReactInlineContentSpec } from '@blocknote/react'
import { Extension, InputRule } from '@tiptap/core'
import {
  DOC_LINK_INLINE_TYPE,
  DOC_LINK_TRIGGER_PATTERN,
  normalizeDocumentLinkTitle,
} from './docLinkModel'
import { readCaretRect, requestDocumentLinkPicker, requestOpenDocumentLink } from './docLinkBridge'

/** createReactInlineContentSpec 的 render props 只声明本组件实际用到的字段。 */
interface DocumentLinkRenderProps {
  inlineContent: {
    props: {
      docId?: string
      title?: string
    }
  }
  contentRef: (node: HTMLElement | null) => void
}

function DocumentLinkRenderer(props: DocumentLinkRenderProps) {
  const docId = props.inlineContent.props.docId || ''
  const title = normalizeDocumentLinkTitle(props.inlineContent.props.title)

  return (
    // 用回调 ref 而不是直接 ref={props.contentRef}：后者会被 React 19 的
    // react-hooks/refs 规则当成「渲染期读 ref」，也是 InlineMath 采用的写法。
    <span ref={(node) => { props.contentRef(node) }} className="tm-doc-link-shell">
      <span
        className="tm-doc-link-chip"
        data-doc-id={docId}
        title={docId ? `打开文档：${title}` : '引用缺少文档标识'}
        onMouseDownCapture={(event) => {
          if (!docId) return
          // 与行内公式同样的捕获阶段拦截：ProseMirror 的监听挂在编辑器根节点上，
          // 冒泡阶段到 React 时它已经改过选区 / 重建过节点视图。
          event.preventDefault()
          event.stopPropagation()
          requestOpenDocumentLink({ docId, title })
        }}
      >
        <Link2 size={13} strokeWidth={2} aria-hidden="true" />
        <span className="tm-doc-link-chip__title">{title}</span>
      </span>
    </span>
  )
}

/** 复制到外部时只保留纯文本 chip，不把编辑器里的 SVG 图标带出去。 */
function DocumentLinkExternalRenderer(props: DocumentLinkRenderProps) {
  return (
    <span ref={(node) => { props.contentRef(node) }} className="tm-doc-link-external">
      {normalizeDocumentLinkTitle(props.inlineContent.props.title)}
    </span>
  )
}

/**
 * 文档双链的行内 chip。propSchema 只存稳定 docId + 显示快照 title，
 * 不存 cardRef：目标文档移动 / 重命名后由 resolveDocumentById 全库自愈。
 * content:'none' 表示原子节点，光标不能进入 chip 内部。
 */
export const DocumentLink = createReactInlineContentSpec(
  {
    type: DOC_LINK_INLINE_TYPE,
    propSchema: {
      docId: { default: '' },
      title: { default: '未命名文档' },
    },
    content: 'none',
  },
  {
    render: DocumentLinkRenderer,
    toExternalHTML: DocumentLinkExternalRenderer,
  },
)

/**
 * `[[` 触发文档选择器。
 *
 * 不用 BlockNote 的 SuggestionMenuController：0.51.x 的多字符 trigger 用
 * `textBetween(from - triggerChar.length, from) + text` 判断，对 `[[` 在块中间
 * 会多取一个字符而漏命中。改为项目已有的 ProseMirror InputRule 范式，命中后
 * 只删掉刚输入的两个 `[`，等事务提交后再弹出 React 浮层，光标停在触发点，
 * 选中文档时直接 insertInlineContent 即可落在正确位置。
 */
export const docLinkInputRuleExtension = Extension.create({
  name: 'topomind-doc-link-input',
  addInputRules() {
    return [
      new InputRule({
        find: DOC_LINK_TRIGGER_PATTERN,
        handler: ({ state, range }) => {
          state.tr.delete(range.from, range.to)
          // 事务此刻还没分发，等它落定后再读 DOM 选区，否则拿到的是含 `[[` 的旧矩形。
          queueMicrotask(() => {
            requestDocumentLinkPicker({ rect: readCaretRect(), source: 'input-rule' })
          })
        },
      }),
    ]
  },
})
