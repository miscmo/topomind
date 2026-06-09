import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  Background,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import { createGraphBenchmarkScenario, type BenchmarkGraphNode, type BenchmarkNodeData } from './graphPerformanceScenario'

type BenchmarkStatus = 'booting' | 'running' | 'done' | 'failed'

interface BenchmarkMetric {
  id: 'load' | 'select' | 'zoom' | 'drag'
  label: string
  durationMs: number
}

interface GraphBenchmarkReport {
  generatedAt: string
  userAgent: string
  scenario: {
    name: string
    nodeCount: number
    edgeCount: number
    targetNodeId: string
  }
  metrics: BenchmarkMetric[]
}

function getMetricDuration(report: GraphBenchmarkReport, id: BenchmarkMetric['id']): number {
  return report.metrics.find((metric) => metric.id === id)?.durationMs ?? 0
}

function getOptimizationSuggestions(report: GraphBenchmarkReport): string[] {
  const load = getMetricDuration(report, 'load')
  const select = getMetricDuration(report, 'select')
  const zoom = getMetricDuration(report, 'zoom')
  const drag = getMetricDuration(report, 'drag')
  const suggestions: string[] = []

  if (load >= 1200) {
    suggestions.push('优先检查首屏挂载成本，减少 1000 节点场景下逐节点同步计算与一次性渲染压力。')
  }
  if (drag >= 180) {
    suggestions.push('优先优化拖拽中的全图重渲染，继续把位置变化限制在局部节点和必要连线上。')
  }
  if (zoom >= 120) {
    suggestions.push('优先排查 viewport 变化触发的额外布局更新，避免缩放操作联动无关状态。')
  }
  if (select >= 80) {
    suggestions.push('优先压缩节点选择后的同步副作用，避免详情读取或状态切换放大选择延迟。')
  }
  if (suggestions.length === 0) {
    suggestions.push('当前 1000 节点基线可接受，下一轮可增加更高连线密度或更复杂节点内容继续观察尾延迟。')
  }

  return suggestions
}

declare global {
  interface Window {
    __TOPO_GRAPH_BENCHMARK__?: {
      status: BenchmarkStatus
      report: GraphBenchmarkReport | null
      error: string | null
    }
  }
}

