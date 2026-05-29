import { memo } from 'react'
import type { DefaultEditorStyle } from '../../../../types/uiStoreTypes'
import { EDITOR_STYLE_NUMBER_LIMITS } from '../../../../domain/style/styleConstraints'
import { CollapsibleBlock, ColorField, NumberField, PresetButtonGrid, SegmentedControl, StyleCard } from './StyleControls'
import { EditorStylePreview } from './StylePreviews'
import { EDITOR_STYLE_PRESETS } from '../../model/stylePresets'

interface EditorStylePanelProps {
  defaultEditorStyle: DefaultEditorStyle
  expandedBlocks: Record<string, boolean>
  onToggleBlock: (key: string) => void
  onApplyEditorPreset: (preset: typeof EDITOR_STYLE_PRESETS[number]) => void
  onUpdateDefaultEditorStyle: (patch: Partial<DefaultEditorStyle>) => void
}

export const EditorStylePanel = memo(function EditorStylePanel({
  defaultEditorStyle,
  expandedBlocks,
  onToggleBlock,
  onApplyEditorPreset,
  onUpdateDefaultEditorStyle,
}: EditorStylePanelProps) {
  return (
    <div className="flex flex-col gap-4 max-w-[380px] mx-auto w-full mb-4">
      <EditorStylePreview style={defaultEditorStyle} />
      <StyleCard>
        <CollapsibleBlock
          title="编辑器全局设计"
          hint="这些设置当前应用到智能文档编辑器。"
          defaultExpanded={true}
          expandedKey="defaultEditor"
          expandedState={expandedBlocks}
          onToggle={onToggleBlock}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <PresetButtonGrid presets={EDITOR_STYLE_PRESETS} onApply={onApplyEditorPreset} />
            <NumberField 
              className="col-span-full" 
              label="字体大小" 
              unit="px" 
              min={EDITOR_STYLE_NUMBER_LIMITS.fontSize.min} 
              max={EDITOR_STYLE_NUMBER_LIMITS.fontSize.max} 
              value={defaultEditorStyle.fontSize} 
              onChange={(value) => onUpdateDefaultEditorStyle({ fontSize: Number(value) })} 
            />
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">字体</label>
              <SegmentedControl
                options={[
                  { label: '系统默认', value: 'inherit' },
                  { label: '黑体', value: 'sans-serif' },
                  { label: '宋体', value: 'serif' }
                ]}
                value={defaultEditorStyle.fontFamily || 'inherit'}
                onChange={(v) => onUpdateDefaultEditorStyle({ fontFamily: v as string })}
              />
            </div>
            <NumberField 
              className="col-span-full" 
              label="行高" 
              unit="倍" 
              step={EDITOR_STYLE_NUMBER_LIMITS.lineHeight.step} 
              min={EDITOR_STYLE_NUMBER_LIMITS.lineHeight.min} 
              max={EDITOR_STYLE_NUMBER_LIMITS.lineHeight.max} 
              value={defaultEditorStyle.lineHeight} 
              onChange={(value) => onUpdateDefaultEditorStyle({ lineHeight: Number(value) })} 
            />
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">文字颜色</label>
              <ColorField
                value={defaultEditorStyle.textColor || ''}
                onChange={(v) => onUpdateDefaultEditorStyle({ textColor: v })}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">背景颜色</label>
              <ColorField
                value={defaultEditorStyle.backgroundColor || ''}
                onChange={(v) => onUpdateDefaultEditorStyle({ backgroundColor: v })}
              />
            </div>
          </div>
        </CollapsibleBlock>
      </StyleCard>
    </div>
  )
})
