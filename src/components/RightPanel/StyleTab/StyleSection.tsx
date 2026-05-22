import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useGraphStore } from '../../../stores/graphStore'
import { useStorage } from '../../../core/storage'
import type { KnowledgeNodeStyle } from '../../../types'
import type { NodeDimensionChange } from '@xyflow/react'
import type { DefaultEdgeStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits } from '../../../stores/uiStoreTypes'


const COLOR_PRESETS = ['#7f8c8d', '#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6']

type NodeStyleNumberKey = keyof Pick<KnowledgeNodeStyle, 'headerFontSize' | 'bodyFontSize' | 'borderWidth' | 'borderRadius'>
type NodeSizeLimitKey = keyof NodeSizeLimits

const NODE_STYLE_NUMBER_LIMITS: Record<NodeStyleNumberKey, { min: number; max: number }> = {
  headerFontSize: { min: 8, max: 28 },
  bodyFontSize: { min: 8, max: 24 },
  borderWidth: { min: 0, max: 8 },
  borderRadius: { min: 0, max: 32 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

interface RecentColorsStore {
  recentColors: string[];
  addColor: (c: string) => void;
}

const useRecentColorsStore = create<RecentColorsStore>((set) => ({
  recentColors: (() => {
    try {
      const stored = localStorage.getItem('topomind_recent_colors');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  })(),
  addColor: (color) => set((state) => {
    const filtered = state.recentColors.filter(c => c !== color);
    const next = [color, ...filtered].slice(0, 10);
    localStorage.setItem('topomind_recent_colors', JSON.stringify(next));
    return { recentColors: next };
  })
}))

function CollapsibleBlock({ 
  title, 
  hint, 
  defaultExpanded = false, 
  expandedKey, 
  expandedState, 
  onToggle, 
  children 
}: { 
  title: string; 
  hint?: string; 
  defaultExpanded?: boolean; 
  expandedKey: string;
  expandedState: Record<string, boolean>;
  onToggle: (key: string) => void;
  children: React.ReactNode 
}) {
  // If explicitly managed in state, use it; otherwise use default
  const isExpanded = expandedState[expandedKey] ?? defaultExpanded

  return (
    <div className="border-b border-[var(--color-border-subtle)] last-of-type:border-none">
      <div 
        className={`text-[13px] font-semibold text-[var(--color-text-primary)] m-0 flex items-center justify-between cursor-pointer select-none px-4 py-3 bg-transparent transition-colors duration-75 hover:bg-[var(--color-hover-bg)]`}
        onClick={() => onToggle(expandedKey)}
      >
        <span>{title}</span>
        <span className={`text-[10px] leading-none text-[var(--color-text-muted)] transition-all duration-75 inline-flex items-center justify-center self-center w-6 h-6 rounded-md hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-secondary)] ${!isExpanded ? '-rotate-90' : ''}` }>▼</span>
      </div>
      <div className={`px-4 pb-4 min-h-0 ${!isExpanded ? 'hidden' : ''}` }>
        {hint && <div className="text-[12px] text-[var(--color-text-muted)] m-0 mb-4 leading-[1.4] bg-[var(--color-bg)] py-2 px-3 rounded-md border-l-[3px] border-[var(--color-accent)]">{hint}</div>}
        {children}
      </div>
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const recentColors = useRecentColorsStore(s => s.recentColors);
  const addColor = useRecentColorsStore(s => s.addColor);

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    addColor(e.target.value);
  }

  const handleChange = (v: string) => {
    onChange(v);
    addColor(v);
  }

  return (
    <div className="flex flex-col gap-[6px] w-full">
      <div className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-md p-[2px] h-8 box-border w-full">
        <div className="w-[26px] h-[26px] rounded border border-black/10 overflow-hidden relative" style={{ backgroundColor: value || '#ffffff' }}>
          <input className="absolute -top-2.5 -left-2.5 w-[50px] h-[50px] p-0 border-none cursor-pointer opacity-0" type="color"
            value={value || '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
            onBlur={handleBlur}
          />
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] flex-1 uppercase select-all">{value || '无'}</div>
      </div>
      
      <div className="flex items-center flex-wrap gap-[6px]">
        <div className="flex items-center flex-wrap gap-1">
          {COLOR_PRESETS.slice(0, 6).map(c => (
            <button 
               key={c} 
               className="w-4 h-4 rounded border border-black/10 cursor-pointer p-0 transition-all duration-100 hover:scale-[1.15] hover:shadow-[0_2px_4px_rgba(0,0,0,0.1)]" 
               style={{ backgroundColor: c }}
               onClick={() => handleChange(c)}
               title={c}
            />
          ))}
        </div>
        {recentColors.length > 0 && (
          <>
            <div className="w-px h-3 bg-[var(--color-border-strong)] mx-[2px]" />
            <div className="flex items-center flex-wrap gap-1">
              {recentColors.slice(0, 6).map(c => (
                <button 
                  key={c} 
                  className="w-4 h-4 rounded border border-black/10 cursor-pointer p-0 transition-all duration-100 hover:scale-[1.15] hover:shadow-[0_2px_4px_rgba(0,0,0,0.1)]" 
                  style={{ backgroundColor: c }}
                  onClick={() => handleChange(c)}
                  title={`最近使用: ${c}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SegmentedControl({ 
  options, 
  value, 
  onChange 
}: { 
  options: { label: string; value: string | number | boolean }[]; 
  value: string | number | boolean; 
  onChange: (v: any) => void;
}) {
  return (
    <div className="flex bg-[var(--color-bg-muted)] rounded-md p-[2px] w-full box-border">
      {options.map((opt, i) => (
        <button
          key={i}
          className={`flex-1 border-none py-1 text-[12px] font-medium rounded cursor-pointer transition-all duration-75 text-center ${value === opt.value ? 'bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}` }
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function ToggleGroup({ 
  options, 
  value, 
  onChange 
}: { 
  options: { label: string; value: string | number | boolean }[]; 
  value: string | number | boolean; 
  onChange: (v: any) => void;
}) {
  return (
    <div className="flex gap-2 w-full">
      {options.map((opt, i) => (
        <button
          key={i}
          className={`flex-1 flex items-center justify-center gap-[6px] h-8 border rounded-md text-[12px] font-medium cursor-pointer transition-all duration-75 ${value === opt.value ? 'bg-[var(--color-selected-bg)] border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]'}` }
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default memo(function StyleSection() {
  const storage = useStorage()
  const selectedEdgeId = useGraphUiStore((s) => s.selectedEdgeId)
  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const defaultNodeStyle = useGraphUiStore((s) => s.defaultNodeStyle)
  const defaultNodeSize = useGraphUiStore((s) => s.defaultNodeSize)
  const nodeSizeLimits = useGraphUiStore((s) => s.nodeSizeLimits)
  const nodeBadgeSize = useGraphUiStore((s) => s.nodeBadgeSize)
  const setDefaultEdgeStyle = useGraphUiStore((s) => s.setDefaultEdgeStyle)
  const setDefaultNodeStyle = useGraphUiStore((s) => s.setDefaultNodeStyle)
  const setDefaultNodeSize = useGraphUiStore((s) => s.setDefaultNodeSize)
  const setNodeSizeLimits = useGraphUiStore((s) => s.setNodeSizeLimits)
  const setNodeBadgeSize = useGraphUiStore((s) => s.setNodeBadgeSize)

  const graph = useGraphContext()

  const selectedEdge = useGraphStore((s) => selectedEdgeId ? s.edgesMap.get(selectedEdgeId) : null)
  const nodes = useGraphStore((s) => s.nodes)
  const selectedNodes = useMemo(() => nodes.filter(n => n.selected), [nodes])
  const selectedNode = selectedNodes.length > 0 ? selectedNodes[0] : null

  const isMultiSelection = selectedNodes.length > 1
  const currentEdgeStyle = selectedEdge?.data
    ? {
        lineMode: selectedEdge.data.lineMode ?? 'straight',
        lineStyle: selectedEdge.data.lineStyle ?? 'solid',
        color: selectedEdge.data.color ?? '#7f8c8d',
        arrow: selectedEdge.data.arrow ?? true,
      }
    : defaultEdgeStyle
  const currentNodeStyle = {
    ...defaultNodeStyle,
    ...(selectedNode?.data.nodeStyle ?? {}),
  }
  const currentNodeWidth = selectedNode?.width ?? selectedNode?.initialWidth ?? selectedNode?.measured?.width ?? defaultNodeSize.width
  const currentNodeHeight = selectedNode?.height ?? selectedNode?.initialHeight ?? selectedNode?.measured?.height ?? defaultNodeSize.height

  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({})

  // Automatically expand "own" blocks when selection changes
  useEffect(() => {
    if (selectedNode) {
      setExpandedBlocks(prev => ({ ...prev, ownNode: true, globalNode: false, defaultNode: false }))
    }
  }, [selectedNode?.id])

  useEffect(() => {
    if (selectedEdgeId) {
      setExpandedBlocks(prev => ({ ...prev, ownEdge: true, defaultEdge: false }))
    }
  }, [selectedEdgeId])

  const toggleBlock = (key: string) => {
    setExpandedBlocks(prev => {
      const isCurrentlyExpanded = prev[key] ?? (
        key === 'globalNode' || key === 'defaultNode' || key === 'defaultEdge' ? false : true
      )
      return {
        ...prev,
        [key]: !isCurrentlyExpanded
      }
    })
  }

  // Load config on mount — uses requestSeq to prevent stale updates when
  // the user switches to a different node before the config read resolves
  const configRequestSeqRef = useRef(0)
  useEffect(() => {
    const requestSeq = ++configRequestSeqRef.current
    storage.readConfig().then((config) => {
      if (configRequestSeqRef.current !== requestSeq) return
      if (config.defaultEdgeStyle) setDefaultEdgeStyle(config.defaultEdgeStyle)
      if (config.defaultNodeStyle) setDefaultNodeStyle(config.defaultNodeStyle)
      if (config.defaultNodeSize) setDefaultNodeSize(config.defaultNodeSize)
      if (config.nodeSizeLimits) setNodeSizeLimits(config.nodeSizeLimits)
      if (typeof config.nodeBadgeSize === 'number') setNodeBadgeSize(config.nodeBadgeSize)
    })
  }, [storage, setDefaultEdgeStyle, setDefaultNodeSize, setDefaultNodeStyle, setNodeBadgeSize, setNodeSizeLimits])

  // Persist style changes via updateDefaultStyle (which already calls writeConfig).
  // Avoid a separate useEffect watching defaultEdgeStyle to prevent duplicate writes.
  const updateDefaultStyle = (patch: Partial<DefaultEdgeStyle>) => {
    const next = { ...defaultEdgeStyle, ...patch }
    setDefaultEdgeStyle(patch)
    void storage.writeConfig({ defaultEdgeStyle: next })
  }

  const updateDefaultNodeStyle = (patch: Partial<DefaultNodeStyle>) => {
    const next = { ...defaultNodeStyle, ...patch }
    setDefaultNodeStyle(patch)
    void storage.writeConfig({ defaultNodeStyle: next })
  }

  const updateDefaultNodeSize = (patch: Partial<DefaultNodeSize>) => {
    const next = {
      width: clamp(patch.width ?? defaultNodeSize.width, nodeSizeLimits.minWidth, nodeSizeLimits.maxWidth),
      height: clamp(patch.height ?? defaultNodeSize.height, nodeSizeLimits.minHeight, nodeSizeLimits.maxHeight),
    }
    setDefaultNodeSize(next)
    void storage.writeConfig({ defaultNodeSize: next })
  }

  const updateNodeSizeLimits = (key: NodeSizeLimitKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const next = { ...nodeSizeLimits, [key]: Math.max(1, nextValue) }
    if (next.maxWidth < next.minWidth) next.maxWidth = next.minWidth
    if (next.maxHeight < next.minHeight) next.maxHeight = next.minHeight
    setNodeSizeLimits(next)
    void storage.writeConfig({ nodeSizeLimits: next })
  }

  const updateNodeBadgeSize = (value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const next = clamp(nextValue, 8, 28)
    setNodeBadgeSize(next)
    void storage.writeConfig({ nodeBadgeSize: next })
  }

  const applyToSelectedEdge = (patch: Partial<DefaultEdgeStyle>) => {
    if (!selectedEdgeId) return
    void graph.updateEdgeStyle(selectedEdgeId, patch)
  }

  const applyToSelectedNode = (patch: KnowledgeNodeStyle) => {
    if (selectedNodes.length === 0) return
    const ids = selectedNodes.map(n => n.id)
    void graph.updateNodesStyle(ids, patch)
  }

  const applyNumberToDefaultNode = (key: NodeStyleNumberKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const limits = NODE_STYLE_NUMBER_LIMITS[key]
    updateDefaultNodeStyle({ [key]: clamp(nextValue, limits.min, limits.max) })
  }

  const applyNumberToSelectedNode = (key: NodeStyleNumberKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const limits = NODE_STYLE_NUMBER_LIMITS[key]
    applyToSelectedNode({ [key]: clamp(nextValue, limits.min, limits.max) })
  }

  const applySizeToSelectedNode = (key: keyof DefaultNodeSize, value: string) => {
    if (selectedNodes.length === 0) return
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    
    const changes = selectedNodes.map(node => {
      const nodeWidth = node.width ?? node.initialWidth ?? node.measured?.width ?? defaultNodeSize.width
      const nodeHeight = node.height ?? node.initialHeight ?? node.measured?.height ?? defaultNodeSize.height
      
      const nextWidth = key === 'width'
        ? clamp(nextValue, nodeSizeLimits.minWidth, nodeSizeLimits.maxWidth)
        : nodeWidth
      const nextHeight = key === 'height'
        ? clamp(nextValue, nodeSizeLimits.minHeight, nodeSizeLimits.maxHeight)
        : nodeHeight
        
      return {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: nextWidth, height: nextHeight },
        updateStyle: true,
        resizing: false,
      } as NodeDimensionChange
    })
    
    graph.onNodesChange(changes)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[var(--color-bg)] min-h-0">
      <div className="flex flex-col gap-4 max-w-[380px] mx-auto w-full mb-4">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-xl p-0 shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="text-[13px] font-bold text-[var(--color-primary)] px-4 py-3 m-0 bg-[var(--color-bg)] border-b border-[var(--color-border-light)] uppercase tracking-[0.5px]">节点卡片样式</div>
        
          <CollapsibleBlock
            title="全局设置"
          hint="所有节点共享，仅限制之后的 resize 操作。"
          expandedKey="globalNode"
          expandedState={expandedBlocks}
          onToggle={toggleBlock}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">最小宽度</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={1}
                value={nodeSizeLimits.minWidth}
                onChange={(e) => updateNodeSizeLimits('minWidth', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">最小高度</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={1}
                value={nodeSizeLimits.minHeight}
                onChange={(e) => updateNodeSizeLimits('minHeight', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">最大宽度</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={nodeSizeLimits.minWidth}
                value={nodeSizeLimits.maxWidth}
                onChange={(e) => updateNodeSizeLimits('maxWidth', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">最大高度</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={nodeSizeLimits.minHeight}
                value={nodeSizeLimits.maxHeight}
                onChange={(e) => updateNodeSizeLimits('maxHeight', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">徽章大小</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={8}
                max={28}
                value={nodeBadgeSize}
                onChange={(e) => updateNodeBadgeSize(e.target.value)}
              />
            </div>
          </div>
        </CollapsibleBlock>

        <CollapsibleBlock
          title="默认设置"
          hint="没有自有样式的节点会跟随这里变化，新建节点默认继承这里。"
          expandedKey="defaultNode"
          expandedState={expandedBlocks}
          onToggle={toggleBlock}
        >
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">默认宽度</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={nodeSizeLimits.minWidth}
                max={nodeSizeLimits.maxWidth}
                value={defaultNodeSize.width}
                onChange={(e) => updateDefaultNodeSize({ width: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">默认高度</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={nodeSizeLimits.minHeight}
                max={nodeSizeLimits.maxHeight}
                value={defaultNodeSize.height}
                onChange={(e) => updateDefaultNodeSize({ height: Number(e.target.value) })}
              />
            </div>
            
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">排版样式</label>
              <ToggleGroup
                options={[
                  { label: 'B', value: 'bold' },
                  { label: 'I', value: 'italic' }
                ]}
                value={defaultNodeStyle.headerFontWeight === 'bold' ? 'bold' : (defaultNodeStyle.headerFontStyle === 'italic' ? 'italic' : '')}
                onChange={(v) => {
                  if (v === 'bold') {
                    updateDefaultNodeStyle({ headerFontWeight: defaultNodeStyle.headerFontWeight === 'bold' ? 'normal' : 'bold' })
                  } else if (v === 'italic') {
                    updateDefaultNodeStyle({ headerFontStyle: defaultNodeStyle.headerFontStyle === 'italic' ? 'normal' : 'italic' })
                  }
                }}
              />
            </div>

            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">Header字体</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={8}
                max={28}
                value={defaultNodeStyle.headerFontSize}
                onChange={(e) => applyNumberToDefaultNode('headerFontSize', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">Body字体</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={8}
                max={24}
                value={defaultNodeStyle.bodyFontSize}
                onChange={(e) => applyNumberToDefaultNode('bodyFontSize', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">文字颜色</label>
              <ColorPicker
                value={defaultNodeStyle.headerColor || ''}
                onChange={(v) => updateDefaultNodeStyle({ headerColor: v })}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">背景颜色</label>
              <ColorPicker
                value={defaultNodeStyle.headerBackgroundColor || ''}
                onChange={(v) => updateDefaultNodeStyle({ headerBackgroundColor: v })}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">边框粗细</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={0}
                max={8}
                value={defaultNodeStyle.borderWidth}
                onChange={(e) => applyNumberToDefaultNode('borderWidth', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">卡片圆角</label>
              <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                min={0}
                max={32}
                value={defaultNodeStyle.borderRadius}
                onChange={(e) => applyNumberToDefaultNode('borderRadius', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px] mb-0 col-span-full">
              <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">边框颜色</label>
              <ColorPicker
                value={defaultNodeStyle.borderColor || ''}
                onChange={(v) => updateDefaultNodeStyle({ borderColor: v })}
              />
            </div>
          </div>
        </CollapsibleBlock>

        {selectedNodes.length > 0 && (
          <CollapsibleBlock
            title={isMultiSelection ? `已选节点设置 (${selectedNodes.length})` : "节点自有设置"}
            hint={isMultiSelection ? "批量修改选中节点的样式" : selectedNode?.data.label}
            defaultExpanded={true}
            expandedKey="ownNode"
            expandedState={expandedBlocks}
            onToggle={toggleBlock}
          >
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">宽度</label>
                <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                  min={nodeSizeLimits.minWidth}
                  max={nodeSizeLimits.maxWidth}
                  value={currentNodeWidth}
                  onChange={(e) => applySizeToSelectedNode('width', e.target.value)}
                  placeholder={isMultiSelection ? "多选..." : ""}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">高度</label>
                <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                  min={nodeSizeLimits.minHeight}
                  max={nodeSizeLimits.maxHeight}
                  value={currentNodeHeight}
                  onChange={(e) => applySizeToSelectedNode('height', e.target.value)}
                  placeholder={isMultiSelection ? "多选..." : ""}
                />
              </div>
              
              <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">排版样式</label>
                <ToggleGroup
                  options={[
                    { label: 'B', value: 'bold' },
                    { label: 'I', value: 'italic' }
                  ]}
                  value={currentNodeStyle.headerFontWeight === 'bold' ? 'bold' : (currentNodeStyle.headerFontStyle === 'italic' ? 'italic' : '')}
                  onChange={(v) => {
                    if (v === 'bold') {
                      applyToSelectedNode({ headerFontWeight: currentNodeStyle.headerFontWeight === 'bold' ? 'normal' : 'bold' })
                    } else if (v === 'italic') {
                      applyToSelectedNode({ headerFontStyle: currentNodeStyle.headerFontStyle === 'italic' ? 'normal' : 'italic' })
                    }
                  }}
                />
              </div>

              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">Header字体</label>
                <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                  min={8}
                  max={28}
                  value={currentNodeStyle.headerFontSize || ''}
                  onChange={(e) => applyNumberToSelectedNode('headerFontSize', e.target.value)}
                  placeholder={isMultiSelection ? "多选..." : ""}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">Body字体</label>
                <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                  min={8}
                  max={24}
                  value={currentNodeStyle.bodyFontSize || ''}
                  onChange={(e) => applyNumberToSelectedNode('bodyFontSize', e.target.value)}
                  placeholder={isMultiSelection ? "多选..." : ""}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">文字颜色</label>
                <ColorPicker
                  value={currentNodeStyle.headerColor || ''}
                  onChange={(v) => applyToSelectedNode({ headerColor: v })}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">背景颜色</label>
                <ColorPicker
                  value={currentNodeStyle.headerBackgroundColor || ''}
                  onChange={(v) => applyToSelectedNode({ headerBackgroundColor: v })}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">边框粗细</label>
                <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                  min={0}
                  max={8}
                  value={currentNodeStyle.borderWidth !== undefined ? currentNodeStyle.borderWidth : ''}
                  onChange={(e) => applyNumberToSelectedNode('borderWidth', e.target.value)}
                  placeholder={isMultiSelection ? "多选..." : ""}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">卡片圆角</label>
                <input className="w-full h-8 border border-[var(--color-border-strong)] rounded-md px-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[12px] transition-all duration-75 box-border focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_var(--color-accent-soft)]" type="number"
                  min={0}
                  max={32}
                  value={currentNodeStyle.borderRadius !== undefined ? currentNodeStyle.borderRadius : ''}
                  onChange={(e) => applyNumberToSelectedNode('borderRadius', e.target.value)}
                  placeholder={isMultiSelection ? "多选..." : ""}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">边框颜色</label>
                <ColorPicker
                  value={currentNodeStyle.borderColor || ''}
                  onChange={(v) => applyToSelectedNode({ borderColor: v })}
                />
              </div>
            </div>
          </CollapsibleBlock>
        )}
      </div>

      <div className="flex flex-col gap-4 max-w-[380px] mx-auto w-full mb-4">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-xl p-0 shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="text-[13px] font-bold text-[var(--color-primary)] px-4 py-3 m-0 bg-[var(--color-bg)] border-b border-[var(--color-border-light)] uppercase tracking-[0.5px]">连线样式</div>
          
          <CollapsibleBlock
            title="默认连线样式"
            hint="新建连线会继承这里的默认样式。"
            expandedKey="defaultEdge"
            expandedState={expandedBlocks}
            onToggle={toggleBlock}
          >
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">线型</label>
                <SegmentedControl
                  options={[
                    { label: '弯折', value: 'smoothstep' },
                    { label: '直线', value: 'straight' }
                  ]}
                  value={defaultEdgeStyle.lineMode || 'straight'}
                  onChange={(v) => updateDefaultStyle({ lineMode: v as 'smoothstep' | 'straight' })}
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
                  onChange={(v) => updateDefaultStyle({ lineStyle: v as 'solid' | 'dashed' })}
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
                  onChange={(v) => updateDefaultStyle({ arrow: v as boolean })}
                />
              </div>
              <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">连线颜色</label>
                <ColorPicker
                  value={defaultEdgeStyle.color || ''}
                  onChange={(v) => updateDefaultStyle({ color: v })}
                />
              </div>
            </div>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="当前连线样式"
            defaultExpanded={true}
            expandedKey="ownEdge"
            expandedState={expandedBlocks}
            onToggle={toggleBlock}
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
                    onChange={(v) => applyToSelectedEdge({ lineMode: v as 'smoothstep' | 'straight' })}
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
                    onChange={(v) => applyToSelectedEdge({ lineStyle: v as 'solid' | 'dashed' })}
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
                    onChange={(v) => applyToSelectedEdge({ arrow: v as boolean })}
                  />
                </div>
                <div className="flex flex-col gap-[6px] mb-0 col-span-full">
                  <label className="text-[12px] font-medium text-[var(--color-text-secondary)]">连线颜色</label>
                  <ColorPicker
                    value={currentEdgeStyle.color || ''}
                    onChange={(v) => applyToSelectedEdge({ color: v })}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="text-[13px] text-[var(--color-text-muted)] text-center py-8 px-4 bg-[var(--color-bg)] rounded-lg border border-dashed border-[var(--color-border-strong)]">选中一条连线后，可在这里编辑它的样式。</div>
          )}
          </CollapsibleBlock>
        </div>
      </div>
    </div>
    </div>
  )
})
