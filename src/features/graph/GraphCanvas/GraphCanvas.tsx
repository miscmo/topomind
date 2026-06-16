import { memo } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Node, type NodeTypes } from '@xyflow/react'
import { PaintRoller } from 'lucide-react'
import type { KnowledgeNode } from '../../../types'
import KnowledgeCard from './nodes/KnowledgeCard'
import FloatingEdge from './edges/FloatingEdge'
import Toolbar from '../../layout/Toolbar/Toolbar'
import { SmartGuidesRenderer } from './SmartGuidesRenderer'
import { CardSnappedConnectionLine } from './components/CardSnappedConnectionLine'
import { useGraphCanvasModel, type UseGraphCanvasModelProps } from './model/useGraphCanvasModel'

const nodeTypes = { knowledgeCard: KnowledgeCard }
const edgeTypes = {
  smoothstep: FloatingEdge,
  straight: FloatingEdge,
}

export default memo(function GraphCanvas({
  tabId,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onCloseContextMenu,
}: UseGraphCanvasModelProps) {
  const { state, graph, actions } = useGraphCanvasModel({
    tabId,
    onNodeContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu,
    onCloseContextMenu,
  })

  const {
    showGrid,
    connectingSourceId,
    nodes,
    edges,
    storedViewport,
    zoomLevel,
    guideLines,
    isFormatPainterActive,
    isShiftPressed,
  } = state

  const {
    handleNodesChange,
    handlePaneClick,
    handleMove,
    handleMoveEnd,
    handleNodeContextMenu,
    handleEdgeClick,
    handleEdgeContextMenu,
    handlePaneContextMenu,
    handleConnectionMouseMove,
    handleConnectionMouseLeave,
  } = actions

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      className={isFormatPainterActive ? "format-painter-active" : undefined}
      onMouseEnter={actions.handleCanvasMouseEnter}
      onMouseMove={actions.handleCanvasMouseMove}
      onMouseLeave={actions.handleCanvasMouseLeave}
      data-shortcut-scope="canvas"
      tabIndex={-1}
    >
      {isFormatPainterActive && (
        <>
          <style>{`
            .format-painter-active, .format-painter-active * {
              cursor: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyNCcgaGVpZ2h0PScyNCcgdmlld0JveD0nMCAwIDI0IDI0JyBmaWxsPSdub25lJyBzdHJva2U9JyMwMDAwMDAnIHN0cm9rZS13aWR0aD0nMicgc3Ryb2tlLWxpbmVjYXA9J3JvdW5kJyBzdHJva2UtbGluZWpvaW49J3JvdW5kJz48cGF0aCBkPSdtMTMuNSA4LjUtNC00Jy8+PHBhdGggZD0nTTEwLjUgMTMuNSA2IDkuNWw0LTQgNC41IDQuNWMuOC44LjUgMi0uNSAzbC0xLjUgMS41Yy0xIDEtMi4yIDEuMi0zIC41Jy8+PHBhdGggZD0nbTQgMTQuNSAxLjUgMS41Jy8+PHBhdGggZD0nTTE4LjUgMTkgNiAxNC41bC00IDRhMi4xMiAyLjEyIDAgMCAwIDMgM2wzLjUtMi41eicvPjxwYXRoIGQ9J00yMSAyMXYtNGEyIDIgMCAwIDAtMi0yaC00Jy8+PHBhdGggZD0nTTE1IDE1di00YTIgMiAwIDAgMSAyLTJoNCcvPjwvc3ZnPg==") 4 14, crosshair !important;
            }
          `}</style>
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] px-4 py-2.5 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex items-center gap-2.5 pointer-events-none transition-all">
            <div className="bg-[var(--color-accent)] text-white p-1 rounded-full flex items-center justify-center">
              <PaintRoller className="w-3.5 h-3.5" />
            </div>
            <span className="text-[13px] font-medium tracking-wide">
              格式刷已激活，点击节点应用样式。按 Esc 退出
            </span>
          </div>
        </>
      )}

      {isShiftPressed && state.isMouseOverCanvas && !isFormatPainterActive && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] px-4 py-2.5 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex items-center gap-2.5 pointer-events-none transition-all">
          <div className="bg-[var(--color-primary)] text-white p-1 px-2 rounded flex items-center justify-center font-bold text-[12px]">
            Shift
          </div>
          <span className="text-[13px] font-medium tracking-wide">
            按住 Shift 并拖拽鼠标进行多选，多选后可批量移动节点
          </span>
        </div>
      )}

      <ReactFlow
        id={tabId}
        nodes={nodes as Node[]}
        edges={edges}
        nodeTypes={nodeTypes as NodeTypes}
        edgeTypes={edgeTypes}

        onNodesChange={handleNodesChange}
        onEdgesChange={graph.onEdgesChange}

        onConnect={graph.onConnect}
        onConnectStart={graph.onConnectStart}
        onConnectEnd={graph.onConnectEnd}
        connectionRadius={12}
        connectionLineComponent={CardSnappedConnectionLine}

        onNodeClick={graph.onNodeClick as (event: React.MouseEvent, node: Node) => void}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}

        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        minZoom={0.15}
        defaultViewport={storedViewport}
        zoomOnDoubleClick={false}
        zoomOnScroll
        panOnDrag={[0]}

        proOptions={{ hideAttribution: true }}
        
        snapToGrid={false}
        snapGrid={[20, 20]}

        selectionOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}

        nodesDraggable
        nodesConnectable
        elementsSelectable
        elevateNodesOnSelect
        style={{ 
          width: '100%', 
          height: '100%', 
          background: 'var(--color-canvas-bg)'
        }}
      >
        <SmartGuidesRenderer guideLines={guideLines} />
        {showGrid && (
          <Background id={tabId} variant={'dots' as BackgroundVariant} gap={20} size={1} color="var(--color-canvas-grid)" />
        )}
      </ReactFlow>
      <Toolbar zoomLevel={zoomLevel} />
    </div>
  )
})
