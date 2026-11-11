import { useState } from 'react'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import { useStorage } from '../../../../core/storage'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import {
  DEFAULT_EDGE_RELATION_ID,
  normalizeEdgeRelationDefinitions,
  type EdgeRelationDefinition,
} from '../../../../domain/graph/edgeRelations'
import { EDGE_COLOR_PRESETS, STYLE_CONFIG_DEFAULTS } from '../../../../domain/style/styleDefaults'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT, clampNumber } from '../../../../domain/style/styleConstraints'
import { seedCurveControlOnModeSwitch } from '../../../../domain/graph/edgeCurve'
import type { DefaultEdgeStyle } from '../../../../types/uiStoreTypes'
import type { EdgeArrowPosition, EdgeArrowShape, EdgeLineMode, EdgeLineStyle } from '../../../../types'
import { ColorField, NumberField, StyleCard, ToggleGroup } from './StyleControls'
import { EdgeStylePreview } from './StylePreviews'

/**
 * 「连线关系」管理页（全局配置）。
 *
 * 【用户决策 2026-11-08】关系收敛为两类、磁盘已物理迁移，不再支持自定义关系：
 *   - 关联 related：弱关系，不参与层级树；
 *   - 从属 subordinate：强关系，方向 source=父 → target=子，唯一父 / 无环 / 深度 ≤100。
 * 每次手动画线都会强制选择关系；这里只能改两种内置关系的显示名与默认样式，
 * id 恒定不变，改名不会让已有连线失效。
 */
