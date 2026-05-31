import { useStore } from '@xyflow/react'
import type { GuideLine } from './useSmartGuides'

export function SmartGuidesRenderer({ guideLines }: { guideLines: GuideLine[] }) {
  const transform = useStore((s) => s.transform)
  
  if (guideLines.length === 0) return null

  // 更加现代、协调的主题色：科技蓝（与应用的选中框和主要控件颜色相呼应）
  const guideColor = 'rgba(59, 130, 246, 0.65)' // #3b82f6 with 65% opacity
  const shadowColor = 'rgba(59, 130, 246, 0.2)'

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
        transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})`, 
        transformOrigin: '0 0' 
      }}
    >
      {guideLines.map(g => {
        if (g.type === 'vertical') {
          return (
            <div 
              key={g.id} 
              style={{ 
                position: 'absolute', 
                left: g.position, 
                top: g.start, 
                height: g.end - g.start, 
                width: 1, 
                backgroundColor: guideColor,
                boxShadow: `0 0 2px ${shadowColor}`
              }} 
            />
          )
        } else {
          return (
            <div 
              key={g.id} 
              style={{ 
                position: 'absolute', 
                top: g.position, 
                left: g.start, 
                width: g.end - g.start, 
                height: 1, 
                backgroundColor: guideColor,
                boxShadow: `0 0 2px ${shadowColor}`
              }} 
            />
          )
        }
      })}
    </div>
  )
}
