import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import { useStorage } from '../../../../core/storage'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import {
  DEFAULT_EDGE_RELATION_ID,
  newEdgeRelationId,
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
 * 关系用稳定 id 落盘，显示名可以随便改；删除自定义关系不会改写磁盘上已有的边，
 * 那些边在读取侧回退显示为「关联」（见 resolveEdgeRelationId）。
 * 每种关系自带一套完整连线样式，选中 / 切换关系时套用到边，之后仍可单条覆盖。
 */
export function EdgeRelationPanel() {
  const storage = useStorage()
  const relations = useGraphUiStore((s) => s.edgeRelations)
  const showLabels = useGraphUiStore((s) => s.showEdgeRelationLabels)
  const setEdgeRelations = useGraphUiStore((s) => s.setEdgeRelations)
  const setShowLabels = useGraphUiStore((s) => s.setShowEdgeRelationLabels)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_EDGE_RELATION_ID)
  const [newName, setNewName] = useState('')
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')

  const current = relations.find((item) => item.id === selectedId) ?? relations[0]

  const write = (next: EdgeRelationDefinition[], extra: Record<string, unknown> = {}) => {
    // 走同一份归一化再写盘：非法项被过滤、内置项被补齐，store 与 _config.json 一致。
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

  const addRelation = () => {
    const customCount = relations.filter((item) => !item.builtin).length
    const name = newName.trim() || `自定义关系 ${customCount + 1}`
    const id = newEdgeRelationId()
    write([...relations, { id, name, style: { ...STYLE_CONFIG_DEFAULTS.defaultEdgeStyle } }])
    setSelectedId(id)
    setNameDraft(null)
    setNewName('')
  }

  const removeRelation = () => {
    if (!current || current.builtin) return
    write(relations.filter((item) => item.id !== current.id))
    setSelectedId(DEFAULT_EDGE_RELATION_ID)
    setNameDraft(null)
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
          关系定义保存在工作区配置里，所有知识库共用。新建连线默认是「关联」并继承默认连线样式；
          选中连线后切换关系会套用该关系的样式，之后仍可单独调整。
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
                  {item.builtin && <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">内置</span>}
                </button>
              ))}
            </div>
          </StyleCard>

          <div className="flex gap-1.5">
            <input
              data-tm-edge-relation-new-name=""
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addRelation() }}
              placeholder="新关系名称"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              data-tm-edge-relation-add=""
              onClick={addRelation}
              title="新增连线关系"
              aria-label="新增连线关系"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
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
                  {!current.builtin && (
                    <button
                      type="button"
                      data-tm-edge-relation-delete={current.id}
                      onClick={removeRelation}
                      title="删除这个自定义关系"
                      aria-label="删除这个自定义关系"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
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
