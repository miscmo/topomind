import { useEffect, useRef, useState } from 'react'
import type { DefaultEdgeStyle } from '../../../../types/uiStoreTypes'
import type { KnowledgeEdge } from '../../../../types'
import { CollapsibleBlock, ColorField, NumberField, PresetButtonGrid, StyleCard, ToggleGroup } from './StyleControls'
import { EdgeStylePreview } from './StylePreviews'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import { EDGE_STYLE_PRESETS } from '../../model/stylePresets'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT } from '../../../../domain/style/styleConstraints'
import {
  CURVE_AMPLITUDE_MAX,
  CURVE_AMPLITUDE_MIN,
  CURVE_POSITION_MAX,
  CURVE_POSITION_MIN,
  DEFAULT_CURVE_CONTROL,
  hasCurveDraftChange,
  normalizeCurveControl,
  seedCurveControlOnModeSwitch,
  type CurveControl,
} from '../../../../domain/graph/edgeCurve'

type LineMode = 'smoothstep' | 'straight' | 'curve'

/** 切到「曲线」且尚无自定义形态时，附带一个可见的默认弧度，避免选了曲线却还是直线 */
function curveModePatch(nextMode: LineMode, currentMode: LineMode | undefined, currentControl: CurveControl | null | undefined): Partial<DefaultEdgeStyle> {
  const seed = seedCurveControlOnModeSwitch(nextMode, currentMode, currentControl)
  return seed ? { lineMode: nextMode, curveControl: seed } : { lineMode: nextMode }
}

type EdgeStylePreset = typeof EDGE_STYLE_PRESETS[number]

interface EdgeStylePanelProps {
  currentEdgeStyle: DefaultEdgeStyle
  defaultEdgeStyle: DefaultEdgeStyle
  selectedEdge: KnowledgeEdge | null
  /** 连线起点的节点标题（非内部 id） */
  sourceLabel: string
  /** 连线终点的节点标题（非内部 id） */
  targetLabel: string
  expandedBlocks: Record<string, boolean>
  onToggleBlock: (key: string) => void
  onApplyEdgePreset: (preset: EdgeStylePreset) => void
  onUpdateDefaultStyle: (patch: Partial<DefaultEdgeStyle>) => void
  onApplyToSelectedEdge: (patch: Partial<DefaultEdgeStyle>) => void
}

