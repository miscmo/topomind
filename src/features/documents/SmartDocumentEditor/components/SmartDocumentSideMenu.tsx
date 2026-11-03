import { AddBlockButton, SideMenu, type SideMenuProps, useBlockNoteEditor, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SmartDocumentBlockMenu } from './SmartDocumentBlockMenu'
import { SmartDocumentDragHandleButton } from './SmartDocumentDragHandleButton'

export function SmartDocumentDragHandleMenu({ children }: { children?: React.ReactNode }) {
  return <SmartDocumentBlockMenu mode="edit">{children}</SmartDocumentBlockMenu>
}

// 块编辑按钮（＋ / ⠿）与正文开头之间的水平缓冲。编辑器自身有 54px 左内边距
// （侧边菜单就活在这条槽里），但原本 hit-area 对顶层块只算了嵌套缩进
// blockIndent（顶层块为 0），导致按钮紧贴文本左缘，鼠标想在开头插入时极易误触。
// 这里补一个固定 gap，把按钮整体往槽里推远，留出安全的点击空白区。
const SIDE_MENU_TEXT_GAP = 10

type HeadingGapCategory = { top: 'zero' | 'tight' | 'normal'; bottom: 'tight' | 'normal' }

/** 只用到 id / type，收窄成最小形状即可，不必牵扯 schema 泛型。 */
type HeadingGapBlockLike = { id?: string; type?: string }

/** 标题上下留白在「首块 / 连续标题」时会收紧（见 SmartDocumentEditor.css）。
    返回分类，供侧栏同步自己的留白；非标题块返回 undefined。 */
function getHeadingGapCategory(
  editor: { document: readonly HeadingGapBlockLike[] },
  block: HeadingGapBlockLike,
): HeadingGapCategory | undefined {
  if (block.type !== 'heading') return undefined
  const doc = editor.document
  const index = doc.findIndex((item) => item.id === block.id)
  if (index < 0) return { top: 'normal', bottom: 'normal' }
  const isHeading = (item: HeadingGapBlockLike | undefined) => item?.type === 'heading'
  return {
    top: index === 0 ? 'zero' : isHeading(doc[index - 1]) ? 'tight' : 'normal',
    bottom: isHeading(doc[index + 1]) ? 'tight' : 'normal',
  }
}

export function SmartDocumentSideMenu(props: SideMenuProps) {
  const editor = useBlockNoteEditor<any, any, any>()
  const sideMenuState = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state ? {
      block: state.block,
      referenceX: state.referencePos.x,
    } : undefined,
  })
  const block = sideMenuState?.block
  const blockElement = block
    ? editor.domElement?.querySelector<HTMLElement>(
      `[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"]`,
    )
    : undefined
  const blockIndent = blockElement && sideMenuState
    ? Math.max(0, blockElement.getBoundingClientRect().x - sideMenuState.referenceX)
    : 0
  const isEmptyBlock = Array.isArray(block?.content) && block.content.length === 0

  if (!block) {
    return null
  }

  // 侧栏是浮层，不在块的 DOM 子树里，继承不到 .bn-block-outer 上的标题间距倍数，
  // 所以在组件侧判断场景、只给出**分类**，具体倍数仍由 CSS 定义（避免数值两处写）。
  const headingGap = getHeadingGapCategory(editor, block)

  return (
    <div
      className="tm-smart-side-menu-hit-area"
      data-smart-document-side-menu
      data-tm-gap-top={headingGap?.top}
      data-tm-gap-bottom={headingGap?.bottom}
      style={{ paddingRight: `${blockIndent + SIDE_MENU_TEXT_GAP}px` }}
    >
      <SideMenu {...props}>
        {isEmptyBlock ? <AddBlockButton /> : null}
        <SmartDocumentDragHandleButton {...props} dragHandleMenu={SmartDocumentDragHandleMenu} />
      </SideMenu>
    </div>
  )
}
