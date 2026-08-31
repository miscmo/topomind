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

  return (
    <div
      className="tm-smart-side-menu-hit-area"
      data-smart-document-side-menu
      style={{ paddingRight: `${blockIndent + SIDE_MENU_TEXT_GAP}px` }}
    >
      <SideMenu {...props}>
        {isEmptyBlock ? <AddBlockButton /> : null}
        <SmartDocumentDragHandleButton {...props} dragHandleMenu={SmartDocumentDragHandleMenu} />
      </SideMenu>
    </div>
  )
}
