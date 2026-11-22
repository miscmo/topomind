import type { CSSProperties } from 'react'
import { useStore } from '@xyflow/react'
import type { GuideLine } from './useSmartGuides'

/**
 * 参考线画在**不缩放的屏幕层**：位置按 transform 逐点换算成屏幕坐标，
 * 线宽因此恒为 1 CSS px（旧版整层 scale(zoom) 会让线在远景细到看不见）。
 * 中心对齐用虚线、同侧边对齐用实线，两者语义不再混在同一条线里。
 */
export function SmartGuidesRenderer({ guideLines }: { guideLines: GuideLine[] }) {
  const transform = useStore((s) => s.transform)

  if (guideLines.length === 0) return null

  const [tx, ty, zoom] = transform

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {guideLines.map((guide) => {
        const isVertical = guide.type === 'vertical'
        const isCenter = guide.kind === 'center'
        const common: CSSProperties = {
          position: 'absolute',
          opacity: isCenter ? 0.9 : 0.6,
        }
        if (isVertical) {
          return (
            <div
              key={guide.id}
              style={{
                ...common,
                left: tx + guide.position * zoom,
                top: ty + guide.start * zoom,
                height: (guide.end - guide.start) * zoom,
                width: isCenter ? 0 : 1,
                ...(isCenter
                  ? { borderLeft: '1px dashed var(--color-accent)' }
                  : { backgroundColor: 'var(--color-accent)' }),
              }}
            />
          )
        }
        return (
          <div
            key={guide.id}
            style={{
              ...common,
              top: ty + guide.position * zoom,
              left: tx + guide.start * zoom,
              width: (guide.end - guide.start) * zoom,
              height: isCenter ? 0 : 1,
              ...(isCenter
                ? { borderTop: '1px dashed var(--color-accent)' }
                : { backgroundColor: 'var(--color-accent)' }),
            }}
          />
        )
      })}
    </div>
  )
}