export function EdgeStylePanel({
  currentEdgeStyle,
  defaultEdgeStyle,
  selectedEdge,
  sourceLabel,
  targetLabel,
  expandedBlocks,
  onToggleBlock,
  onApplyEdgePreset,
  onUpdateDefaultStyle,
  onApplyToSelectedEdge,
}: EdgeStylePanelProps) {
  return (
    <div className="flex flex-col gap-4 max-w-[380px] mx-auto w-full mb-4">
      <EdgeStylePreview style={currentEdgeStyle} />
      <StyleCard>
        <CollapsibleBlock
          title="默认连线样式"
          hint="新建连线会继承这里的默认样式。"
          expandedKey="defaultEdge"
          expandedState={expandedBlocks}
          onToggle={onToggleBlock}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <PresetButtonGrid presets={EDGE_STYLE_PRESETS} onApply={onApplyEdgePreset} />
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">线型</label>
              <SegmentedControl
                options={[
                  { label: '弯折', value: 'smoothstep' },
                  { label: '直线', value: 'straight' },
                  { label: '曲线', value: 'curve' }
                ]}
                value={defaultEdgeStyle.lineMode || 'straight'}
                onChange={(v) => onUpdateDefaultStyle(curveModePatch(
                  v as LineMode,
                  defaultEdgeStyle.lineMode,
                  defaultEdgeStyle.curveControl,
                ))}
              />
            </div>
            {defaultEdgeStyle.lineMode === 'curve' && (
              <CurveControlFields
                key="default-curve"
                control={normalizeCurveControl(defaultEdgeStyle.curveControl) ?? DEFAULT_CURVE_CONTROL}
                onChange={(control) => onUpdateDefaultStyle({ curveControl: control })}
              />
            )}
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">线条</label>
              <SegmentedControl
                options={[
                  { label: '实线', value: 'solid' },
                  { label: '虚线', value: 'dashed' }
                ]}
                value={defaultEdgeStyle.lineStyle || 'solid'}
                onChange={(v) => onUpdateDefaultStyle({ lineStyle: v as 'solid' | 'dashed' })}
              />
            </div>
            <NumberField
              label="线条粗细"
              unit="px"
              value={defaultEdgeStyle.lineWidth ?? 1.2}
              min={EDGE_LINE_WIDTH_LIMIT.min}
              max={EDGE_LINE_WIDTH_LIMIT.max}
              step={EDGE_LINE_WIDTH_LIMIT.step}
              className="col-span-full"
              onChange={(v) => onUpdateDefaultStyle({ lineWidth: Number(v) })}
            />
            <div className="flex flex-row items-center justify-between gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">显示箭头</label>
              <ToggleGroup
                options={[
                  { label: '有', value: true },
                  { label: '无', value: false }
                ]}
                value={defaultEdgeStyle.arrow ?? true}
                onChange={(v) => onUpdateDefaultStyle({ arrow: v as boolean })}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">连线颜色</label>
              <ColorField
                value={defaultEdgeStyle.color || ''}
                onChange={(v) => onUpdateDefaultStyle({ color: v })}
              />
            </div>
            {/* 关闭箭头后这些设置不再生效，隐藏避免展示无意义的控件 */}
            {defaultEdgeStyle.arrow !== false && (
              <>
                <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">箭头样式</label>
                  <SegmentedControl
                    options={[
                      { label: '实心', value: 'solid' },
                      { label: '空心', value: 'hollow' }
                    ]}
                    value={defaultEdgeStyle.arrowShape || 'hollow'}
                    onChange={(v) => onUpdateDefaultStyle({ arrowShape: v as 'solid' | 'hollow' })}
                  />
                </div>
                <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">箭头位置</label>
                  <SegmentedControl
                    options={[
                      { label: '终点', value: 'end' },
                      { label: '起点', value: 'start' },
                      { label: '两端', value: 'both' }
                    ]}
                    value={defaultEdgeStyle.arrowPosition || 'end'}
                    onChange={(v) => onUpdateDefaultStyle({ arrowPosition: v as 'end' | 'start' | 'both' })}
                  />
                </div>
                <NumberField
                  label="箭头大小"
                  unit="px"
                  value={defaultEdgeStyle.arrowSize ?? 12}
                  min={EDGE_ARROW_SIZE_LIMIT.min}
                  max={EDGE_ARROW_SIZE_LIMIT.max}
                  step={EDGE_ARROW_SIZE_LIMIT.step}
                  className="col-span-full"
                  onChange={(v) => onUpdateDefaultStyle({ arrowSize: Number(v) })}
                />
              </>
            )}
          </div>
        </CollapsibleBlock>

        <CollapsibleBlock
          title="当前连线样式"
          defaultExpanded={true}
          expandedKey="ownEdge"
          expandedState={expandedBlocks}
          onToggle={onToggleBlock}
        >
          {selectedEdge ? (
            <>
              <div className="text-[12px] text-[var(--color-text-muted)] m-0 mb-4 leading-[1.4] bg-[var(--color-bg)] py-2 px-3 rounded-md border-l-[3px] border-[var(--color-accent)] break-words">{sourceLabel} → {targetLabel}</div>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">线型</label>
                  <SegmentedControl
                    options={[
                      { label: '弯折', value: 'smoothstep' },
                      { label: '直线', value: 'straight' },
                      { label: '曲线', value: 'curve' }
                    ]}
                    value={currentEdgeStyle.lineMode || 'straight'}
                    onChange={(v) => onApplyToSelectedEdge(curveModePatch(
                      v as LineMode,
                      currentEdgeStyle.lineMode,
                      currentEdgeStyle.curveControl,
                    ))}
                  />
                </div>
                {currentEdgeStyle.lineMode === 'curve' && (
                  <CurveControlFields
                    key={`edge-${selectedEdge?.id ?? 'none'}`}
                    control={normalizeCurveControl(currentEdgeStyle.curveControl) ?? DEFAULT_CURVE_CONTROL}
                    onChange={(control) => onApplyToSelectedEdge({ curveControl: control })}
                  />
                )}
                <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">线条</label>
                  <SegmentedControl
                    options={[
                      { label: '实线', value: 'solid' },
                      { label: '虚线', value: 'dashed' }
                    ]}
                    value={currentEdgeStyle.lineStyle || 'solid'}
                    onChange={(v) => onApplyToSelectedEdge({ lineStyle: v as 'solid' | 'dashed' })}
                  />
                </div>
                <NumberField
                  label="线条粗细"
                  unit="px"
                  value={currentEdgeStyle.lineWidth ?? 1.2}
                  min={EDGE_LINE_WIDTH_LIMIT.min}
                  max={EDGE_LINE_WIDTH_LIMIT.max}
                  step={EDGE_LINE_WIDTH_LIMIT.step}
                  className="col-span-full"
                  onChange={(v) => onApplyToSelectedEdge({ lineWidth: Number(v) })}
                />
                <div className="flex flex-row items-center justify-between gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">显示箭头</label>
                  <ToggleGroup
                    options={[
                      { label: '有', value: true },
                      { label: '无', value: false }
                    ]}
                    value={currentEdgeStyle.arrow ?? true}
                    onChange={(v) => onApplyToSelectedEdge({ arrow: v as boolean })}
                  />
                </div>
                <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">连线颜色</label>
                  <ColorField
                    value={currentEdgeStyle.color || ''}
                    onChange={(v) => onApplyToSelectedEdge({ color: v })}
                  />
                </div>
                {/* 关闭箭头后这些设置不再生效，隐藏避免展示无意义的控件 */}
                {currentEdgeStyle.arrow !== false && (
                  <>
                    <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                      <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">箭头样式</label>
                      <SegmentedControl
                        options={[
                          { label: '实心', value: 'solid' },
                          { label: '空心', value: 'hollow' }
                        ]}
                        value={currentEdgeStyle.arrowShape || 'hollow'}
                        onChange={(v) => onApplyToSelectedEdge({ arrowShape: v as 'solid' | 'hollow' })}
                      />
                    </div>
                    <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                      <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">箭头位置</label>
                      <SegmentedControl
                        options={[
                          { label: '终点', value: 'end' },
                          { label: '起点', value: 'start' },
                          { label: '两端', value: 'both' }
                        ]}
                        value={currentEdgeStyle.arrowPosition || 'end'}
                        onChange={(v) => onApplyToSelectedEdge({ arrowPosition: v as 'end' | 'start' | 'both' })}
                      />
                    </div>
                    <NumberField
                      label="箭头大小"
                      unit="px"
                      value={currentEdgeStyle.arrowSize ?? 12}
                      min={EDGE_ARROW_SIZE_LIMIT.min}
                      max={EDGE_ARROW_SIZE_LIMIT.max}
                      step={EDGE_ARROW_SIZE_LIMIT.step}
                      className="col-span-full"
                      onChange={(v) => onApplyToSelectedEdge({ arrowSize: Number(v) })}
                    />
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="text-[13px] text-[var(--color-text-muted)] text-center py-8 px-4 bg-[var(--color-bg)] rounded-lg border border-dashed border-[var(--color-border-strong)]">选中一条连线后，可在这里编辑它的样式。</div>
          )}
        </CollapsibleBlock>
      </StyleCard>
    </div>
  )
}

/**
 * 单个归一化滑杆：原生 range + accent-color 绑定单色品牌变量，避免引入新视觉通道。
 * 每帧 onChange 只更新父组件草稿；pointerup / 键盘抬起 / 失焦才触发一次提交。
 */
function CurveSlider({
  label,
  hint,
  value,
  min,
  max,
  onDraftChange,
  onCommit,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onDraftChange: (value: number) => void
  onCommit: () => void
}) {
  return (
    <div className="flex flex-col gap-[6px] mb-0 col-span-full" title={hint}>
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</label>
        <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onDraftChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        style={{ accentColor: 'var(--color-accent)' }}
        className="w-full cursor-pointer h-4"
      />
    </div>
  )
}

/**
 * 曲线形态的两条数值滑杆，与画布上那个可二维拖动的控制柄是同一份数据：
 * 弯曲位置 u 决定「在哪弯」，弯曲幅度 v 决定「弯多深 / 朝哪侧」。
 * 范围常量统一取自 domain/graph/edgeCurve，避免各层各写一套。
 *
 * 一次拖动 = 一次写库：range 的 onChange 每帧触发，若直接透传会让撤销栈、图谱落盘、
 * 配置文件写入各产生几十次。这里把两条滑杆的 {u,v} 统一收在组件内草稿里，
 * 松手才 onChange 一次；草稿值与已提交值相同则不写（避免点击轨道白写一次）。
 */
function CurveControlFields({
  control,
  onChange,
}: {
  control: CurveControl
  onChange: (control: CurveControl) => void
}) {
  const [draft, setDraft] = useState<CurveControl>(control)
  const draftRef = useRef<CurveControl>(control)
  const committedRef = useRef<CurveControl>(control)
  const dirtyRef = useRef(false)

  // 外部值变化（复位弯曲 / 切换选中边）时才回灌草稿；拖动中不覆盖用户手上的值。
  useEffect(() => {
    if (dirtyRef.current) return
    setDraft(control)
    draftRef.current = control
    committedRef.current = control
  }, [control.u, control.v])

  const updateDraft = (patch: Partial<CurveControl>) => {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    dirtyRef.current = true
    setDraft(next)
  }

  const commit = () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    const next = draftRef.current
    if (hasCurveDraftChange(committedRef.current, next)) onChange(next)
    committedRef.current = next
  }

  return (
    <>
      <CurveSlider
        label="弯曲位置"
        hint={`控制点沿连线的位置：${CURVE_POSITION_MIN} 靠近起点、${CURVE_POSITION_MAX} 靠近终点（过近会让曲线在端点打结）`}
        value={draft.u}
        min={CURVE_POSITION_MIN}
        max={CURVE_POSITION_MAX}
        onDraftChange={(u) => updateDraft({ u })}
        onCommit={commit}
      />
      <CurveSlider
        label="弯曲幅度"
        hint="正值朝连线一侧弯、负值朝另一侧弯，0 为直线（弯向随连线方向变化）"
        value={draft.v}
        min={CURVE_AMPLITUDE_MIN}
        max={CURVE_AMPLITUDE_MAX}
        onDraftChange={(v) => updateDraft({ v })}
        onCommit={commit}
      />
    </>
  )
}
