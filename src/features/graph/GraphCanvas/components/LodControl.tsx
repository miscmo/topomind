/**
 * 画布状态抽屉（React Flow top-left Panel）：把房间路径、镜头视图、最近打开、
 * 层级诊断四块原本各自悬浮的 UI 收进同一个可折叠抽屉。
 *
 * - 整体可折叠成一条贴边标题栏；每个功能区独立折叠，偏好走 canvasStatusPreferences。
 * - 标题栏是房间路径面包屑：固定宽度 + 首段/当前段压缩 + 完整串进 tooltip，
 *   完整链路放「位置」区纵向滚动，路径再长也不会把控件撑长。
 * - 所有 data-tm-lod-* 诊断属性、控件与关键文案都留在 DOM：GUI 回归从面板根节点
 *   读取状态，折叠分区只改 max-height/opacity，绝不条件卸载。
 * - 交互一律 nodrag / nowheel，避免被画布平移缩放手势抢走。
 */
import { Panel, useReactFlow } from '@xyflow/react'
import { ChevronDown, Lock, Map, MapPin, Minus, Pin, Plus, Redo2, Undo2 } from 'lucide-react'
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
import CanvasStatusSection from './CanvasStatusSection'
import {
  toggleCanvasStatusSection,
  setCanvasStatusDrawerOpen,
  useCanvasStatusPreferences,
  type StatusSectionId,
} from '../model/canvasStatusPreferences'
import RoomPathList, { compactRoomPath, useRoomPathItems } from '../../../layout/Breadcrumb/Breadcrumb'
import RoomHistory, { useRecentRooms } from '../../../layout/RoomHistory/RoomHistory'
import {
  describeMoveEntry,
  useNodeMoveHistoryStore,
} from '../../GraphPage/model/nodeMoveHistoryStore'

