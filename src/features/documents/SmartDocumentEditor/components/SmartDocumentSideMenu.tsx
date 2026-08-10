import { AddBlockButton, DragHandleButton, SideMenu, type SideMenuProps, useBlockNoteEditor, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SmartDocumentBlockMenu } from './SmartDocumentBlockMenu'

export function SmartDocumentDragHandleMenu({ children }: { children?: React.ReactNode }) {
  return <SmartDocumentBlockMenu mode="edit">{children}</SmartDocumentBlockMenu>
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

  return (
    <div
      className="tm-smart-side-menu-hit-area"
      data-smart-document-side-menu
      style={{ paddingRight: `${blockIndent}px` }}
    >
      <SideMenu {...props}>
        {isEmptyBlock ? <AddBlockButton /> : null}
        <DragHandleButton {...props} dragHandleMenu={SmartDocumentDragHandleMenu} />
      </SideMenu>
    </div>
  )
}
