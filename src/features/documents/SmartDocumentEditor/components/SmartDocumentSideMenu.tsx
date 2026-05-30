import { AiOutlinePlus } from 'react-icons/ai'
import { DragHandleButton, SideMenu, useBlockNoteEditor, useComponentsContext, useExtension, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SmartDocumentBlockMenu } from './SmartDocumentBlockMenu'

export function SmartDocumentDragHandleMenu({ children }: { children?: React.ReactNode }) {
  return <SmartDocumentBlockMenu mode="edit">{children}</SmartDocumentBlockMenu>
}

export function SmartDocumentAddBlockButton() {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })

  if (!Components || !block) return null

  return (
    <Components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        if (open) {
          sideMenu.freezeMenu()
        } else {
          sideMenu.unfreezeMenu()
        }
      }}
      position="left"
    >
      <Components.Generic.Menu.Trigger>
        <Components.SideMenu.Button
          className="bn-button"
          label="添加块"
          icon={<AiOutlinePlus size={24} data-test="dragHandleAdd" />}
        />
      </Components.Generic.Menu.Trigger>
      <SmartDocumentBlockMenu mode="insert" />
    </Components.Generic.Menu.Root>
  )
}

export function SmartDocumentSideMenu() {
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
    <SideMenu>
      {isEmptyBlock ? <SmartDocumentAddBlockButton /> : <DragHandleButton dragHandleMenu={SmartDocumentDragHandleMenu} />}
    </SideMenu>
  )
}
