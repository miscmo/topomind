import { type ReactNode } from 'react'
import { Menu as MantineMenu, type MenuProps } from '@mantine/core'
import { TM_MOTION } from '../../../../shared/ui/motion'

// 复刻 @blocknote/mantine 的 Menu 子菜单（sub）包装，但把 transitionProps 的 exitDelay
// 从 250 改为 0：修复块编辑菜单中相邻两组子菜单（如“颜色”与“插入块”）hover 切换时，
// 上一个子菜单仍在 250ms 淡出动画中、下一个已出现，导致两个子菜单同时可见的问题。
// 预期表现：鼠标离开上一项时上一项立即关闭，再进入下一项才打开下一项。
// 时长 / 曲线统一取 TM_MOTION，与项目其它浮层的 .tm-popover-enter 对齐；
// 这里不叠加 CSS animation —— Mantine 浮层自身用 transform 定位，外加 transform
// 动画会覆盖定位，表现为「从屏幕左上角飘出来」。
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
      transitionProps={{
        duration: TM_MOTION.durationMs,
        exitDuration: TM_MOTION.exitDurationMs,
        exitDelay: 0,
        timingFunction: TM_MOTION.easing,
      }}
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