function toReportMarkdown(report: GraphBenchmarkReport): string {
  const suggestions = getOptimizationSuggestions(report)
  return [
    '# 大图性能基线报告',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 场景名称：${report.scenario.name}`,
    `- 数据规模：${report.scenario.nodeCount} 节点 / ${report.scenario.edgeCount} 连线`,
    `- 目标节点：${report.scenario.targetNodeId}`,
    '',
    '## 指标',
    '',
    '| 操作 | 耗时 |',
    '| --- | ---: |',
    ...report.metrics.map((metric) => `| ${metric.label} | ${metric.durationMs} ms |`),
    '',
    '## 下一步优化项',
    '',
    ...suggestions.map((item) => `- ${item}`),
    '',
  ].join('\n')
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function waitForAnimationFrames(frameCount = 2): Promise<void> {
  return new Promise((resolve) => {
    let framesLeft = Math.max(1, frameCount)
    const step = () => {
      framesLeft -= 1
      if (framesLeft <= 0) {
        resolve()
        return
      }
      window.requestAnimationFrame(step)
    }
    window.requestAnimationFrame(step)
  })
}

function BenchmarkNode({ id, data, selected }: NodeProps<BenchmarkGraphNode>) {
  return (
    <div
      data-node-id={id}
      data-selected={selected ? 'true' : 'false'}
      className={`flex h-16 w-44 items-center justify-center rounded-xl border bg-white px-3 text-center text-[12px] font-medium shadow-sm transition-colors ${
        selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-[var(--color-border-subtle)]'
      }`}
    >
      {data.label}
    </div>
  )
}

const nodeTypes: NodeTypes = {
  benchmarkNode: memo(BenchmarkNode) as ComponentType<NodeProps<Node<BenchmarkNodeData, 'benchmarkNode'>>>,
}

function BenchmarkCanvas() {
  const scenario = useMemo(() => createGraphBenchmarkScenario(), [])
  const [nodes, setNodes, onNodesChange] = useNodesState(scenario.nodes)
  const [edges, , onEdgesChange] = useEdgesState(scenario.edges)
  const reactFlow = useReactFlow()
  const benchmarkStartedAtRef = useRef(performance.now())
  const didRunRef = useRef(false)
  const [status, setStatus] = useState<BenchmarkStatus>('booting')
  const [report, setReport] = useState<GraphBenchmarkReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  const publishState = useCallback((nextStatus: BenchmarkStatus, nextReport: GraphBenchmarkReport | null, nextError: string | null) => {
    window.__TOPO_GRAPH_BENCHMARK__ = {
      status: nextStatus,
      report: nextReport,
      error: nextError,
    }
  }, [])

  useEffect(() => {
    publishState(status, report, error)
  }, [error, publishState, report, status])

  const reportJson = useMemo(() => (report ? JSON.stringify(report, null, 2) : ''), [report])
  const reportMarkdown = useMemo(() => (report ? toReportMarkdown(report) : ''), [report])
  const optimizationSuggestions = useMemo(() => (report ? getOptimizationSuggestions(report) : []), [report])

  const runBenchmark = useCallback(async () => {
    if (didRunRef.current) return
    didRunRef.current = true
    setStatus('running')
    publishState('running', null, null)

    try {
      const metrics: BenchmarkMetric[] = []

      await waitForAnimationFrames(2)
      await reactFlow.fitView({ duration: 0, padding: 0.08 })
      await waitForAnimationFrames(3)

      metrics.push({
        id: 'load',
        label: '加载',
        durationMs: performance.now() - benchmarkStartedAtRef.current,
      })

      const selectStartedAt = performance.now()
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          selected: node.id === scenario.targetNodeId,
        })),
      )
      await waitForAnimationFrames(2)
      metrics.push({
        id: 'select',
        label: '选择',
        durationMs: performance.now() - selectStartedAt,
      })

      const zoomStartedAt = performance.now()
      await reactFlow.setViewport({ x: -2200, y: -980, zoom: 0.74 }, { duration: 0 })
      await waitForAnimationFrames(2)
      metrics.push({
        id: 'zoom',
        label: '缩放',
        durationMs: performance.now() - zoomStartedAt,
      })

      const dragStartedAt = performance.now()
      for (let step = 1; step <= 12; step += 1) {
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.id !== scenario.targetNodeId) {
              return node
            }
            return {
              ...node,
              position: {
                x: node.position.x + 12,
                y: node.position.y + (step % 2 === 0 ? 8 : 5),
              },
            }
          }),
        )
        await waitForAnimationFrames(1)
      }
      await waitForAnimationFrames(2)
      metrics.push({
        id: 'drag',
        label: '拖拽',
        durationMs: performance.now() - dragStartedAt,
      })

      const nextReport: GraphBenchmarkReport = {
        generatedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        scenario: {
          name: scenario.name,
          nodeCount: scenario.nodeCount,
          edgeCount: scenario.edgeCount,
          targetNodeId: scenario.targetNodeId,
        },
        metrics: metrics.map((metric) => ({
          ...metric,
          durationMs: Math.round(metric.durationMs),
        })),
      }

      setReport(nextReport)
      setStatus('done')
      publishState('done', nextReport, null)
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      setError(message)
      setStatus('failed')
      publishState('failed', null, message)
    }
  }, [publishState, reactFlow, scenario, setNodes])

  useEffect(() => {
    void runBenchmark()
  }, [runBenchmark])

  const handleCopyJson = useCallback(async () => {
    if (!reportJson) return
    try {
      await navigator.clipboard.writeText(reportJson)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }, [reportJson])

  const handleDownloadJson = useCallback(() => {
    if (!reportJson) return
    downloadTextFile(`graph-baseline-${Date.now()}.json`, `${reportJson}\n`, 'application/json')
  }, [reportJson])

  const handleDownloadMarkdown = useCallback(() => {
    if (!reportMarkdown) return
    downloadTextFile(`graph-baseline-${Date.now()}.md`, `${reportMarkdown}\n`, 'text/markdown')
  }, [reportMarkdown])

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] text-[var(--color-text-primary)]">
      <div className="border-b border-[var(--color-border-subtle)] bg-white px-6 py-4 shadow-sm">
        <div className="text-[18px] font-semibold">大图性能基线</div>
        <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
          场景 {scenario.name}，共 {scenario.nodeCount} 节点 / {scenario.edgeCount} 连线，自动执行加载、选择、缩放、拖拽基线。
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-[var(--color-text-secondary)]">
          <span>状态：{status}</span>
          <span>目标节点：{scenario.targetNodeId}</span>
          {error ? <span className="text-[#dc2626]">错误：{error}</span> : null}
        </div>
        {report ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {report.metrics.map((metric) => (
                <div key={metric.id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[#f8fafc] px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-[var(--color-text-muted)]">{metric.label}</div>
                  <div className="mt-2 text-[24px] font-bold leading-none">{metric.durationMs} ms</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm hover:bg-[#f8fafc]"
                onClick={() => void handleCopyJson()}
              >
                复制 JSON
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm hover:bg-[#f8fafc]"
                onClick={handleDownloadJson}
              >
                下载 JSON
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm hover:bg-[#f8fafc]"
                onClick={handleDownloadMarkdown}
              >
                下载 Markdown
              </button>
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {copyStatus === 'copied' ? 'JSON 已复制到剪贴板' : copyStatus === 'failed' ? '复制失败，请改用下载' : '可直接导出报告'}
              </span>
            </div>
            <div className="mt-4 rounded-xl border border-[var(--color-border-subtle)] bg-[#f8fafc] px-4 py-3">
              <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">下一步优化项</div>
              <div className="mt-2 space-y-2 text-[12px] text-[var(--color-text-secondary)]">
                {optimizationSuggestions.map((item) => (
                  <div key={item}>- {item}</div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.5fr)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          panOnScroll
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
          style={{ width: '100%', height: 'calc(100vh - 204px)' }}
        >
          <Background gap={20} size={1} color="var(--color-canvas-grid)" />
        </ReactFlow>
        <div className="min-h-[320px] overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-white shadow-sm">
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
            <div className="text-[14px] font-semibold">结果快照</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">手动执行完成后可直接复制或下载这份结果。</div>
          </div>
          <pre className="h-[calc(100vh-268px)] overflow-auto bg-[#0f172a] p-4 text-[11px] leading-5 text-[#e2e8f0]">{reportJson || '{\n  "status": "running"\n}'}</pre>
        </div>
      </div>
    </div>
  )
}

export default function GraphPerformanceBenchmarkApp() {
  return (
    <ReactFlowProvider>
      <BenchmarkCanvas />
    </ReactFlowProvider>
  )
}
