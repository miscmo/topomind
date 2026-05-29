import type { DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits } from '../../../../types/uiStoreTypes'
import type { KnowledgeNodeStyle } from '../../../../types'
import { NODE_BADGE_SIZE_LIMIT, NODE_STYLE_NUMBER_LIMITS } from '../../../../domain/style/styleConstraints'
import { CollapsibleBlock, ColorField, NumberField, PresetButtonGrid, StyleCard, ToggleButton } from './StyleControls'
import { NodeStylePreview } from './StylePreviews'
import { NODE_STYLE_PRESETS } from '../../model/stylePresets'
import type { NodeColorStyleKey, NodeStyleNumberKey } from '../../model/styleSectionModel'

type NodeSizeLimitKey = keyof NodeSizeLimits

type NodeStylePreset = typeof NODE_STYLE_PRESETS[number]

interface NodeStylePanelProps {
  currentNodeStyle: DefaultNodeStyle
  currentNodeWidth: number
  currentNodeHeight: number
  nodeBadgeSize: number
  title: string
  nodeSizeLimits: NodeSizeLimits
  defaultNodeSize: DefaultNodeSize
  defaultNodeStyle: DefaultNodeStyle
  selectedNodesCount: number
  isMultiSelection: boolean
  selectedNodeHint?: string
  selectedNodeWidthValue: number | ''
  selectedNodeHeightValue: number | ''
  expandedBlocks: Record<string, boolean>
  onToggleBlock: (key: string) => void
  onUpdateNodeSizeLimits: (key: NodeSizeLimitKey, value: string) => void
  onUpdateNodeBadgeSize: (value: string) => void
  onResetDefaultNodeAppearance: () => void
  onApplyNodePreset: (preset: NodeStylePreset) => void
  onUpdateDefaultNodeSize: (patch: Partial<DefaultNodeSize>) => void
  onUpdateDefaultNodeStyle: (patch: Partial<DefaultNodeStyle>) => void
  onApplyNumberToDefaultNode: (key: NodeStyleNumberKey, value: string) => void
  onClearSelectedNodesStyle: () => void
  onApplySizeToSelectedNode: (key: keyof DefaultNodeSize, value: string) => void
  onApplyToSelectedNode: (patch: KnowledgeNodeStyle) => void
  onApplyNumberToSelectedNode: (key: NodeStyleNumberKey, value: string) => void
  selectedNodeNumberStyleValue: (key: NodeStyleNumberKey) => number | ''
  selectedNodeColorStyleValue: (key: NodeColorStyleKey) => string
}

