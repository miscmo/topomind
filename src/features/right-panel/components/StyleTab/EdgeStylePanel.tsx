import type { DefaultEdgeStyle } from '../../../../types/uiStoreTypes'
import type { KnowledgeEdge } from '../../../../types'
import { CollapsibleBlock, ColorField, PresetButtonGrid, SegmentedControl, StyleCard, ToggleGroup } from './StyleControls'
import { EdgeStylePreview } from './StylePreviews'
import { EDGE_STYLE_PRESETS } from '../../model/stylePresets'

type EdgeStylePreset = typeof EDGE_STYLE_PRESETS[number]

interface EdgeStylePanelProps {
  currentEdgeStyle: DefaultEdgeStyle
  defaultEdgeStyle: DefaultEdgeStyle
  selectedEdge: KnowledgeEdge | null
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
              <div className="text-[12px] text-[var(--color-text-muted)] m-0 mb-4 leading-[1.4] bg-[var(--color-bg)] py-2 px-3 rounded-md border-l-[3px] border-[var(--color-accent)]">{selectedEdge.source} → {selectedEdge.target}</div>
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
