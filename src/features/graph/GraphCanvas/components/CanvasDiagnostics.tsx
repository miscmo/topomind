/**
 * 画布 LOD 语义诊断宿主（**不产生任何可见 UI**）。
 *
 * 2026-11-27：画布左上角的状态抽屉（房间路径标题栏 / 最近打开 / 撤销前进 /
 * 查看深度 / 分区折叠）已按需求整体下线。但既有 GUI 回归大量直读
 * `data-tm-lod-*` 与 `data-tm-lod-depth-panel` 上的档位、可见数、树深度等语义数据，
 * 这些是画布自身的诊断读数，不属于被移除的面板 UI，因此按项目既有做法
 * （同 `data-tm-canvas-zoom-percent`）退化为隐藏宿主节点上的纯属性。
 *
 * 这里没有按钮、没有折叠态、没有偏好存储、不做任何交互；值是 useSemanticLod
 * 的同一份派生结果，不另建第二套推断。
 */
import { Panel } from '@xyflow/react'
import {
  COMPACT_START_PERCENT,
  isCompactZoom,
  zoomStepSensitivityForGraph,
} from '../../../../domain/graph/zoomScale'
import {
  type LodMode,
  type LodVisibility,
} from '../../../../domain/graph/lod'
import type { CanvasReadOnlyState } from '../../../../domain/graph/canvasReadOnly'
import {
  type ConcreteGraphProfileId,
  type GraphProfileId,
} from '../../../../domain/graph/graphProfiles'

interface CanvasDiagnosticsProps {
  visibility: LodVisibility
  readOnlyState: CanvasReadOnlyState
  zoomLevel: number
  effectiveMode: LodMode
  policySource: 'user' | 'profile'
  profileId: GraphProfileId
  effectiveProfileId: ConcreteGraphProfileId
}

export default function CanvasDiagnostics({
  visibility,
  readOnlyState,
  zoomLevel,
  effectiveMode,
  policySource,
  profileId,
  effectiveProfileId,
}: CanvasDiagnosticsProps) {
  const compactZoom = isCompactZoom(zoomLevel)
  const stepSensitivity = zoomStepSensitivityForGraph(
    visibility.totalNodeCount,
    visibility.treeMaxDepth,
  )

  // top-left Panel 仍保留：它是 GUI 阶段 AB「左栏展开/折叠让位」的几何锚点，
  // 但内容全隐藏，画布上不再有任何状态抽屉、分区、按钮或文字。
  return (
    <Panel position="top-left" className="!m-3">
      <div
        hidden
      data-tm-lod-control=""
      data-tm-canvas-readonly={readOnlyState.readOnly ? 'true' : 'false'}
      data-tm-canvas-readonly-reason={readOnlyState.reason}
      data-tm-lod-tier={visibility.tier}
      data-tm-lod-active={String(visibility.active)}
      data-tm-lod-reason={visibility.reason}
      data-tm-lod-policy-source={policySource}
      data-tm-lod-effective-mode={effectiveMode}
      data-tm-graph-profile-effective={effectiveProfileId}
      data-tm-lod-visible-count={visibility.visibleNodeIds.size}
      data-tm-lod-visible-depth-levels={visibility.visibleDepthLevelCount}
      data-tm-lod-preserved-depth={visibility.preservedDepth}
      data-tm-lod-compact={compactZoom ? 'true' : 'false'}
      data-tm-lod-compact-start-percent={COMPACT_START_PERCENT}
      data-tm-lod-wheel-sensitivity={stepSensitivity.toFixed(3)}
      data-tm-lod-total-nodes={visibility.totalNodeCount}
      data-tm-lod-pressure={visibility.pressureActive ? 'on' : 'off'}
      data-tm-lod-pressure-glyph={visibility.pressureGlyphAware ? 'on' : 'off'}
      data-tm-lod-pressure-samples={visibility.pressureSampleCount}
      data-tm-lod-collapsed-total={visibility.collapsedTotal}
      data-tm-lod-collapsed-free={visibility.collapsedFreeCount}
      data-tm-lod-collapsed-holders={visibility.collapsedCounts.size}
      data-tm-lod-collision={visibility.collisionActive ? 'on' : 'off'}
      data-tm-lod-collision-hidden={visibility.collisionHiddenCount}
      data-tm-lod-collision-guard={visibility.collisionGuard.toFixed(3)}
      data-tm-lod-collision-box={visibility.collisionBoxScale.toFixed(3)}
      data-tm-lod-collision-protected-pairs={visibility.collisionProtectedOverlapPairs}
      data-tm-graph-profile-id={profileId}
      data-tm-lod-depth-panel=""
      data-tm-lod-tree-max-depth={visibility.treeMaxDepth}
      data-tm-lod-selected-depth={visibility.selectedNode?.depth ?? ''}
      data-tm-lod-selected-kind={visibility.selectedNode?.kind ?? ''}
      data-tm-lod-selected-reveal={visibility.selectedNode?.revealRatio ?? ''}
        className="hidden"
      />
    </Panel>
  )
}