export function NodeStylePanel({
  currentNodeStyle,
  currentNodeWidth,
  currentNodeHeight,
  nodeBadgeSize,
  title,
  nodeSizeLimits,
  defaultNodeSize,
  defaultNodeStyle,
  selectedNodesCount,
  isMultiSelection,
  selectedNodeHint,
  selectedNodeWidthValue,
  selectedNodeHeightValue,
  expandedBlocks,
  onToggleBlock,
  onUpdateNodeSizeLimits,
  onUpdateNodeBadgeSize,
  onResetDefaultNodeAppearance,
  onApplyNodePreset,
  onUpdateDefaultNodeSize,
  onUpdateDefaultNodeStyle,
  onApplyNumberToDefaultNode,
  onClearSelectedNodesStyle,
  onApplySizeToSelectedNode,
  onApplyToSelectedNode,
  onApplyNumberToSelectedNode,
  selectedNodeNumberStyleValue,
  selectedNodeColorStyleValue,
}: NodeStylePanelProps) {
  return (
    <div className="flex flex-col gap-4 max-w-[380px] mx-auto w-full mb-4">
      <NodeStylePreview
        style={currentNodeStyle}
        width={currentNodeWidth}
        height={currentNodeHeight}
        nodeBadgeSize={nodeBadgeSize}
        title={title}
      />
      <StyleCard>
        <CollapsibleBlock
          title="全局设置"
          hint="所有节点共享，仅限制之后的 resize 操作。"
          expandedKey="globalNode"
          expandedState={expandedBlocks}
          onToggle={onToggleBlock}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <NumberField label="最小宽度" unit="px" min={1} value={nodeSizeLimits.minWidth} onChange={(value) => onUpdateNodeSizeLimits('minWidth', value)} />
            <NumberField label="最小高度" unit="px" min={1} value={nodeSizeLimits.minHeight} onChange={(value) => onUpdateNodeSizeLimits('minHeight', value)} />
            <NumberField label="最大宽度" unit="px" min={nodeSizeLimits.minWidth} value={nodeSizeLimits.maxWidth} onChange={(value) => onUpdateNodeSizeLimits('maxWidth', value)} />
            <NumberField label="最大高度" unit="px" min={nodeSizeLimits.minHeight} value={nodeSizeLimits.maxHeight} onChange={(value) => onUpdateNodeSizeLimits('maxHeight', value)} />
            <NumberField className="col-span-full" label="徽章大小" unit="px" min={NODE_BADGE_SIZE_LIMIT.min} max={NODE_BADGE_SIZE_LIMIT.max} value={nodeBadgeSize} onChange={onUpdateNodeBadgeSize} />
          </div>
        </CollapsibleBlock>

        <CollapsibleBlock
          title="默认设置"
          hint="没有自有样式的节点会跟随这里变化，新建节点默认继承这里。"
          expandedKey="defaultNode"
          expandedState={expandedBlocks}
          onToggle={onToggleBlock}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <div className="col-span-full flex justify-end">
              <button type="button" className="h-7 px-2.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]" onClick={onResetDefaultNodeAppearance}>重置默认</button>
            </div>
            <PresetButtonGrid presets={NODE_STYLE_PRESETS} onApply={onApplyNodePreset} />
            <NumberField label="默认宽度" unit="px" min={nodeSizeLimits.minWidth} max={nodeSizeLimits.maxWidth} value={defaultNodeSize.width} onChange={(value) => onUpdateDefaultNodeSize({ width: Number(value) })} />
            <NumberField label="默认高度" unit="px" min={nodeSizeLimits.minHeight} max={nodeSizeLimits.maxHeight} value={defaultNodeSize.height} onChange={(value) => onUpdateDefaultNodeSize({ height: Number(value) })} />
            
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">排版样式</label>
              <div className="flex gap-2 w-full">
                <ToggleButton active={defaultNodeStyle.headerFontWeight === 'bold'} label="B" onClick={() => onUpdateDefaultNodeStyle({ headerFontWeight: defaultNodeStyle.headerFontWeight === 'bold' ? 'normal' : 'bold' })} />
                <ToggleButton active={defaultNodeStyle.headerFontStyle === 'italic'} label="I" onClick={() => onUpdateDefaultNodeStyle({ headerFontStyle: defaultNodeStyle.headerFontStyle === 'italic' ? 'normal' : 'italic' })} />
              </div>
            </div>

            <NumberField label="Header字体" unit="px" min={NODE_STYLE_NUMBER_LIMITS.headerFontSize.min} max={NODE_STYLE_NUMBER_LIMITS.headerFontSize.max} value={defaultNodeStyle.headerFontSize} onChange={(value) => onApplyNumberToDefaultNode('headerFontSize', value)} />
            <NumberField label="Body字体" unit="px" min={NODE_STYLE_NUMBER_LIMITS.bodyFontSize.min} max={NODE_STYLE_NUMBER_LIMITS.bodyFontSize.max} value={defaultNodeStyle.bodyFontSize} onChange={(value) => onApplyNumberToDefaultNode('bodyFontSize', value)} />
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">文字颜色</label>
              <ColorField
                value={defaultNodeStyle.headerColor || ''}
                onChange={(v) => onUpdateDefaultNodeStyle({ headerColor: v })}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">背景颜色</label>
              <ColorField
                value={defaultNodeStyle.headerBackgroundColor || ''}
                onChange={(v) => onUpdateDefaultNodeStyle({ headerBackgroundColor: v })}
              />
            </div>
            <NumberField label="边框粗细" unit="px" min={NODE_STYLE_NUMBER_LIMITS.borderWidth.min} max={NODE_STYLE_NUMBER_LIMITS.borderWidth.max} value={defaultNodeStyle.borderWidth} onChange={(value) => onApplyNumberToDefaultNode('borderWidth', value)} />
            <NumberField label="卡片圆角" unit="px" min={NODE_STYLE_NUMBER_LIMITS.borderRadius.min} max={NODE_STYLE_NUMBER_LIMITS.borderRadius.max} value={defaultNodeStyle.borderRadius} onChange={(value) => onApplyNumberToDefaultNode('borderRadius', value)} />
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">边框颜色</label>
              <ColorField
                value={defaultNodeStyle.borderColor || ''}
                onChange={(v) => onUpdateDefaultNodeStyle({ borderColor: v })}
              />
            </div>
          </div>
        </CollapsibleBlock>

        {selectedNodesCount > 0 && (
          <CollapsibleBlock
            title={isMultiSelection ? `已选节点设置 (${selectedNodesCount})` : "节点自有设置"}
            hint={isMultiSelection ? "批量修改选中节点的样式" : selectedNodeHint}
            defaultExpanded={true}
            expandedKey="ownNode"
            expandedState={expandedBlocks}
            onToggle={onToggleBlock}
          >
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div className="col-span-full flex justify-end">
                <button type="button" className="h-7 px-2.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]" onClick={onClearSelectedNodesStyle}>清除自有样式</button>
              </div>
              <NumberField label="宽度" unit="px" min={nodeSizeLimits.minWidth} max={nodeSizeLimits.maxWidth} step={1} value={selectedNodeWidthValue} onChange={(value) => onApplySizeToSelectedNode('width', value)} placeholder={isMultiSelection ? "多值" : ""} />
              <NumberField label="高度" unit="px" min={nodeSizeLimits.minHeight} max={nodeSizeLimits.maxHeight} step={1} value={selectedNodeHeightValue} onChange={(value) => onApplySizeToSelectedNode('height', value)} placeholder={isMultiSelection ? "多值" : ""} />
              
              <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">排版样式</label>
                <div className="flex gap-2 w-full">
                  <ToggleButton active={currentNodeStyle.headerFontWeight === 'bold'} label="B" onClick={() => onApplyToSelectedNode({ headerFontWeight: currentNodeStyle.headerFontWeight === 'bold' ? 'normal' : 'bold' })} />
                  <ToggleButton active={currentNodeStyle.headerFontStyle === 'italic'} label="I" onClick={() => onApplyToSelectedNode({ headerFontStyle: currentNodeStyle.headerFontStyle === 'italic' ? 'normal' : 'italic' })} />
                </div>
              </div>

              <NumberField label="Header字体" unit="px" min={NODE_STYLE_NUMBER_LIMITS.headerFontSize.min} max={NODE_STYLE_NUMBER_LIMITS.headerFontSize.max} step={1} value={selectedNodeNumberStyleValue('headerFontSize')} onChange={(value) => onApplyNumberToSelectedNode('headerFontSize', value)} placeholder={isMultiSelection ? "多值" : ""} />
              <NumberField label="Body字体" unit="px" min={NODE_STYLE_NUMBER_LIMITS.bodyFontSize.min} max={NODE_STYLE_NUMBER_LIMITS.bodyFontSize.max} step={1} value={selectedNodeNumberStyleValue('bodyFontSize')} onChange={(value) => onApplyNumberToSelectedNode('bodyFontSize', value)} placeholder={isMultiSelection ? "多值" : ""} />
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">文字颜色</label>
                <ColorField
                  value={selectedNodeColorStyleValue('headerColor')}
                  onChange={(v) => onApplyToSelectedNode({ headerColor: v })}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">背景颜色</label>
                <ColorField
                  value={selectedNodeColorStyleValue('headerBackgroundColor')}
                  onChange={(v) => onApplyToSelectedNode({ headerBackgroundColor: v })}
                />
              </div>
              <NumberField label="边框粗细" unit="px" min={NODE_STYLE_NUMBER_LIMITS.borderWidth.min} max={NODE_STYLE_NUMBER_LIMITS.borderWidth.max} step={1} value={selectedNodeNumberStyleValue('borderWidth')} onChange={(value) => onApplyNumberToSelectedNode('borderWidth', value)} placeholder={isMultiSelection ? "多值" : ""} />
              <NumberField label="卡片圆角" unit="px" min={NODE_STYLE_NUMBER_LIMITS.borderRadius.min} max={NODE_STYLE_NUMBER_LIMITS.borderRadius.max} step={1} value={selectedNodeNumberStyleValue('borderRadius')} onChange={(value) => onApplyNumberToSelectedNode('borderRadius', value)} placeholder={isMultiSelection ? "多值" : ""} />
              <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">边框颜色</label>
                <ColorField
                  value={selectedNodeColorStyleValue('borderColor')}
                  onChange={(v) => onApplyToSelectedNode({ borderColor: v })}
                />
              </div>
            </div>
          </CollapsibleBlock>
        )}
      </StyleCard>
    </div>
  )
}
