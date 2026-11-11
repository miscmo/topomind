/**
 * 图谱镜头控件：房间图型 + 语义缩放档位 / 保护原因 + 三态与置顶（pin）。
 *
 * 挂在 React Flow 的 <Panel> 里（top-left，与 bottom-left 的缩略图不冲突）。
 * 所有交互都要 nodrag / nowheel，否则会被画布的平移手势抢走。
 * 图型写进全局 `_config.json`（roomPath → id），这里只负责选择，不落节点字段。
 */
import { Panel, useReactFlow } from '@xyflow/react'
import { Eye, EyeOff, Lock, Map, Minus, Pin, Plus } from 'lucide-react'
import {
  COMPACT_START_PERCENT,
  MAX_RAW_ZOOM,
  MIN_DISPLAY_PERCENT,
  MIN_RAW_ZOOM,
  ZOOM_REFERENCE,
  ZOOM_STEP_PERCENT,
  ZOOM_TRANSITION_MS,
  formatZoomPercent,
  isAtMaxZoom,
  isAtMinZoom,
  isCompactZoom,
  stepGraphZoom,
  zoomStepSensitivityForGraph,
} from '../../../../domain/graph/zoomScale'
import { useRoomOverviewStore } from '../../GraphPage/model/roomOverviewStore'
import {
  describeLodReason,
  LOD_DEFAULT_PRESERVED_DEPTH,
  LOD_MAX_PRESERVED_DEPTH,
  type LodMode,
  type LodNodeKind,
  type LodSelectedNodeInfo,
  type LodVisibility,
} from '../../../../domain/graph/lod'
import type { CanvasReadOnlyState } from '../../../../domain/graph/canvasReadOnly'
import {
  GRAPH_PROFILE_DEFINITIONS,
  describeGraphProfile,
  resolveGraphProfileDefinition,
  type ConcreteGraphProfileId,
  type GraphProfileId,
} from '../../../../domain/graph/graphProfiles'

interface LodControlProps {
  visibility: LodVisibility
  /** 与 useGraph 编辑闸门同源的只读状态（由 computeCanvasReadOnly 产出） */
  readOnlyState: CanvasReadOnlyState
  /** raw 变换系数，显示百分比一律走 zoomScale 换算 */
  zoomLevel: number
  mode: LodMode
  /** 图型解析后的有效模式（用户手动 off/force 优先），用于说明栏 */
  effectiveMode: LodMode
  policySource: 'user' | 'profile'
  profileId: GraphProfileId
  /** auto 解析后的实际图型 */
  effectiveProfileId: ConcreteGraphProfileId
  profileSaveError: string
  pinnedCount: number
  selectedNodeId: string | null
  isSelectedPinned: boolean
  onModeChange: (mode: LodMode) => void
  /** 随时变更「永久显示到哪一层」，写偏好后可见性计划立即重算 */
  onPreservedDepthChange: (depth: number) => void
  onProfileChange: (profileId: GraphProfileId) => void
  onTogglePin: (nodeId: string) => void
  onClearPin: () => void
}

const MODE_OPTIONS: Array<{ value: LodMode; label: string; title: string }> = [
  { value: 'auto', label: '自动', title: '自动档：按镜头档位隐藏边缘节点，无树/低覆盖时自动关闭' },
  { value: 'off', label: '关闭', title: '完全关闭语义缩放，始终显示全部节点' },
  { value: 'force', label: '强制', title: '跳过无树保护，强制按档位隐藏边缘节点' },
]

