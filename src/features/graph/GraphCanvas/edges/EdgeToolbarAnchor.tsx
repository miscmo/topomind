import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { computeEdgeToolbarPlacement, type EdgeToolbarPoint } from './edgeToolbarPlacement'

interface EdgeToolbarAnchorProps {
  /** 连线 label 中点（flow 坐标） */
  labelX: number
  labelY: number
  /** 两端锚点手柄的位置（flow 坐标），用于避让 */
  anchors: EdgeToolbarPoint[]
  /** 拖动锚点时让工具栏淡出让位，避免浮层挡住拖动视线 */
  faded: boolean
  children: ReactNode
}

/** 首帧尚未测量时的估计尺寸，useLayoutEffect 会在绘制前用真实尺寸覆盖 */
const FALLBACK_WIDTH = 96
const FALLBACK_HEIGHT = 44

/**
 * 选中连线的快捷工具栏外壳。
 *
 * 默认居中在连线中点上方；一旦与任一端点手柄重叠，就自动换到不挡手柄的一侧
 * （上 → 下 → 左 → 右 → 各向外一档）。位置变化带 140ms 过渡，切换方向时不会瞬移。
 *
 * 分两层是为了分开两条动画：外层跟连线中点是即时的（拖节点时不滞后），
 * 内层只负责避让偏移，才需要过渡。
 */
export default function EdgeToolbarAnchor({
  labelX,
  labelY,
  anchors,
  faded,
  children,
}: EdgeToolbarAnchorProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT })

  useLayoutEffect(() => {
    const element = boxRef.current
    if (!element) return
    const sync = () => {
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (width <= 0 || height <= 0) return
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    sync()
    // 复位按钮出现/消失会改变工具栏宽度，这里跟着重算避让位置
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const placement = computeEdgeToolbarPlacement({
    origin: { x: labelX, y: labelY },
    anchors,
    width: size.width,
    height: size.height,
  })

  return (
    <div
      data-edge-toolbar-anchor=""
      style={{
        position: 'absolute',
        transform: `translate(${labelX}px, ${labelY}px)`,
        // 与锚点手柄（z-index 11）同在 EdgeLabelRenderer 内：工具栏略低一层，
        // 极端重叠时手柄依然能抓到指针
        zIndex: 10,
      }}
    >
      <div
        ref={boxRef}
        data-edge-toolbar-box=""
        className="nodrag nopan"
        style={{
          transform: `translate(-50%, -50%) translate(${placement.x}px, ${placement.y}px)`,
          transition: 'transform 140ms ease, opacity 140ms ease',
          opacity: faded ? 0 : 1,
          pointerEvents: faded ? 'none' : 'all',
        }}
      >
        {children}
      </div>
    </div>
  )
}