interface LodControlProps {
  /** 房间路径 / 最近打开都按当前 KB tab 取，抽屉与画布同属一个 tab */
  tabId: string
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
  /** 常驻撤销 / 前进：跨房间移动历史，与成功 toast 的撤销共用同一入口 */
  onMoveUndo?: () => void
  onMoveRedo?: () => void
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
  tabId,
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
  onMoveUndo,
  onMoveRedo,
}: LodControlProps) {
  const reactFlow = useReactFlow()
  const prefs = useCanvasStatusPreferences()
  const pathItems = useRoomPathItems(tabId)
  const path = compactRoomPath(pathItems)
  const recent = useRecentRooms(tabId)
  // 节点移动历史是运行时栈：只订阅三个标量/数组引用，移动完成与撤销时才重渲染本面板。
  const undoStack = useNodeMoveHistoryStore((s) => s.undoStack)
  const redoStack = useNodeMoveHistoryStore((s) => s.redoStack)
  const moveBusy = useNodeMoveHistoryStore((s) => s.busy)
  const undoEntry = undoStack[undoStack.length - 1]
  const redoEntry = redoStack[redoStack.length - 1]
  // 与画布写闸门一致：缩小视图只读期不触发后端 relocate。
  const moveLocked = readOnlyState.readOnly || moveBusy
  const canUndoMove = !!onMoveUndo && undoStack.length > 0 && !moveLocked
  const canRedoMove = !!onMoveRedo && redoStack.length > 0 && !moveLocked

  const hiddenCount = visibility.hiddenNodeIds.size
  const coveragePercent = Math.round(visibility.treeCoverage * 100)
  const zoomPercent = formatZoomPercent(zoomLevel)
  // 100% 已是放大上限，5% 是下限：到端点就把对应方向置灰，避免点了没反应。
  // 判定走唯一规则源（按显示百分比），与左下角按钮的 at-reference 完全同源。
  const atMaxZoom = isAtMaxZoom(zoomLevel)
  const atMinZoom = isAtMinZoom(zoomLevel)
  const compactZoom = isCompactZoom(zoomLevel)
  // 固定步进配置：灵敏度恒 1（±10%）；紧凑区仍走 stepGraphZoom 的等比衰减。
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
  const sectionOpen = (id: StatusSectionId) => prefs.sections[id]
  const sectionToggle = (id: StatusSectionId) => () => toggleCanvasStatusSection(id)

  return (
    <Panel position="top-left" className="!m-3">
      <div
        data-tm-lod-control=""
        data-tm-canvas-status-drawer=""
        data-tm-canvas-status-open={prefs.drawerOpen ? 'true' : 'false'}
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
        className={`nodrag nowheel pointer-events-auto overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-popover)] ${
          prefs.drawerOpen ? 'w-[264px]' : 'w-[208px]'
        }`}
      >
        {/* 标题栏＝房间路径面包屑。固定宽度 + 首段/当前段压缩 + 中间省略，
            路径深度只影响 tooltip 与「位置」区内容，不影响控件尺寸。 */}
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <MapPin className="tm-icon text-[var(--color-accent)]" aria-hidden="true" />
          <div
            data-tm-canvas-status-title=""
            data-tm-room-path-full={path.full}
            title={path.full || '当前房间'}
            className="flex min-w-0 flex-1 items-center gap-1 text-[12px] leading-4"
          >
            <span className="max-w-[88px] shrink-0 truncate font-medium text-[var(--color-text-secondary)]">
              {path.lead || '知识库'}
            </span>
            {path.current && <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">/</span>}
            {path.hasMiddle && <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">… /</span>}
            {path.current && (
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--color-text)]">{path.current}</span>
            )}
          </div>
          <span
            data-tm-canvas-status-zoom=""
            className="shrink-0 font-medium tabular-nums tm-badge tm-badge--accent"
          >
            {zoomPercent}
          </span>
          {readOnlyState.readOnly && (
            <Lock className="tm-icon tm-icon--sm text-[var(--color-accent)]" aria-hidden="true" />
          )}
          <button
            type="button"
            data-tm-canvas-status-toggle=""
            data-tm-canvas-status-toggle-open={prefs.drawerOpen ? 'true' : 'false'}
            aria-expanded={prefs.drawerOpen}
            aria-label={prefs.drawerOpen ? '折叠画布状态面板' : '展开画布状态面板'}
            title={prefs.drawerOpen ? '折叠状态面板' : '展开状态面板'}
            onClick={() => setCanvasStatusDrawerOpen(!prefs.drawerOpen)}
            className="nodrag nowheel tm-icon-btn"
          >
            <ChevronDown
              className={`tm-icon transition-transform duration-150 ${prefs.drawerOpen ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* 节点移动历史：常驻工具条，抽屉整体折叠后仍可用。
            toast 的「撤销」6 秒后会自动消失，这里给一个不受时限、且能「前进」重做的入口。
            两个按钮 DOM 常驻，禁用时只置灰 + 改 tooltip，绝不条件卸载（GUI 回归读 data 属性）。 */}
        <div
          data-tm-move-history=""
          data-tm-move-history-undo-count={undoStack.length}
          data-tm-move-history-redo-count={redoStack.length}
          data-tm-move-history-busy={moveBusy ? 'true' : 'false'}
          data-tm-move-history-locked={readOnlyState.readOnly ? 'true' : 'false'}
          className="flex items-center gap-1 border-t border-[var(--color-border-light)] px-2.5 py-1.5"
        >
          <button
            type="button"
            data-tm-move-undo=""
            disabled={!canUndoMove}
            aria-label="撤销上一次节点移动"
            title={readOnlyState.readOnly ? '只读视图：回到 100% 解锁' : describeMoveEntry(undoEntry, 'undo')}
            onClick={onMoveUndo}
            className="nodrag nowheel min-w-0 flex-1 tm-btn"
          >
            <Undo2 className="tm-icon tm-icon--sm" aria-hidden="true" />
            <span className="truncate">撤销{undoStack.length > 0 ? ` ${undoStack.length}` : ''}</span>
          </button>
          <button
            type="button"
            data-tm-move-redo=""
            disabled={!canRedoMove}
            aria-label="前进重做节点移动"
            title={readOnlyState.readOnly ? '只读视图：回到 100% 解锁' : describeMoveEntry(redoEntry, 'redo')}
            onClick={onMoveRedo}
            className="nodrag nowheel min-w-0 flex-1 tm-btn"
          >
            <span className="truncate">前进{redoStack.length > 0 ? ` ${redoStack.length}` : ''}</span>
            <Redo2 className="tm-icon tm-icon--sm" aria-hidden="true" />
          </button>
        </div>

        {/* 抽屉主体：整体折叠只改高度/透明度，DOM 常驻；内部再按窗口高度滚动。 */}
        <div
          data-tm-canvas-status-body=""
          className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
            prefs.drawerOpen ? 'max-h-[760px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
          }`}
        >
          <div className="max-h-[min(620px,calc(100vh-140px))] overflow-y-auto border-t border-[var(--color-border-light)] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)]">
            {/* 功能区一：完整房间路径，逐段可跳转；长路径内部滚动，不撑高面板。 */}
            <CanvasStatusSection
              id="path"
              title="位置"
              badge={path.count > 0 ? `${path.count} 段` : undefined}
              open={sectionOpen('path')}
              onToggle={sectionToggle('path')}
            >
              <RoomPathList tabId={tabId} />
            </CanvasStatusSection>

            {/* 功能区二：镜头视图（比例尺 / 只读 / 图型 / 永久层数 / LOD 模式 / 置顶 / 总览）。 */}
            <CanvasStatusSection
              id="view"
              title="视图"
              badge={visibility.label}
              open={sectionOpen('view')}
              onToggle={sectionToggle('view')}
            >
              <div
                data-tm-zoom-control=""
                data-tm-zoom-max-percent={formatZoomPercent(MAX_RAW_ZOOM)}
                data-tm-zoom-min-percent={formatZoomPercent(MIN_RAW_ZOOM)}
                data-tm-zoom-at-max={atMaxZoom ? 'true' : 'false'}
                className="flex items-center gap-1"
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
                  className="nodrag nowheel tm-icon-btn tm-icon-btn--outlined"
                >
                  <Minus className="tm-icon tm-icon--sm" />
                </button>
                <button
                  type="button"
                  data-tm-zoom-reset=""
                  data-tm-zoom-percent={zoomPercent}
                  aria-label="回到 100% 常规视图"
                  title="点击回到 100% 常规视图（放大上限）"
                  onClick={() => { void reactFlow.zoomTo(ZOOM_REFERENCE, { duration: ZOOM_TRANSITION_MS }) }}
                  className="nodrag nowheel min-w-0 flex-1 tabular-nums font-medium tm-btn"
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
                  className="nodrag nowheel tm-icon-btn tm-icon-btn--outlined"
                >
                  <Plus className="tm-icon tm-icon--sm" />
                </button>
              </div>

              {/* 只读状态与 useGraph 写闸门同源：缩小 / 还有隐藏节点时整张画布禁写。 */}
              {readOnlyState.readOnly && (
                <div
                  data-tm-lod-readonly=""
                  className="mt-1.5 flex items-center gap-1.5 rounded-md bg-[var(--color-accent-soft)] px-1.5 py-1 text-[10px] font-medium text-[var(--color-accent)]"
                  title="缩小视图下画布信息失真，移动节点 / 连线、增删连线、重命名等编辑操作已全部停用"
                >
                  <Lock className="tm-icon tm-icon--sm" aria-hidden="true" />
                  <span className="min-w-0 flex-1">只读 · 回到 100% 解锁</span>
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">房间图型</span>
                <select
                  data-tm-graph-profile-select=""
                  aria-label="房间图型"
                  value={profileId}
                  onChange={(event) => onProfileChange(event.target.value as GraphProfileId)}
                  className="nodrag nowheel min-w-0 flex-1 tm-select"
                >
                  {GRAPH_PROFILE_DEFINITIONS.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>

              {/* 自定义永久显示层数：depth <= N 的全部树节点在任何镜头下都不渐隐，随时可改。 */}
              <div data-tm-lod-preserved-depth-row="" className="mt-1.5 flex items-center gap-1.5">
                <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">永久显示</span>
                <select
                  data-tm-lod-preserved-depth-select=""
                  aria-label="永久显示层级"
                  title="缩小到最远镜头也保留该深度以内的全部节点（树根算第 1 层），可随时变更"
                  value={visibility.preservedDepth}
                  onChange={(event) => onPreservedDepthChange(Number(event.target.value))}
                  className="nodrag nowheel min-w-0 flex-1 tm-select"
                >
                  {depthOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>

              {/* 20% 以下进入紧凑行程：可见集合冻结、文字保持可读，只让节点间距收紧。 */}
              {compactZoom && (
                <div
                  data-tm-lod-compact-hint=""
                  data-tm-lod-compact-glyph-held="true"
                  className="mt-1.5 flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] px-1.5 py-1 text-[10px] font-medium text-[var(--color-accent)]"
                  title={`${COMPACT_START_PERCENT}% 以下不再隐藏节点，标题文字保持可读；继续缩小只让图谱更紧凑，越接近 ${MIN_DISPLAY_PERCENT}% 幅度越小`}
                >
                  <Map className="tm-icon tm-icon--sm" aria-hidden="true" />
                  <span className="min-w-0 flex-1">紧凑镜头 · 节点冻结 · 文字保持</span>
                </div>
              )}

              <div className="mt-1.5 flex gap-1">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-tm-lod-mode={option.value}
                    aria-pressed={mode === option.value}
                    title={option.title}
                    onClick={() => onModeChange(option.value)}
                    className={mode === option.value ? 'flex-1 tm-btn tm-btn--active' : 'flex-1 tm-btn'}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  data-tm-lod-pin-toggle=""
                  disabled={!selectedNodeId}
                  title={selectedNodeId ? '把当前选中节点置顶（始终显示）' : '先选中一个节点'}
                  onClick={() => selectedNodeId && onTogglePin(selectedNodeId)}
                  className="flex-1 tm-btn"
                >
                  <Pin className="tm-icon tm-icon--sm" />
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
                    className="tm-btn tm-btn--ghost"
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
                className="nodrag nowheel mt-1.5 w-full tm-btn"
              >
                <Map className="tm-icon tm-icon--sm" />
                知识库总览
              </button>
            </CanvasStatusSection>

            {/* 功能区三：历史打开过的房间。 */}
            <CanvasStatusSection
              id="recent"
              title="最近打开"
              badge={recent.items.length > 0 ? recent.items.length : undefined}
              open={sectionOpen('recent')}
              onToggle={sectionToggle('recent')}
            >
              <RoomHistory items={recent.items} activePath={recent.activePath} onActivate={recent.onActivate} />
            </CanvasStatusSection>

            {/* 功能区四：诊断细节，默认收起，需要时一键展开。 */}
            <CanvasStatusSection
              id="details"
              title="诊断"
              badge={`隐藏 ${hiddenCount}`}
              open={sectionOpen('details')}
              onToggle={sectionToggle('details')}
            >
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
              <div
                data-tm-graph-profile-effective={effectiveProfileId}
                className="mt-0.5 text-[10px] leading-4 text-[var(--color-text-secondary)] opacity-80"
                title={profile.description}
              >
                {profileNote}
              </div>
              {profileSaveError && (
                <div data-tm-graph-profile-error="" className="mt-0.5 text-[10px] leading-4 text-[var(--color-danger)]">
                  图型保存失败：{profileSaveError}
                </div>
              )}

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
            </CanvasStatusSection>
          </div>
        </div>
      </div>
    </Panel>
  )
}
