/**
 * CardSpec 全屏结构化编辑器（阶段 5）。
 *
 * 复用 ContainerFullscreenEditorHost 的读盘 / 400ms debounce 落盘 / close-guard /
 * flush / bump revision；本组件只负责「组件列表 + 属性表单 + 实时预览 + 只读 JSON」。
 * 不做拖拽排版（阶段 8）、不接 AI（阶段 6/7）——它们产出的是同一份 CardSpec。
 *
 * 每次编辑都经 normalizeCardSpecContent 产出规范化内容再交给宿主，
 * 保证落盘数据一定过校验闸，AI 生成链路将来可复用同一函数。
 */
import { useMemo, useState } from 'react'
import type { ContainerEditorProps } from '../containerRenderers'
import { useStorage } from '../../../../../core/storage'
import {
  CARD_BADGE_TONES,
  CARD_BINDING_KINDS,
  CARD_PROGRESS_TONES,
  KNOWN_CARD_COMPONENT_TYPES,
  normalizeCardSpecContent,
  serializeCardSpecContent,
  type CardComponent,
  type CardBindingKind,
  type CardSpecContent,
} from '../../../../documents/CardSpecDocument/cardSpecTypes'
import { CardSpecComponentList } from './CardSpecComponentList'

const TYPE_LABELS: Record<string, string> = {
  title: '标题',
  text: '文本',
  badge: '徽标',
  image: '图片',
  audio: '音频',
  video: '视频',
  table: '表格',
  progress: '进度条',
  flowchart: '流程图',
  html: 'HTML（占位）',
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function newComponentId(): string {
  return `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function componentSummary(component: CardComponent): string {
  if (component.type === 'title' || component.type === 'text' || component.type === 'badge') {
    return str(component.props.text).slice(0, 24) || '（空）'
  }
  if (component.type === 'image' || component.type === 'audio' || component.type === 'video') {
    return str(component.props.src).replace('assets/', '').slice(0, 24) || '（未选资源）'
  }
  if (component.type === 'table') {
    const columns = Array.isArray(component.props.columns) ? component.props.columns.length : 0
    const rows = Array.isArray(component.props.rows) ? component.props.rows.length : 0
    return `${columns} 列 × ${rows} 行`
  }
  if (component.type === 'progress') return `${Math.round(num(component.props.value, 0))}%`
  if (component.type === 'flowchart') return str(component.props.documentId) || '（未配置引用）'
  if (component.type === 'html') return '默认关闭 · 不渲染'
  return TYPE_LABELS[component.type] ?? component.type
}

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  placeholder?: string
}

function Field({ label, value, onChange, multiline, placeholder }: FieldProps) {
  const className = 'tm-input w-full min-h-8 py-1 text-[var(--font-size-sm)] focus:border-[var(--color-accent)]'
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{label}</span>
      {multiline ? (
        <textarea className={`${className} min-h-16 resize-y`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={className} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{label}</span>
      <select
        className="tm-select w-full text-[var(--font-size-sm)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function toOptions(values: readonly string[], labels?: Record<string, string>): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: labels?.[value] ?? value }))
}

export function CardSpecEditor({ cardPath, content, title, onChange }: ContainerEditorProps) {
  const storage = useStorage()
  // 宿主按会话 key 隔离挂载，content 只在打开时读一次；之后本组件是唯一数据源，
  // 绝不回读 content 覆盖未落盘的输入。
  const [draft, setDraft] = useState<CardSpecContent>(() => normalizeCardSpecContent(content, title))
  const [selectedId, setSelectedId] = useState<string>(() => draft.components[0]?.id ?? '')
  const [addType, setAddType] = useState<string>('text')
  const [showJson, setShowJson] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => draft.components.find((component) => component.id === selectedId) ?? null,
    [draft.components, selectedId],
  )

  const commit = (next: CardSpecContent) => {
    const normalized = normalizeCardSpecContent(next, title)
    setDraft(normalized)
    onChange(normalized)
  }

  const patchProps = (patch: Record<string, unknown>) => {
    if (!selected) return
    commit({
      ...draft,
      components: draft.components.map((component) => (
        component.id === selected.id
          ? { ...component, props: { ...component.props, ...patch }, degraded: undefined }
          : component
      )),
      metadata: { ...draft.metadata, updatedAt: Date.now() },
    })
  }

  const patchComponent = (patch: Partial<CardComponent>) => {
    if (!selected) return
    commit({
      ...draft,
      components: draft.components.map((component) => (
        component.id === selected.id ? { ...component, ...patch } : component
      )),
      metadata: { ...draft.metadata, updatedAt: Date.now() },
    })
  }

  const addComponent = () => {
    const id = newComponentId()
    const component: CardComponent = { id, type: addType, props: {} }
    // 先交给 normalize 生成各类型默认 props，避免手写默认值与领域规则分叉。
    const normalized = normalizeCardSpecContent({ ...draft, components: [...draft.components, component] }, title)
    setDraft(normalized)
    onChange(normalized)
    setSelectedId(id)
  }

  const removeComponent = (id: string) => {
    const next = { ...draft, components: draft.components.filter((component) => component.id !== id) }
    commit(next)
    if (selectedId === id) setSelectedId(next.components[0]?.id ?? '')
  }

  const moveComponent = (id: string, delta: number) => {
    const index = draft.components.findIndex((component) => component.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= draft.components.length) return
    const components = [...draft.components]
    ;[components[index], components[target]] = [components[target], components[index]]
    commit({ ...draft, components })
  }

  const chooseAsset = async (field: 'src' | 'poster', hint: string) => {
    setError(null)
    try {
      const result = await storage.importCardAsset(cardPath)
      if (!result) return
      if (field === 'poster' && !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(result.src)) {
        setError('封面请选图片文件')
        return
      }
      patchProps({ [field]: result.src })
    } catch (e) {
      setError(`${hint}：${(e as Error)?.message || String(e)}`)
    }
  }

  const inputClass = 'tm-input'
  const buttonClass = 'tm-btn'

  return (
    <div className="flex h-full min-h-0 w-full" data-tm-cardspec-editor="true">
      {/* 左：组件列表 */}
      <div className="flex w-56 shrink-0 flex-col gap-2 border-r border-[var(--color-border)] p-3">
        <div className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">组件</div>
        <div className="flex gap-1">
          <select
            className={`${inputClass} min-w-0 flex-1`}
            value={addType}
            onChange={(e) => setAddType(e.target.value)}
          >
            {KNOWN_CARD_COMPONENT_TYPES.map((type) => (
              <option key={type} value={type}>{TYPE_LABELS[type] ?? type}</option>
            ))}
          </select>
          <button type="button" className={buttonClass} onClick={addComponent}>添加</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
          {draft.components.length === 0 && (
            <div className="px-1 text-[var(--font-size-xs)] leading-5 text-[var(--color-text-muted)]">暂无组件，先添加一个吧</div>
          )}
          {draft.components.map((component, index) => (
            <div
              key={component.id}
              className={`flex items-center gap-1 rounded border px-1.5 py-1 ${selectedId === component.id ? 'border-[var(--color-accent)] bg-[var(--color-hover-bg)]' : 'border-transparent hover:bg-[var(--color-hover-bg)]'}`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelectedId(component.id)}
                title={`${TYPE_LABELS[component.type] ?? component.type} · ${componentSummary(component)}`}
              >
                <div className="truncate text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
                  {index + 1}. {TYPE_LABELS[component.type] ?? component.type}
                </div>
                <div className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{componentSummary(component)}</div>
              </button>
              <button type="button" className="px-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" title="上移" onClick={() => moveComponent(component.id, -1)}>↑</button>
              <button type="button" className="px-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" title="下移" onClick={() => moveComponent(component.id, 1)}>↓</button>
              <button type="button" className="px-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" title="删除" onClick={() => removeComponent(component.id)}>×</button>
            </div>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">布局</span>
          <select
            className={inputClass}
            value={draft.layout}
            onChange={(e) => commit({ ...draft, layout: e.target.value === 'grid' ? 'grid' : 'stack' })}
          >
            <option value="stack">单列堆叠</option>
            <option value="grid">两列网格</option>
          </select>
        </label>
        <button type="button" className={buttonClass} onClick={() => setShowJson((value) => !value)}>
          {showJson ? '隐藏 JSON' : '查看 JSON（只读）'}
        </button>
      </div>

      {/* 中：属性表单 */}
      <div className="flex w-64 shrink-0 flex-col gap-2 overflow-auto border-r border-[var(--color-border)] p-3">
        <div className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">属性</div>
        {error && <div className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--font-size-xs)] text-[var(--color-text-primary)]">{error}</div>}
        {!selected ? (
          <div className="text-[var(--font-size-xs)] leading-5 text-[var(--color-text-muted)]">选中左侧组件后在此编辑属性</div>
        ) : selected.degraded === 'unknown-type' ? (
          <div className="flex flex-col gap-2">
            <div className="text-[var(--font-size-xs)] leading-5 text-[var(--color-text-muted)]">未知组件类型「{selected.type}」，数据已保留，不提供属性编辑。</div>
            <pre className="max-h-60 overflow-auto rounded border border-[var(--color-border)] p-2 text-[var(--font-size-xs)]">{JSON.stringify(selected.props, null, 2)}</pre>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(selected.type === 'title' || selected.type === 'text' || selected.type === 'badge') && (
              <Field label="文本" value={str(selected.props.text)} multiline={selected.type !== 'badge'} onChange={(value) => patchProps({ text: value })} />
            )}
            {selected.type === 'title' && (
              <SelectField label="级别" value={String(num(selected.props.level, 1))} options={[{ value: '1', label: '一级' }, { value: '2', label: '二级' }, { value: '3', label: '三级' }]} onChange={(value) => patchProps({ level: Number(value) })} />
            )}
            {selected.type === 'text' && (
              <SelectField label="样式" value={str(selected.props.variant) || 'body'} options={[{ value: 'body', label: '正文' }, { value: 'caption', label: '说明文字' }]} onChange={(value) => patchProps({ variant: value })} />
            )}
            {selected.type === 'badge' && (
              <SelectField label="色调" value={str(selected.props.tone) || 'neutral'} options={toOptions(CARD_BADGE_TONES)} onChange={(value) => patchProps({ tone: value })} />
            )}
            {(selected.type === 'image' || selected.type === 'audio' || selected.type === 'video') && (
              <div className="flex flex-col gap-1">
                <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">媒体文件（_docs/assets/）</span>
                <div className="truncate rounded border border-[var(--color-border)] px-2 py-1 text-[var(--font-size-xs)] text-[var(--color-text-primary)]" title={str(selected.props.src)}>
                  {str(selected.props.src) || '未选择'}
                </div>
                <button type="button" className={buttonClass} onClick={() => void chooseAsset('src', '导入媒体失败')}>选择文件…</button>
              </div>
            )}
            {selected.type === 'image' && (
              <>
                <Field label="替代文字" value={str(selected.props.alt)} onChange={(value) => patchProps({ alt: value })} />
                <SelectField label="填充" value={str(selected.props.fit) || 'contain'} options={[{ value: 'contain', label: '完整显示' }, { value: 'cover', label: '裁切填满' }]} onChange={(value) => patchProps({ fit: value })} />
              </>
            )}
            {(selected.type === 'audio' || selected.type === 'video') && (
              <Field label="说明" value={str(selected.props.label)} onChange={(value) => patchProps({ label: value })} />
            )}
            {selected.type === 'video' && (
              <div className="flex flex-col gap-1">
                <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">封面（可选）</span>
                <div className="truncate rounded border border-[var(--color-border)] px-2 py-1 text-[var(--font-size-xs)] text-[var(--color-text-primary)]">
                  {str(selected.props.poster) || '未选择'}
                </div>
                <button type="button" className={buttonClass} onClick={() => void chooseAsset('poster', '导入封面失败')}>选择图片…</button>
              </div>
            )}
            {selected.type === 'table' && (
              <>
                <Field label="表头（逗号分隔）" value={(Array.isArray(selected.props.columns) ? selected.props.columns : []).map(str).join(', ')} onChange={(value) => patchProps({ columns: value.split(',').map((cell) => cell.trim()) })} />
                <Field label="行（每行一条，逗号分隔）" multiline value={(Array.isArray(selected.props.rows) ? selected.props.rows : []).map((row) => (Array.isArray(row) ? row : []).map(str).join(', ')).join('\n')} onChange={(value) => patchProps({ rows: value.split('\n').map((line) => line.split(',').map((cell) => cell.trim())) })} />
              </>
            )}
            {selected.type === 'progress' && (
              <>
                <Field label="百分比（0-100）" value={String(Math.round(num(selected.props.value, 0)))} onChange={(value) => patchProps({ value: Number(value) || 0 })} />
                <Field label="说明" value={str(selected.props.label)} onChange={(value) => patchProps({ label: value })} />
                <SelectField label="色调" value={str(selected.props.tone) || 'accent'} options={toOptions(CARD_PROGRESS_TONES)} onChange={(value) => patchProps({ tone: value })} />
              </>
            )}
            {selected.type === 'flowchart' && (
              <Field label="Excalidraw 文档 ID" value={str(selected.props.documentId)} onChange={(value) => patchProps({ documentId: value })} />
            )}
            {selected.type === 'html' && (
              <>
                <div className="text-[var(--font-size-xs)] leading-4 text-[var(--color-text-muted)]">v1 占位：内容可保存，但卡片中永不渲染（沙箱渲染待阶段 8 评估）。</div>
                <Field label="HTML（仅保存）" multiline value={str(selected.props.html)} onChange={(value) => patchProps({ html: value })} />
              </>
            )}
            <SelectField
              label="数据绑定"
              value={selected.binding?.kind ?? 'static'}
              options={[{ value: 'static', label: '静态内容' }, ...toOptions(CARD_BINDING_KINDS.filter((kind) => kind !== 'static'), { title: '节点标题', summary: '摘要（暂不支持）', doc: '关联文档（暂不支持）', children: '子节点（暂不支持）' })]}
              onChange={(value) => patchComponent({ binding: value === 'static' ? undefined : { kind: value as CardBindingKind } })}
            />
          </div>
        )}
      </div>

      {/* 右：实时预览 / JSON */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center border-b border-[var(--color-border)] px-3 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {showJson ? 'CardSpec JSON（只读）' : '实时预览（与节点内一致）'}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--color-hover-bg)]">
          {showJson ? (
            <pre className="h-full overflow-auto p-3 text-[var(--font-size-xs)] leading-4 text-[var(--color-text-primary)]">{serializeCardSpecContent(draft)}</pre>
          ) : (
            <div className="mx-auto my-4 flex h-[240px] w-[360px] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex h-7 shrink-0 items-center border-b border-[var(--color-border)] px-2 text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
                <span className="truncate">{title}</span>
              </div>
              <div className="relative min-h-0 flex-1">
                {draft.components.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">空白卡片 · 添加组件后预览</div>
                ) : (
                  <CardSpecComponentList content={draft} cardPath={cardPath} cardTitle={title} visible />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
