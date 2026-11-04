import { useEffect, useRef, useState } from 'react'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import { EDGE_LINE_WIDTH_LIMIT } from '../../../../domain/style/styleConstraints'
import { EDGE_COLOR_PRESETS } from '../../../../domain/style/styleDefaults'
import { seedCurveControlOnModeSwitch, type CurveControl } from '../../../../domain/graph/edgeCurve'
import type { EdgeLineMode, EdgeLineStyle, EdgeStylePatch } from '../../../../types'

/** 浮窗菜单要编辑的连线样式快照（由 FloatingEdge 按默认样式兜底后传入） */
export interface QuickEdgeStyle {
  lineMode: EdgeLineMode
  lineStyle: EdgeLineStyle
  lineWidth: number
  color: string
  /** 当前曲线控制点，切到「曲线」时用来判断要不要注入可见默认弧度 */
  curveControl: CurveControl | null
}

interface QuickEdgeStylePopoverProps {
  edgeStyle: QuickEdgeStyle
  onChange: (patch: EdgeStylePatch) => void
}

/**
 * 线条粗细滑杆：拖动期间只改组件内草稿，松手 / 键盘释放 / 失焦才提交一次。
 * 与右侧样式面板一致——range 的 onChange 直写会一次拖动产生几十次
 * setEdges + 落盘 + zundo 记录，撤销栈会被同一次拖动的中间态占满。
 */
function WidthSlider({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const committedRef = useRef(value)
  const dirtyRef = useRef(false)

  // 外部值变化（切换选中边、格式刷、右侧面板改动）时重置草稿
  useEffect(() => {
    draftRef.current = value
    committedRef.current = value
    dirtyRef.current = false
    setDraft(value)
  }, [value])

  const updateDraft = (next: number) => {
    draftRef.current = next
    dirtyRef.current = true
    setDraft(next)
  }

  const commit = () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    const next = draftRef.current
    if (Math.abs(next - committedRef.current) > 1e-6) onCommit(next)
    committedRef.current = next
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label="线条粗细"
        min={EDGE_LINE_WIDTH_LIMIT.min}
        max={EDGE_LINE_WIDTH_LIMIT.max}
        step={EDGE_LINE_WIDTH_LIMIT.step}
        value={draft}
        onChange={(e) => updateDraft(Number(e.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
        style={{ accentColor: 'var(--color-accent)' }}
        className="h-4 min-w-0 flex-1 cursor-pointer"
      />
      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-[var(--color-text-muted)]">
        {draft.toFixed(1)}
      </span>
    </div>
  )
}

/**
 * 选中连线后浮窗菜单展开的快捷样式面板。
 *
 * 定位必须是 absolute：外层 EdgeToolbarAnchor 用 ResizeObserver 量工具栏尺寸做避让，
 * 若面板参与文档流会把工具栏撑大 → 每次展开都重新计算避让位置、工具条瞬间跳动。
 * 面板沿用工具栏统一的边框 / 圆角 / 阴影 / 按钮尺寸与单色品牌变量。
 */
export default function QuickEdgeStylePopover({ edgeStyle, onChange }: QuickEdgeStylePopoverProps) {
  // 与右侧样式面板共用同一条规则：从其它线型切到曲线且无自定义形态时补一个可见弧度
  const handleLineModeChange = (next: EdgeLineMode) => {
    const seed = seedCurveControlOnModeSwitch(next, edgeStyle.lineMode, edgeStyle.curveControl)
    onChange(seed ? { lineMode: next, curveControl: seed } : { lineMode: next })
  }

  const currentColor = edgeStyle.color.toLowerCase()

  return (
    <div
      data-quick-edge-style-popover=""
      className="nodrag nopan absolute left-1/2 top-full z-[11] mt-2 flex w-[216px] -translate-x-1/2 flex-col gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 shadow-[var(--shadow-popover)]"
      style={{ pointerEvents: 'all' }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">线型</span>
        <SegmentedControl
          size="sm"
          ariaLabel="线型"
          options={[
            { label: '弯折', value: 'smoothstep' },
            { label: '直线', value: 'straight' },
            { label: '曲线', value: 'curve' },
          ]}
          value={edgeStyle.lineMode}
          onChange={(v) => handleLineModeChange(v as EdgeLineMode)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">线条</span>
        <SegmentedControl
          size="sm"
          ariaLabel="线条"
          options={[
            { label: '实线', value: 'solid' },
            { label: '虚线', value: 'dashed' },
          ]}
          value={edgeStyle.lineStyle}
          onChange={(v) => onChange({ lineStyle: v as EdgeLineStyle })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">线条粗细 (px)</span>
        <WidthSlider value={edgeStyle.lineWidth} onCommit={(lineWidth) => onChange({ lineWidth })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">连线颜色</span>
        <div className="flex items-center gap-1.5">
          {EDGE_COLOR_PRESETS.map((preset) => {
            const active = currentColor === preset.toLowerCase()
            return (
              <button
                type="button"
                key={preset}
                title={preset}
                aria-label={`颜色 ${preset}`}
                aria-pressed={active}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border border-black/10 p-0 transition-all duration-100 hover:scale-[1.15] hover:shadow-[var(--shadow-sm)]"
                style={{
                  backgroundColor: preset,
                  outline: active ? '2px solid var(--color-accent)' : undefined,
                  outlineOffset: 1,
                }}
                onClick={() => onChange({ color: preset })}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
