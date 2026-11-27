/**
 * 缩放语义桥（**无界面、无交互**）。
 *
 * 画布上方的缩放比例滑动条已按需求下线；但 GUI 回归的 LOD / 只读 / 紧凑镜头
 * 阶段需要把镜头精确落在 5% / 20% / 40% 等档位，滚轮一格一格逼近做不到。
 * 这里只把 React Flow 的 zoomTo 暴露成画布根容器上的一个 DOM property，
 * 沿用项目「语义数据给回归直读」的既有做法（同 data-tm-canvas-zoom-percent）。
 *
 * 产品侧不消费这个 property：日常缩放仍只有滚轮，回到 100% 仍只有只读提示条的
 * 恢复按钮。桥本身不渲染任何节点，也不新增任何可见控件。
 */
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { fromDisplayPercent } from '../../../../domain/graph/zoomScale'

type ZoomHost = HTMLElement & { __tmZoomTo?: (percent: number) => void }

export default function CanvasZoomBridge({
  hostRef,
}: {
  hostRef: RefObject<HTMLDivElement | null>
}) {
  const reactFlow = useReactFlow()

  useEffect(() => {
    const host = hostRef.current as ZoomHost | null
    if (!host) return
    host.__tmZoomTo = (percent) => {
      void reactFlow.zoomTo(fromDisplayPercent(percent), { duration: 0 })
    }
    return () => { delete host.__tmZoomTo }
  }, [reactFlow, hostRef])

  return null
}
