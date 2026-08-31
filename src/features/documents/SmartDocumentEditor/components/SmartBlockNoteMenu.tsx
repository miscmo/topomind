import { type ReactNode } from 'react'
import { Menu as MantineMenu, type MenuProps } from '@mantine/core'

// 复刻 @blocknote/mantine 的 Menu 子菜单（sub）包装，但把 transitionProps 的 exitDelay
// 从 250 改为 0：修复块编辑菜单中相邻两组子菜单（如“缩进和对齐”与“颜色”）hover 切换时，
// 上一个子菜单仍在 250ms 淡出动画中、下一个已出现，导致两个子菜单同时可见的问题。
// 预期表现：鼠标离开上一项时上一项立即关闭，再进入下一项才打开下一项。
// 注：@blocknote/mantine 的 Menu.tsx 用 assertEmpty(rest) 禁止从外部覆盖 transitionProps，
// 因此只能在此复制其 Sub 分支逻辑并调整。

export function SmartSubMenu({
  children,
  position,
  onOpenChange,
}: {
  children?: ReactNode
  position?: MenuProps['position']
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <MantineMenu.Sub
      transitionProps={{ duration: 150, exitDelay: 0 }}
      withinPortal={false}
      middlewares={{ flip: true, shift: true, inline: false, size: true }}
      onChange={onOpenChange}
      position={position}
    >
      {children}
    </MantineMenu.Sub>
  )
}

export function SmartSubMenuTrigger({ children }: { children?: ReactNode }) {
  return <MantineMenu.Sub.Target>{children}</MantineMenu.Sub.Target>
}

export function SmartSubMenuDropdown({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <MantineMenu.Sub.Dropdown className={className}>{children}</MantineMenu.Sub.Dropdown>
  )
}
