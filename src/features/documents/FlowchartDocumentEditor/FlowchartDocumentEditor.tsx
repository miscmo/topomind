import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Graph, Edge } from '@antv/x6'
import { Selection } from '@antv/x6-plugin-selection'
import { Snapline } from '@antv/x6-plugin-snapline'
import { Keyboard } from '@antv/x6-plugin-keyboard'
import { History } from '@antv/x6-plugin-history'
import { Clipboard } from '@antv/x6-plugin-clipboard'
import { Transform } from '@antv/x6-plugin-transform'
import { Stencil } from '@antv/x6-plugin-stencil'
import type { FlowchartDocumentContent } from './flowchartDocumentTypes'
import { withFlowchartUpdatedAt } from './flowchartDocumentTypes'

type FlowchartNodeKind = 'start' | 'process' | 'decision' | 'end'

interface FlowchartDocumentEditorProps {
  value: FlowchartDocumentContent
  onChange: (value: FlowchartDocumentContent) => void
  readOnly?: boolean
}

interface AppliedFlowchartValue {
  cells: string
  viewport: string
}

const FLOWCHART_KIND_OPTIONS: { kind: FlowchartNodeKind; label: string }[] = [
  { kind: 'start', label: '开始' },
  { kind: 'process', label: '流程' },
  { kind: 'decision', label: '判断' },
  { kind: 'end', label: '结束' },
]

function getAppliedValue(value: FlowchartDocumentContent): AppliedFlowchartValue {
  return {
    cells: JSON.stringify(value.cells),
    viewport: JSON.stringify(value.viewport),
  }
}

function kindMeta(kind: FlowchartNodeKind) {
  if (kind === 'start') return { label: '开始', accent: '#16a34a', soft: '#dcfce7' }
  if (kind === 'end') return { label: '结束', accent: '#dc2626', soft: '#fee2e2' }
  if (kind === 'decision') return { label: '判断', accent: '#d97706', soft: '#fef3c7' }
  return { label: '流程', accent: '#2563eb', soft: '#dbeafe' }
}

function getNodeStyle(kind: FlowchartNodeKind, label: string) {
  const meta = kindMeta(kind)
  if (kind === 'start' || kind === 'end') {
    return {
      shape: 'rect', width: 120, height: 50,
      attrs: { body: { fill: meta.soft, stroke: meta.accent, strokeWidth: 2, rx: 25, ry: 25 }, label: { text: label, fill: '#1e293b', fontSize: 14, fontWeight: 'bold' } },
    }
  }
  if (kind === 'decision') {
    return {
      shape: 'polygon', width: 160, height: 80,
      attrs: { body: { fill: meta.soft, stroke: meta.accent, strokeWidth: 2, refPoints: '0,10 10,0 20,10 10,20' }, label: { text: label, fill: '#1e293b', fontSize: 14, fontWeight: 'bold' } },
    }
  }
  return {
    shape: 'rect', width: 160, height: 60,
    attrs: { body: { fill: meta.soft, stroke: meta.accent, strokeWidth: 2, rx: 6, ry: 6 }, label: { text: label, fill: '#1e293b', fontSize: 14, fontWeight: 'bold', textWrap: { width: -20 } } },
  }
}

Graph.registerEdge('custom-edge', {
  inherit: 'edge',
  attrs: { line: { stroke: '#94a3b8', strokeWidth: 2, targetMarker: { name: 'block', width: 10, height: 10 } } },
  router: { name: 'manhattan', args: { padding: 20 } },
  zIndex: 0,
}, true)

