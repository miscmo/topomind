import type { DefaultEdgeStyle } from '../../../../types/uiStoreTypes'
import type { KnowledgeEdge } from '../../../../types'
import { CollapsibleBlock, ColorField, NumberField, PresetButtonGrid, SegmentedControl, StyleCard, ToggleGroup } from './StyleControls'
import { EdgeStylePreview } from './StylePreviews'
import { EDGE_STYLE_PRESETS } from '../../model/stylePresets'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT } from '../../../../domain/style/styleConstraints'

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
                  { label: '直线', value: 'straight' }
                ]}
                value={defaultEdgeStyle.lineMode || 'straight'}
                onChange={(v) => onUpdateDefaultStyle({ lineMode: v as 'smoothstep' | 'straight' })}
              />
            </div>
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
                      { label: '直线', value: 'straight' }
                    ]}
                    value={currentEdgeStyle.lineMode || 'straight'}
                    onChange={(v) => onApplyToSelectedEdge({ lineMode: v as 'smoothstep' | 'straight' })}
                  />
                </div>
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
