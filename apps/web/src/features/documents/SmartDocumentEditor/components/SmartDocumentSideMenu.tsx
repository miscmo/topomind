import { AddBlockButton, DragHandleButton, SideMenu, type SideMenuProps, useBlockNoteEditor, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SmartDocumentBlockMenu } from './SmartDocumentBlockMenu'

export function SmartDocumentDragHandleMenu({ children }: { children?: React.ReactNode }) {
  return <SmartDocumentBlockMenu mode="edit">{children}</SmartDocumentBlockMenu>
}

export function SmartDocumentSideMenu(props: SideMenuProps) {
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const isEmptyBlock = Array.isArray(block?.content) && block.content.length === 0

  if (!block) {
    return null
  }

  return (
    <SideMenu {...props}>
      {isEmptyBlock ? <AddBlockButton /> : <DragHandleButton {...props} dragHandleMenu={SmartDocumentDragHandleMenu} />}
    </SideMenu>
  )
}