/** 面板可选层数：1~8 层 + 「全部层级」（与 hierarchy 深度上限同源）。 */
const PRESERVED_DEPTH_OPTIONS: Array<{ value: number; label: string }> = [
  ...Array.from({ length: 8 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1} 层${i + 1 === LOD_DEFAULT_PRESERVED_DEPTH ? '（默认）' : ''}`,
  })),
  { value: LOD_MAX_PRESERVED_DEPTH, label: '全部层级' },
]

const KIND_LABELS: Record<LodNodeKind, string> = {
  root: '树根',
  tree: '树节点',
  free: '游离',
}

/** 选中节点的一行诊断：深度 / 节点类型 / 显示阈值 / 当前是否可见。 */
function selectedDepthText(node: LodSelectedNodeInfo | null): string {
  if (!node) return '点选节点可查看深度与隐藏阈值'
  const threshold = node.revealRatio === null
    ? '始终显示'
    : `≥${Math.round(node.revealRatio * 100)}% 显示`
  return `选中 ${node.label} · 深度 ${node.depth} · ${KIND_LABELS[node.kind]} · ${threshold} · ${node.visible ? '可见' : '已隐藏'}`
}

export default function LodControl({
  visibility,
  readOnlyState,
  zoomLevel,
  mode,
  effectiveMode,
  policySource,
  profileId,
  effectiveProfileId,
  profileSaveError,
  pinnedCount,
  selectedNodeId,
  isSelectedPinned,
  onModeChange,
  onPreservedDepthChange,
  onProfileChange,
  onTogglePin,
  onClearPin,
}: LodControlProps) {
  const reactFlow = useReactFlow()
  const hiddenCount = visibility.hiddenNodeIds.size
  const coveragePercent = Math.round(visibility.treeCoverage * 100)
  const zoomPercent = formatZoomPercent(zoomLevel)
  // 100% 已是放大上限，5% 是下限：到端点就把对应方向置灰，避免点了没反应。
  // 判定走唯一规则源（按显示百分比），与左下角按钮的 at-reference 完全同源。
  const atMaxZoom = isAtMaxZoom(zoomLevel)
  const atMinZoom = isAtMinZoom(zoomLevel)
  const compactZoom = isCompactZoom(zoomLevel)
  // 渐隐区按图规模放慢步进（大图不会一格消失一片），紧凑区走等比衰减。
  const stepSensitivity = zoomStepSensitivityForGraph(
    visibility.totalNodeCount,
    visibility.treeMaxDepth,
  )
  const zoomBy = (deltaPercent: number) => {
    void reactFlow.zoomTo(
      stepGraphZoom(reactFlow.getZoom(), deltaPercent, stepSensitivity),
      { duration: ZOOM_TRANSITION_MS },
    )
  }
  const profile = resolveGraphProfileDefinition(effectiveProfileId)
  // 偏好里可能存着面板当前没列出的层数（手工改过 localStorage），补一个选项避免 select 空白。
  const depthOptions = PRESERVED_DEPTH_OPTIONS.some((item) => item.value === visibility.preservedDepth)
    ? PRESERVED_DEPTH_OPTIONS
    : [{ value: visibility.preservedDepth, label: `${visibility.preservedDepth} 层` }, ...PRESERVED_DEPTH_OPTIONS]
  const profileNote = profileId === 'auto'
    ? `自动识别：${describeGraphProfile(effectiveProfileId)}`
    : `已指定：${profile.label}`

  return (
    <Panel position="top-left" className="!m-3">
      <div
        data-tm-lod-control=""
        data-tm-canvas-readonly={readOnlyState.readOnly ? 'true' : 'false'}
        data-tm-canvas-readonly-reason={readOnlyState.reason}
        data-tm-lod-tier={visibility.tier}
        data-tm-lod-active={String(visibility.active)}
        data-tm-lod-reason={visibility.reason}
        data-tm-lod-policy-source={policySource}
        data-tm-lod-effective-mode={effectiveMode}
        data-tm-lod-visible-count={visibility.visibleNodeIds.size}
        data-tm-lod-visible-depth-levels={visibility.visibleDepthLevelCount}
        data-tm-lod-preserved-depth={visibility.preservedDepth}
        data-tm-lod-compact={compactZoom ? 'true' : 'false'}
        data-tm-lod-compact-start-percent={COMPACT_START_PERCENT}
        data-tm-lod-wheel-sensitivity={stepSensitivity.toFixed(3)}
        data-tm-lod-total-nodes={visibility.totalNodeCount}
        data-tm-lod-tree-max-depth={visibility.treeMaxDepth}
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
        className="nodrag nowheel pointer-events-auto w-[232px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-[var(--color-text)] shadow-[var(--shadow-popover)]"
      >
        <div className="flex items-center gap-1.5">
          {visibility.active
            ? <Eye className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            : <EyeOff className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />}
          <span className="text-[12px] font-semibold">图谱镜头</span>
          <span
            data-tm-lod-tier-label=""
            className="ml-auto rounded-md bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]"
          >
            {visibility.label}
          </span>
        </div>

        {/* 比例尺：100% = 常规阅读视图（raw 0.65，即旧基准的 130%），同时也是放大上限；
            100%~20% 渐隐、20%~5% 只紧凑。上下限由 zoomScale 唯一决定，端点按钮置灰。 */}
        <div
          data-tm-zoom-control=""
          data-tm-zoom-max-percent={formatZoomPercent(MAX_RAW_ZOOM)}
          data-tm-zoom-min-percent={formatZoomPercent(MIN_RAW_ZOOM)}
          data-tm-zoom-at-max={atMaxZoom ? 'true' : 'false'}
          className="mt-1.5 flex items-center gap-1 border-b border-[var(--color-border-light)] pb-1.5"
        >
          <button
            type="button"
            data-tm-zoom-out=""
            disabled={atMinZoom}
            aria-label="缩小"
            title={atMinZoom
              ? `已到 ${MIN_DISPLAY_PERCENT}% 最小比例`
              : compactZoom ? '紧凑镜头：越接近下限缩小幅度越小' : `缩小 ${Math.round(ZOOM_STEP_PERCENT * stepSensitivity)}%`}
            onClick={() => zoomBy(-ZOOM_STEP_PERCENT)}
            className="nodrag nowheel flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            data-tm-zoom-reset=""
            data-tm-zoom-percent={zoomPercent}
            aria-label="回到 100% 常规视图"
            title="点击回到 100% 常规视图（放大上限）"
            onClick={() => { void reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS }) }}
            className="nodrag nowheel min-w-0 flex-1 rounded-md border border-[var(--color-border-light)] px-1 py-1 text-center text-[11px] font-medium tabular-nums text-[var(--color-text)] hover:bg-[var(--color-hover-bg)]"
          >
            {zoomPercent}
          </button>
          <button
            type="button"
            data-tm-zoom-in=""
            disabled={atMaxZoom}
            aria-label="放大"
            title={atMaxZoom
              ? '100% 已是最大比例，节点已全部展示'
              : compactZoom ? '紧凑镜头：逐步退出紧凑区' : `放大 ${Math.round(ZOOM_STEP_PERCENT * stepSensitivity)}%`}
            onClick={() => zoomBy(ZOOM_STEP_PERCENT)}
            className="nodrag nowheel flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        {/* 只读状态与 useGraph 写闸门同源：缩小 / 还有隐藏节点时整张画布禁写，
            只有读数回到 100%（可用上方「回到 100%」按钮）才解锁。 */}
        {readOnlyState.readOnly && (
          <div
            data-tm-lod-readonly=""
            className="mt-1.5 flex items-center gap-1.5 rounded-md bg-[var(--color-accent-soft)] px-1.5 py-1 text-[10px] font-medium text-[var(--color-accent)]"
            title="缩小视图下画布信息失真，移动节点 / 连线、增删连线、重命名等编辑操作已全部停用"
          >
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">只读 · {zoomPercent} · 回到 100% 解锁</span>
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-1.5 border-b border-[var(--color-border-light)] pb-1.5">
          <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">房间图型</span>
          <select
            data-tm-graph-profile-select=""
            aria-label="房间图型"
            value={profileId}
            onChange={(event) => onProfileChange(event.target.value as GraphProfileId)}
            className="nodrag nowheel min-w-0 flex-1 rounded-md border border-[var(--color-border-light)] bg-[var(--color-surface)] px-1 py-0.5 text-[11px] text-[var(--color-text)]"
          >
            {GRAPH_PROFILE_DEFINITIONS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </div>

        {/* 自定义永久显示层数：depth <= N 的全部树节点在任何镜头下都不渐隐，随时可改。 */}
        <div
          data-tm-lod-preserved-depth-row=""
          className="mt-1.5 flex items-center gap-1.5 border-b border-[var(--color-border-light)] pb-1.5"
        >
          <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">永久显示</span>
          <select
            data-tm-lod-preserved-depth-select=""
            aria-label="永久显示层级"
            title="缩小到最远镜头也保留该深度以内的全部节点（树根算第 1 层），可随时变更"
            value={visibility.preservedDepth}
            onChange={(event) => onPreservedDepthChange(Number(event.target.value))}
            className="nodrag nowheel min-w-0 flex-1 rounded-md border border-[var(--color-border-light)] bg-[var(--color-surface)] px-1 py-0.5 text-[11px] text-[var(--color-text)]"
          >
            {depthOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        <div className="mt-1 text-[10px] leading-4 text-[var(--color-text-secondary)] opacity-80">
          树根算第 1 层；{COMPACT_START_PERCENT}% 及以下该层内节点全部保留
        </div>
        {/* 20% 以下进入紧凑行程：可见集合冻结、文字保持可读，只让节点间距随镜头收紧。 */}
        {compactZoom && (
          <div
            data-tm-lod-compact-hint=""
            data-tm-lod-compact-glyph-held="true"
            className="mt-1 flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] px-1.5 py-1 text-[10px] font-medium text-[var(--color-accent)]"
            title={`${COMPACT_START_PERCENT}% 以下不再隐藏节点，标题文字保持可读；继续缩小只让图谱更紧凑，越接近 ${MIN_DISPLAY_PERCENT}% 幅度越小`}
          >
            <Map className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">紧凑镜头 · 节点冻结 · 文字保持</span>
          </div>
        )}

        <div
          data-tm-graph-profile-effective={effectiveProfileId}
          className="mt-1 text-[10px] leading-4 text-[var(--color-text-secondary)] opacity-80"
          title={profile.description}
        >
          {profileNote} · {profile.description}
        </div>
        {profileSaveError && (
          <div data-tm-graph-profile-error="" className="mt-1 text-[10px] leading-4 text-[var(--color-danger)]">
            图型保存失败：{profileSaveError}
          </div>
        )}

        <div className="mt-1.5 border-t border-[var(--color-border-light)] pt-1.5">
          <div className="text-[11px] leading-4 text-[var(--color-text-secondary)]">
            {describeLodReason(visibility.reason)}
            {policySource === 'profile' && effectiveMode === 'off' && '（按图型）'}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-[var(--color-text-secondary)] opacity-80">
            树覆盖 {coveragePercent}% · 从属边 {visibility.subordinateEdgeCount} · 隐藏 {hiddenCount} 节点
          </div>
          <div
            data-tm-lod-collapsed-summary=""
            className="text-[10px] leading-4 text-[var(--color-text-secondary)] opacity-80"
            title="隐藏节点按「最近的可见祖先」归入主干卡片上的 +N 徽标；游离节点没有从属祖先，单独计数"
          >
            已折叠 {visibility.collapsedTotal} 个下级 · 游离收起 {visibility.collapsedFreeCount} 个
          </div>

          {/* 层级诊断：数据全部来自 LOD 的 hierarchy，用来核对自动推断的深度和消失顺序。
              「可见/总数」逐深度列出，缩小时应看到深层先归零、主干最后才归零。 */}
          <div
            data-tm-lod-depth-panel=""
            data-tm-lod-tree-max-depth={visibility.treeMaxDepth}
            data-tm-lod-root-count={visibility.rootCount}
            data-tm-lod-free-count={visibility.freeCount}
            data-tm-lod-visible-max-depth={visibility.maxDepth}
            data-tm-lod-selected-depth={visibility.selectedNode?.depth ?? ''}
            data-tm-lod-selected-kind={visibility.selectedNode?.kind ?? ''}
            data-tm-lod-selected-reveal={visibility.selectedNode?.revealRatio ?? ''}
            className="mt-1.5 rounded-md border border-[var(--color-border-light)] px-1.5 py-1"
          >
            <div className="flex items-center justify-between gap-1 text-[10px] leading-4 text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text)]">层级诊断</span>
              <span className="tabular-nums">
                最深 {visibility.treeMaxDepth} · 根 {visibility.rootCount} · 游离 {visibility.freeCount}
              </span>
            </div>
            <div
              data-tm-lod-depth-histogram=""
              className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] leading-4 tabular-nums text-[var(--color-text-secondary)]"
            >
              {visibility.depthLevels.map((level) => (
                <span
                  key={level.depth}
                  data-tm-depth-level={level.depth}
                  data-tm-depth-visible={level.visible}
                  data-tm-depth-total={level.total}
                  className={level.visible < level.total ? 'text-[var(--color-accent)]' : undefined}
                >
                  {level.depth}级 {level.visible}/{level.total}
                </span>
              ))}
              {visibility.depthLevels.length === 0 && <span>本房间没有强关系树</span>}
            </div>
            <div
              className="mt-0.5 truncate text-[10px] leading-4 text-[var(--color-text-secondary)]"
              title={selectedDepthText(visibility.selectedNode)}
            >
              {selectedDepthText(visibility.selectedNode)}
            </div>
          </div>

          <div className="mt-1.5 flex gap-1">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-tm-lod-mode={option.value}
                aria-pressed={mode === option.value}
                title={option.title}
                onClick={() => onModeChange(option.value)}
                className={
                  mode === option.value
                    ? 'flex-1 rounded-md bg-[var(--color-accent)] px-1 py-1 text-[11px] font-medium text-[var(--color-text-inverse)]'
                    : 'flex-1 rounded-md border border-[var(--color-border-light)] px-1 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-1 border-t border-[var(--color-border-light)] pt-1.5">
          <button
            type="button"
            data-tm-lod-pin-toggle=""
            disabled={!selectedNodeId}
            title={selectedNodeId ? '把当前选中节点置顶（始终显示）' : '先选中一个节点'}
            onClick={() => selectedNodeId && onTogglePin(selectedNodeId)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--color-border-light)] px-1 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Pin className="h-3 w-3" />
            {isSelectedPinned ? '取消置顶' : '置顶选中'}
          </button>
          <span data-tm-lod-pinned-count="" className="min-w-[20px] text-center text-[10px] text-[var(--color-text-secondary)]">
            {pinnedCount}
          </span>
          {pinnedCount > 0 && (
            <button
              type="button"
              data-tm-lod-pin-clear=""
              title="清除本房间全部置顶"
              onClick={onClearPin}
              className="rounded-md px-1 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
            >
              清除
            </button>
          )}
        </div>

        <button
          type="button"
          data-tm-room-overview-open=""
          title="把当前知识库的所有房间画成摘要卡片，双击进入房间（按需加载）"
          onClick={() => useRoomOverviewStore.getState().open()}
          className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-[var(--color-border-light)] px-1 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
        >
          <Map className="h-3 w-3" />
          知识库总览
        </button>
      </div>
    </Panel>
  )
}