export function EdgeRelationPanel() {
  const storage = useStorage()
  const relations = useGraphUiStore((s) => s.edgeRelations)
  const showLabels = useGraphUiStore((s) => s.showEdgeRelationLabels)
  const setEdgeRelations = useGraphUiStore((s) => s.setEdgeRelations)
  const setShowLabels = useGraphUiStore((s) => s.setShowEdgeRelationLabels)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_EDGE_RELATION_ID)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')

  const current = relations.find((item) => item.id === selectedId) ?? relations[0]

  const write = (next: EdgeRelationDefinition[], extra: Record<string, unknown> = {}) => {
    // 走同一份归一化再写盘：恒为两种内置关系，非法项被过滤，store 与 _config.json 一致。
    const normalized = normalizeEdgeRelationDefinitions(next)
    setEdgeRelations(normalized)
    setSaveError('')
    void storage.writeConfig({ edgeRelations: normalized, ...extra }).catch((error) => {
      setSaveError(error instanceof Error ? error.message : String(error))
    })
  }

  const updateStyle = (patch: Partial<DefaultEdgeStyle>) => {
    if (!current) return
    write(relations.map((item) => (
      item.id === current.id ? { ...item, style: { ...item.style, ...patch } } : item
    )))
  }

  const commitName = () => {
    if (nameDraft === null || !current) return
    const name = nameDraft.trim()
    setNameDraft(null)
    if (!name || name === current.name) return
    write(relations.map((item) => (item.id === current.id ? { ...item, name } : item)))
  }

  const toggleLabels = (visible: boolean) => {
    setShowLabels(visible)
    setSaveError('')
    void storage.writeConfig({ showEdgeRelationLabels: visible }).catch((error) => {
      setSaveError(error instanceof Error ? error.message : String(error))
    })
  }

  const handleLineMode = (mode: EdgeLineMode) => {
    if (!current) return
    const seed = seedCurveControlOnModeSwitch(mode, current.style.lineMode, current.style.curveControl)
    updateStyle(seed ? { lineMode: mode, curveControl: seed } : { lineMode: mode })
  }

  return (
    <div className="flex flex-col gap-4 max-w-[520px] mx-auto w-full mb-4" data-tm-edge-relations-panel="">
      {saveError && (
        <div className="rounded-lg border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          保存连线关系失败：{saveError}
        </div>
      )}

      <StyleCard>
        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">连线关系</div>
        <p className="mt-1 text-[11px] leading-[1.5] text-[var(--color-text-muted)]">
          关系定义保存在工作区配置里，所有知识库共用，共两种：「关联」是弱关系、不参与层级树；
          「从属」是强关系，方向固定为父 → 子，且强校验唯一父、无环、深度 1~100。
          每次新建连线都必须选择关系；选中连线后切换关系会套用该关系的样式，之后仍可单独调整。
        </p>
        <p
          className="mt-2 text-[10px] leading-[1.5] text-[var(--color-text-muted)]"
          data-tm-edge-relation-semantic-note=""
        >
          关联连线始终显示关系名（未写时显示「关联」），不受下方开关影响；从属连线的颜色 / 线型 / 粗细 / 箭头
          完全由下方配置决定，也可用单条边的格式刷自由调整，没有额外的固定视觉标记。
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[12px] text-[var(--color-text-secondary)]">在连线上显示关系名</span>
          <div className="w-[150px]">
            <ToggleGroup
              options={[{ label: '显示', value: true }, { label: '隐藏', value: false }]}
              value={showLabels}
              onChange={(value) => toggleLabels(Boolean(value))}
            />
          </div>
        </div>
      </StyleCard>

      <div className="flex items-start gap-3">
        <div className="w-[168px] shrink-0 flex flex-col gap-2">
          <StyleCard>
            <div className="flex flex-col gap-1">
              {relations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-tm-edge-relation-item={item.id}
                  aria-pressed={current?.id === item.id}
                  onClick={() => { setSelectedId(item.id); setNameDraft(null) }}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                    current?.id === item.id
                      ? 'bg-[var(--color-selected-bg)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: item.style.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">内置</span>
                </button>
              ))}
            </div>
          </StyleCard>
        </div>

        {current && (
          <div className="min-w-0 flex-1">
            <EdgeStylePreview style={current.style} />
            <StyleCard>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <input
                    data-tm-edge-relation-name=""
                    value={nameDraft ?? current.name}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={commitName}
                    onKeyDown={(event) => { if (event.key === 'Enter') commitName() }}
                    className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                <p className="text-[10px] leading-[1.5] text-[var(--color-text-muted)]">
                  稳定标识 {current.id} · 改名不会让已有连线失效{current.description ? ` · ${current.description}` : ''}
                </p>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">颜色</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {EDGE_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        title={preset}
                        aria-label={`关系颜色 ${preset}`}
                        aria-pressed={current.style.color.toLowerCase() === preset.toLowerCase()}
                        onClick={() => updateStyle({ color: preset })}
                        className="h-4 w-4 shrink-0 rounded border border-black/10 p-0 hover:scale-110"
                        style={{
                          backgroundColor: preset,
                          outline: current.style.color.toLowerCase() === preset.toLowerCase() ? '2px solid var(--color-accent)' : undefined,
                          outlineOffset: 1,
                        }}
                      />
                    ))}
                  </div>
                  <ColorField value={current.style.color} onChange={(color) => updateStyle({ color })} />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">线型</span>
                  <SegmentedControl
                    size="sm"
                    ariaLabel="关系线型"
                    options={[
                      { label: '弯折', value: 'smoothstep' },
                      { label: '直线', value: 'straight' },
                      { label: '曲线', value: 'curve' },
                    ]}
                    value={current.style.lineMode}
                    onChange={(value) => handleLineMode(value as EdgeLineMode)}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">线条 / 箭头</span>
                  <SegmentedControl
                    size="sm"
                    ariaLabel="关系线条"
                    options={[{ label: '实线', value: 'solid' }, { label: '虚线', value: 'dashed' }]}
                    value={current.style.lineStyle}
                    onChange={(value) => updateStyle({ lineStyle: value as EdgeLineStyle })}
                  />
                  <SegmentedControl
                    size="sm"
                    ariaLabel="关系箭头形状"
                    options={[{ label: '实心', value: 'solid' }, { label: '空心', value: 'hollow' }]}
                    value={current.style.arrowShape}
                    onChange={(value) => updateStyle({ arrowShape: value as EdgeArrowShape })}
                  />
                  <SegmentedControl
                    size="sm"
                    ariaLabel="关系箭头位置"
                    options={[
                      { label: '终点', value: 'end' },
                      { label: '起点', value: 'start' },
                      { label: '两端', value: 'both' },
                    ]}
                    value={current.style.arrowPosition}
                    onChange={(value) => updateStyle({ arrowPosition: value as EdgeArrowPosition })}
                  />
                  <ToggleGroup
                    options={[{ label: '显示箭头', value: true }, { label: '无箭头', value: false }]}
                    value={current.style.arrow}
                    onChange={(value) => updateStyle({ arrow: Boolean(value) })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="线条粗细"
                    unit="px"
                    value={current.style.lineWidth}
                    min={EDGE_LINE_WIDTH_LIMIT.min}
                    max={EDGE_LINE_WIDTH_LIMIT.max}
                    step={EDGE_LINE_WIDTH_LIMIT.step}
                    onChange={(value) => updateStyle({
                      lineWidth: clampNumber(Number(value) || STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth, EDGE_LINE_WIDTH_LIMIT.min, EDGE_LINE_WIDTH_LIMIT.max),
                    })}
                  />
                  <NumberField
                    label="箭头长度"
                    unit="px"
                    value={current.style.arrowSize}
                    min={EDGE_ARROW_SIZE_LIMIT.min}
                    max={EDGE_ARROW_SIZE_LIMIT.max}
                    step={EDGE_ARROW_SIZE_LIMIT.step}
                    onChange={(value) => updateStyle({
                      arrowSize: clampNumber(Number(value) || STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize, EDGE_ARROW_SIZE_LIMIT.min, EDGE_ARROW_SIZE_LIMIT.max),
                    })}
                  />
                </div>
              </div>
            </StyleCard>
          </div>
        )}
      </div>
    </div>
  )
}