export const FlowchartDocumentEditor = memo(function FlowchartDocumentEditor({ value, onChange, readOnly = false }: FlowchartDocumentEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stencilContainerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<Graph | null>(null)
  const valueRef = useRef(value)
  const isApplyingExternalValueRef = useRef(false)
  const lastAppliedValueRef = useRef<AppliedFlowchartValue>(getAppliedValue(value))
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const updateDocument = useCallback((nextValue: FlowchartDocumentContent) => {
    onChange(withFlowchartUpdatedAt(nextValue))
  }, [onChange])

  const handleTitleChange = useCallback((title: string) => {
    updateDocument({ ...value, title })
  }, [updateDocument, value])

  const refreshHistoryState = useCallback(() => {
    const graph = graphRef.current
    setHistoryState({
      canUndo: Boolean(graph?.canUndo?.()),
      canRedo: Boolean(graph?.canRedo?.()),
    })
  }, [])

  // Initialize X6 Graph. A read-only mode switch recreates plugins with the appropriate interaction settings.
  useEffect(() => {
    if (!containerRef.current || graphRef.current) return

    const graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      grid: { size: 20, visible: true, type: 'dot', args: { color: 'var(--color-canvas-grid)', thickness: 1 } },
      panning: { enabled: !readOnly, eventTypes: ['leftMouseDown', 'mouseWheel'] },
      mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'] },
      connecting: {
        snap: true, allowBlank: false, allowLoop: false, highlight: true,
        createEdge() { return graphRef.current?.createEdge({ shape: 'custom-edge' }) as Edge | undefined | null },
        validateConnection({ sourceView, targetView }) { return !readOnly && sourceView !== targetView },
      },
      interacting: { nodeMovable: !readOnly, edgeMovable: !readOnly },
    })
    graphRef.current = graph

    const syncToValue = () => {
      if (readOnly || isApplyingExternalValueRef.current) return
      const json = graph.toJSON()
      onChange(withFlowchartUpdatedAt({ ...valueRef.current, cells: json.cells as FlowchartDocumentContent['cells'] }))
    }
    const syncViewport = () => {
      if (readOnly || isApplyingExternalValueRef.current) return
      onChange(withFlowchartUpdatedAt({
        ...valueRef.current,
        viewport: { zoom: graph.zoom(), pan: { x: graph.translate().tx, y: graph.translate().ty } },
      }))
    }
    const handleHistoryChange = () => {
      refreshHistoryState()
    }
    const handleHistoryReplay = () => {
      syncToValue()
      refreshHistoryState()
    }

    if (!readOnly) {
      graph.use(new Selection({ enabled: true, multiple: true, rubberband: true, showNodeSelectionBox: true }))
      graph.use(new Snapline({ enabled: true, sharp: true }))
      graph.use(new Keyboard({ enabled: true, global: false }))
      graph.use(new Clipboard({ enabled: true }))
      graph.use(new History({ enabled: true }))
      graph.use(new Transform({ resizing: { enabled: true, minWidth: 40, minHeight: 40 } }))

      if (stencilContainerRef.current) {
        const stencil = new Stencil({
          title: '基础图形', target: graph, stencilGraphWidth: 200, stencilGraphHeight: 300, collapsable: false,
          groups: [{ title: '基础图形', name: 'group1' }],
          layoutOptions: { columns: 2, columnWidth: 80, rowHeight: 60 },
        })
        stencilContainerRef.current.appendChild(stencil.container)
        stencil.load([
          graph.createNode({ ...getNodeStyle('start', '开始'), width: 60, height: 30 }),
          graph.createNode({ ...getNodeStyle('process', '流程'), width: 60, height: 30 }),
          graph.createNode({ ...getNodeStyle('decision', '判断'), width: 70, height: 40 }),
          graph.createNode({ ...getNodeStyle('end', '结束'), width: 60, height: 30 }),
        ], 'group1')
      }

      graph.bindKey(['meta+c', 'ctrl+c'], () => { const cells = graph.getSelectedCells(); if (cells.length) graph.copy(cells); return false })
      graph.bindKey(['meta+v', 'ctrl+v'], () => { if (!graph.isClipboardEmpty()) { const cells = graph.paste({ offset: 32 }); graph.cleanSelection(); graph.select(cells) }; return false })
      graph.bindKey(['backspace', 'delete'], () => { const cells = graph.getSelectedCells(); if (cells.length) graph.removeCells(cells); return false })
      graph.bindKey(['meta+z', 'ctrl+z'], () => { if (graph.canUndo()) graph.undo(); return false })
      graph.bindKey(['meta+shift+z', 'ctrl+shift+z', 'ctrl+y'], () => { if (graph.canRedo()) graph.redo(); return false })
    }

    isApplyingExternalValueRef.current = true
    try {
      graph.fromJSON({ cells: value.cells as any })
      graph.zoomTo(value.viewport.zoom)
      graph.translate(value.viewport.pan.x, value.viewport.pan.y)
      graph.cleanHistory?.()
      lastAppliedValueRef.current = getAppliedValue(value)
    } finally {
      isApplyingExternalValueRef.current = false
    }

    graph.on('node:moved', syncToValue)
    graph.on('node:added', syncToValue)
    graph.on('node:removed', syncToValue)
    graph.on('edge:connected', syncToValue)
    graph.on('edge:removed', syncToValue)
    graph.on('node:resized', syncToValue)
    graph.on('translate', syncViewport)
    graph.on('scale', syncViewport)
    graph.on('history:change', handleHistoryChange)
    graph.on('history:undo', handleHistoryReplay)
    graph.on('history:redo', handleHistoryReplay)

    graph.on('node:dblclick', ({ node }: { node: any }) => {
      if (readOnly) return
      const label = node.attr('label/text') as string
      const newLabel = window.prompt('修改节点名称:', label)
      if (newLabel !== null && newLabel.trim()) {
        node.attr('label/text', newLabel.trim())
        syncToValue()
      }
    })
    graph.on('edge:dblclick', ({ edge }: { edge: any }) => {
      if (readOnly) return
      const currentLabel = edge.getLabels()?.[0]?.attrs?.label?.text || edge.getLabels()?.[0]?.attrs?.text?.text || ''
      const newLabel = window.prompt('修改连线标签:', currentLabel as string)
      if (newLabel === null) return
      edge.setLabels(newLabel.trim() ? [{ attrs: { label: { text: newLabel.trim() }, text: { text: newLabel.trim() }, rect: { fill: 'var(--color-surface)', stroke: 'var(--color-border)', strokeWidth: 1, rx: 4, ry: 4 } } }] : [])
      syncToValue()
    })
    refreshHistoryState()

    return () => {
      graph.dispose()
      if (graphRef.current === graph) graphRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // Apply parent-driven document changes without re-saving them or retaining old undo history.
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return

    const nextAppliedValue = getAppliedValue(value)
    const previousAppliedValue = lastAppliedValueRef.current
    const cellsChanged = nextAppliedValue.cells !== previousAppliedValue.cells
    const viewportChanged = nextAppliedValue.viewport !== previousAppliedValue.viewport
    if (!cellsChanged && !viewportChanged) return

    isApplyingExternalValueRef.current = true
    try {
      if (cellsChanged) graph.fromJSON({ cells: value.cells })
      if (viewportChanged) {
        graph.zoomTo(value.viewport.zoom)
        graph.translate(value.viewport.pan.x, value.viewport.pan.y)
      }
      if (cellsChanged) graph.cleanHistory?.()
      lastAppliedValueRef.current = nextAppliedValue
    } finally {
      isApplyingExternalValueRef.current = false
    }
    refreshHistoryState()
  }, [value, refreshHistoryState])

  const undo = useCallback(() => {
    const graph = graphRef.current
    if (graph?.canUndo()) graph.undo()
  }, [])
  const redo = useCallback(() => {
    const graph = graphRef.current
    if (graph?.canRedo()) graph.redo()
  }, [])

  return (
    <div className="h-full min-h-0 flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]" data-shortcut-scope="flowchart">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)]">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">流程图</div>
          <input className="w-full border-none outline-none bg-transparent text-[22px] font-bold text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]" value={value.title} onChange={(event) => handleTitleChange(event.target.value)} placeholder="未命名流程图" readOnly={readOnly} />
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button type="button" className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40" onClick={undo} disabled={!historyState.canUndo} aria-label="撤销流程图操作">撤销</button>
            <button type="button" className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40" onClick={redo} disabled={!historyState.canRedo} aria-label="重做流程图操作">重做</button>
          </div>
        )}
      </div>
      <div className="flex-1 flex min-h-0 relative">
        {!readOnly && <div className="w-[200px] border-r border-[var(--color-border)] bg-[var(--color-surface)] relative flex flex-col"><div ref={stencilContainerRef} className="flex-1 relative" /></div>}
        <div className="flex-1 min-h-0 relative"><div ref={containerRef} className="w-full h-full absolute inset-0 outline-none" tabIndex={0} /></div>
      </div>
    </div>
  )
})
