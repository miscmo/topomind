/**
 * 三边栏几何的 React / DOM 桥接层。
 *
 * 唯一真源是 domain/layout/workspaceGeometry.ts 的纯函数；本模块只负责三件事：
 *  1) 订阅 layout / leftDock / rightPanel 三个既有 store，不复制任何状态；
 *  2) 用 ResizeObserver 实测**活跃知识库标签页自己的** #app-layout 宽度，
 *     把几何结果写成该容器上的 CSS 变量（绝不能写 :root：多标签页常驻挂载会串库）；
 *  3) 提供 applyGeometryPatch()，让拖拽期间只改这些 CSS 变量、不写 store、不触发
 *     右栏编辑器整树重渲染；mouseup 才由面板把 desired 提交回各自的 store。
 *
 * 「desired / effective 分离」的关键：snapshot 里保存的是用户偏好，布局事件只会
 * 重新 computeGeometry，不回写偏好，因此左栏收起 / 窗口放大后右栏会恢复原宽度。
 */
import { useLayoutEffect, useMemo, useState } from 'react'
import { useLayoutStore } from '@/stores/layoutStore'
import { useNodeTreePanelStore } from '@/stores/nodeTreePanelStore'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import {
  computeGeometry,
  type GeometryInput,
  type WorkspaceGeometry,
} from '@/domain/layout/workspaceGeometry'

/** 每个 #app-layout 各自保存一份输入，供拖拽时的瞬时 patch 复用。 */
const SNAPSHOT = new WeakMap<HTMLElement, GeometryInput>()

/** 从边栏内的任意元素找到当前标签页的几何容器（不能用 getElementById，标签页有多个）。 */
export function resolveWorkspaceContainer(element: Element | null): HTMLElement | null {
  const found = element?.closest('#app-layout')
  return found instanceof HTMLElement ? found : null
}

/** 把几何结果一次性发布到容器上；所有边栏只消费这些变量，不再各自算宽。 */
export function writeGeometryVars(container: HTMLElement, input: GeometryInput): WorkspaceGeometry {
  const geometry = computeGeometry(input)
  const { style } = container
  style.setProperty('--tm-rail-width', `${geometry.railWidth}px`)
  style.setProperty('--tm-left-dock-width', `${geometry.leftWidth}px`)
  style.setProperty('--tm-workspace-left-boundary', `${geometry.boundary}px`)
  style.setProperty('--tm-right-panel-width', `${geometry.rightWidth}px`)
  style.setProperty('--tm-right-panel-left', `${geometry.rightLeft}px`)
  // 兼容既有状态抽屉让位规则；值改为完整左边界 B（含导航栏），不再三段叠加。
  style.setProperty('--tm-node-tree-offset', `${geometry.boundary}px`)
  SNAPSHOT.set(container, input)
  return geometry
}

/**
 * 拖拽期间的瞬时改宽：只重算并重写 CSS 变量，不写 store。
 * 返回新几何供手柄显示边界提示；容器尚无 snapshot 时返回 null（此时不拖也无害）。
 */
export function applyGeometryPatch(
  container: HTMLElement | null,
  patch: Partial<GeometryInput>,
): WorkspaceGeometry | null {
  if (!container) return null
  const base = SNAPSHOT.get(container)
  if (!base) return null
  return writeGeometryVars(container, { ...base, ...patch })
}

interface UseWorkspaceGeometryOptions {
  containerRef: { current: HTMLElement | null }
  /** 只有活跃标签页写 CSS 变量，避免常驻挂载的其它知识库互相覆盖。 */
  isActive: boolean
}

export function useWorkspaceGeometry({ containerRef, isActive }: UseWorkspaceGeometryOptions): WorkspaceGeometry {
  const railVisible = useLayoutStore((state) => state.railVisible)
  const leftCollapsed = useNodeTreePanelStore((state) => state.collapsed)
  const leftDesiredWidth = useNodeTreePanelStore((state) => state.leftDockWidth)
  const rightDesiredWidth = useRightPanelStore((state) => state.rightPanelWidth)
  const rightCollapsed = useRightPanelStore((state) => state.rightPanelCollapsed)
  const maximized = useRightPanelStore((state) => state.rightPanelMaximized)
  const [viewportWidth, setViewportWidth] = useState(0)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      const width = Math.round(container.getBoundingClientRect().width)
      setViewportWidth((previous) => (previous === width ? previous : width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef])

  const input = useMemo<GeometryInput>(() => ({
    viewportWidth,
    railVisible,
    leftOpen: !leftCollapsed,
    leftDesiredWidth,
    rightDesiredWidth,
    rightCollapsed,
    maximized,
  }), [viewportWidth, railVisible, leftCollapsed, leftDesiredWidth, rightDesiredWidth, rightCollapsed, maximized])

  useLayoutEffect(() => {
    if (!isActive) return
    const container = containerRef.current
    if (!container) return
    // 首帧 ResizeObserver 还没回调时用实测宽度兜底，避免右栏宽度为 0 闪一下。
    const effectiveInput = input.viewportWidth > 0
      ? input
      : { ...input, viewportWidth: Math.round(container.getBoundingClientRect().width) }
    writeGeometryVars(container, effectiveInput)
  }, [containerRef, input, isActive])

  return useMemo(() => computeGeometry(input), [input])
}
