/**
 * 画布状态抽屉（React Flow top-left Panel）：标题栏是常驻的可点击房间路径面包屑，
 * 抽屉里只保留「视图」与「最近打开」两块，外加一行选中节点深度。
 *
 * - 跳房间不需要展开抽屉：标题栏逐段可点，长路径在固定宽度内横向滚动。
 * - 标题不显示图比例；缩放控制归左下角按钮与缩放滑块，抽屉里不再重复一组。
 * - 层级诊断明细全部移除，只留「选中节点深度」；data-tm-lod-* 断言属性仍挂在根节点。
 * - 交互一律 nodrag / nowheel，避免被画布平移缩放手势抢走。
 */
import { Panel } from '@xyflow/react'
import { ChevronDown, Lock, Map, MapPin, Pin, Redo2, Undo2 } from 'lucide-react'
import {
  COMPACT_START_PERCENT,
  MIN_DISPLAY_PERCENT,
  isCompactZoom,
  zoomStepSensitivityForGraph,
} from '../../../../domain/graph/zoomScale'
import {
  LOD_DEFAULT_PRESERVED_DEPTH,
  LOD_MAX_PRESERVED_DEPTH,
  type LodMode,
  type LodSelectedNodeInfo,
  type LodVisibility,
} from '../../../../domain/graph/lod'
import type { CanvasReadOnlyState } from '../../../../domain/graph/canvasReadOnly'
import {
  GRAPH_PROFILE_DEFINITIONS,
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
import RoomPathBreadcrumb, { compactRoomPath, useRoomPathItems } from '../../../layout/Breadcrumb/Breadcrumb'
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
  /** raw 变换系数，只用于紧凑镜头判定，不再展示比例数值 */
  zoomLevel: number
  mode: LodMode
  /** 图型解析后的有效模式（用户手动 off/force 优先） */
  effectiveMode: LodMode
  policySource: 'user' | 'profile'
  profileId: GraphProfileId
  /** auto 解析后的实际图型，只作为断言属性暴露 */
  effectiveProfileId: ConcreteGraphProfileId
  /** 图型写盘失败原因，只作为断言属性暴露，不占可见空间 */
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

/** 诊断信息只保留一行：选中节点深度。 */
function selectedDepthText(node: LodSelectedNodeInfo | null): string {
  return node ? `选中节点深度 ${node.depth}` : '点选节点查看深度'
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

  const compactZoom = isCompactZoom(zoomLevel)
  // 固定步进灵敏度仍暴露给断言；缩放动作本身归左下角控件与滑块。
  const stepSensitivity = zoomStepSensitivityForGraph(
    visibility.totalNodeCount,
    visibility.treeMaxDepth,
  )
  // 偏好里可能存着面板当前没列出的层数（手工改过 localStorage），补一个选项避免 select 空白。
  const depthOptions = PRESERVED_DEPTH_OPTIONS.some((item) => item.value === visibility.preservedDepth)
    ? PRESERVED_DEPTH_OPTIONS
    : [{ value: visibility.preservedDepth, label: `${visibility.preservedDepth} 层` }, ...PRESERVED_DEPTH_OPTIONS]
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
        data-tm-graph-profile-effective={effectiveProfileId}
        data-tm-graph-profile-error={profileSaveError || ''}
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
        {/* 标题栏＝可点击的房间路径面包屑。不展开抽屉也能逐段跳转；长路径横向滚动。 */}
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <MapPin className="tm-icon text-[var(--color-accent)]" aria-hidden="true" />
          <div
            data-tm-canvas-status-title=""
            data-tm-room-path-full={path.full}
            title={path.full || '当前房间'}
            className="flex min-w-0 flex-1 items-center"
          >
            <RoomPathBreadcrumb tabId={tabId} />
          </div>
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
            {/* 功能区一：镜头视图（只读 / 图型 / 永久层数 / LOD 模式 / 置顶）。 */}
            <CanvasStatusSection
              id="view"
              title="视图"
              badge={visibility.label}
              open={sectionOpen('view')}
              onToggle={sectionToggle('view')}
            >
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

              <div className="flex items-center gap-1.5">
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
            </CanvasStatusSection>

            {/* 功能区二：历史打开过的房间。 */}
            <CanvasStatusSection
              id="recent"
              title="最近打开"
              badge={recent.items.length > 0 ? recent.items.length : undefined}
              open={sectionOpen('recent')}
              onToggle={sectionToggle('recent')}
            >
              <RoomHistory items={recent.items} activePath={recent.activePath} onActivate={recent.onActivate} />
            </CanvasStatusSection>

            {/* 诊断明细已移除，只留一行选中节点深度；属性仍挂在面板节点本身供 GUI 直读。 */}
            <div
              data-tm-lod-depth-panel=""
              data-tm-lod-tree-max-depth={visibility.treeMaxDepth}
              data-tm-lod-selected-depth={visibility.selectedNode?.depth ?? ''}
              data-tm-lod-selected-kind={visibility.selectedNode?.kind ?? ''}
              data-tm-lod-selected-reveal={visibility.selectedNode?.revealRatio ?? ''}
              className="border-t border-[var(--color-border-light)] px-2.5 py-1.5 tm-hint truncate"
              title={selectedDepthText(visibility.selectedNode)}
            >
              {selectedDepthText(visibility.selectedNode)}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
