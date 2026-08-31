import { type ComponentType, type ReactNode } from 'react'
import { MdDragIndicator } from 'react-icons/md'
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
// - 这里改回 position="left"（恢复左侧布局），并显式开启 shift 的 crossAxis +
//   padding:44：让浮动层在垂直方向也做位移、且始终与视口上/下边缘保持 44px 余量
//   （> 标题栏 32px），从而把顶部块的菜单整体下推到标题栏之下；其余块的菜单因本就
//   远离顶部，shift 不触发，保持原垂直居中效果。
export function SmartDocumentDragHandleButton(
  props: SideMenuProps & { children?: ReactNode },
) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  })

  if (block === undefined) {
    return null
  }

  const DragHandleMenuComponent: ComponentType<{ children?: ReactNode }> =
    (props as { dragHandleMenu?: ComponentType<{ children?: ReactNode }> }).dragHandleMenu ??
    DragHandleMenu

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
        flip: true,
        shift: { crossAxis: true, padding: 44 },
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
          icon={<MdDragIndicator size={24} data-test="dragHandle" />}
        />
      </MantineMenu.Target>
      <DragHandleMenuComponent>{props.children}</DragHandleMenuComponent>
    </MantineMenu>
  )
}
