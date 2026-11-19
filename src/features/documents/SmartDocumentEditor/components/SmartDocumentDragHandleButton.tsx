import { type ComponentType, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { Menu as MantineMenu } from '@mantine/core'
import {
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
  DragHandleMenu,
  type SideMenuProps,
} from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { useSmartBlockNoteEditor } from '../smartDocumentEditorTypes'

// 复刻 BlockNote 的 DragHandleButton，但用自定义的 <MantineMenu> 包裹，以便覆盖
// BlockNote 在 @blocknote/mantine/src/menu/Menu.tsx 里写死的 middlewares
// （shift:true 只在主轴位移、且未设 padding）。
//
// 根因与修复：
// - 原版 position="left"：菜单在块按钮【左侧】、垂直居中于按钮，这正是用户期望的
//   布局。但顶部块的按钮紧贴 32px 高的窗口标题栏，菜单垂直居中后上沿顶出视口、
//   钻进标题栏区域被遮挡。
// - BlockNote 的 shift 默认不处理垂直方向（crossAxis=false），且 shift 的边界是视口
//   而非标题栏 DOM，所以单纯提 z-index 只能让菜单"盖在标题栏上"，物理位置仍偏高。
// - 这里改回 position="left"（恢复左侧布局），shift 开启 crossAxis 并把边界设为
//   编辑器的滚动容器：菜单整体被夹在正文区域内，顶部块时下推到「标题编号」工具栏之下，
//   底部块时上推到状态栏之上；其余块远离边缘，shift 不触发，保持原垂直居中效果。
export function SmartDocumentDragHandleButton(
  props: SideMenuProps & { children?: ReactNode },
) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const sideMenu = useExtension(SideMenuExtension)
  const editor = useSmartBlockNoteEditor()
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  })

  if (block === undefined) {
    return null
  }

  const DragHandleMenuComponent: ComponentType<{ children?: ReactNode }> =
    (props as { dragHandleMenu?: ComponentType<{ children?: ReactNode }> }).dragHandleMenu ??
    DragHandleMenu

  // 边界取编辑器滚动容器而不是视口：菜单再高也不压工具栏 / 状态栏。
  const scrollerBoundary = editor.domElement?.closest('.tm-smart-editor-scroll') ?? undefined

  return (
    <MantineMenu
      withinPortal={false}
      position={'left'}
      onChange={(open: boolean) => {
        if (open) {
          sideMenu.freezeMenu()
        } else {
          sideMenu.unfreezeMenu()
        }
      }}
      middlewares={{
        flip: { boundary: scrollerBoundary, padding: 8 },
        shift: { crossAxis: true, boundary: scrollerBoundary, padding: 8 },
        inline: false,
        size: true,
      }}
      returnFocus={false}
    >
      <MantineMenu.Target>
        <Components.SideMenu.Button
          label={dict.side_menu.drag_handle_label}
          draggable={true}
          onDragStart={(e) => sideMenu.blockDragStart(e, block)}
          onDragEnd={sideMenu.blockDragEnd}
          className={'bn-button'}
          icon={<GripVertical size={24} data-test="dragHandle" />}
        />
      </MantineMenu.Target>
      <DragHandleMenuComponent>{props.children}</DragHandleMenuComponent>
    </MantineMenu>
  )
}
