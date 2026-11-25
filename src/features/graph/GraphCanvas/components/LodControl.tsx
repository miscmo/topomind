/**
 * 画布状态抽屉（React Flow top-left Panel）：标题栏是常驻的可点击房间路径面包屑，
 * 抽屉里只保留「最近打开」一块，外加一行选中节点深度与常驻的撤销 / 前进工具条。
 *
 * - 跳房间不需要展开抽屉：标题栏逐段可点，长路径在固定宽度内横向滚动。
 * - 标题不显示图比例；缩放控制归左下角按钮与缩放滑块，抽屉里不再重复一组。
 * - 【2026-11-25】「视图」配置项已整体迁入左栏「画布设置」页（CanvasViewSettings）：
 *   本抽屉回归纯状态展示，不再承载第二份控件。data-tm-lod-* 诊断属性仍挂在根节点。
 * - 层级诊断明细全部移除，只留「选中节点深度」；data-tm-lod-* 断言属性仍挂在根节点。
 * - 交互一律 nodrag / nowheel，避免被画布平移缩放手势抢走。
 */
import { Panel } from '@xyflow/react'
import { ChevronDown, Lock, MapPin, Redo2, Undo2 } from 'lucide-react'
import {
  COMPACT_START_PERCENT,
  isCompactZoom,
  zoomStepSensitivityForGraph,
} from '../../../../domain/graph/zoomScale'
import {
  type LodMode,
  type LodSelectedNodeInfo,
  type LodVisibility,
} from '../../../../domain/graph/lod'
import type { CanvasReadOnlyState } from '../../../../domain/graph/canvasReadOnly'
import {
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
  /** 图型解析后的有效模式（用户手动 off/force 优先），只作诊断属性 */
  effectiveMode: LodMode
  policySource: 'user' | 'profile'
  profileId: GraphProfileId
  /** auto 解析后的实际图型，只作为断言属性暴露 */
  effectiveProfileId: ConcreteGraphProfileId
  /** 常驻撤销 / 前进：跨房间移动历史，与成功 toast 的撤销共用同一入口 */
  onMoveUndo?: () => void
  onMoveRedo?: () => void
}

/** 诊断信息只保留一行：选中节点深度。 */
function selectedDepthText(node: LodSelectedNodeInfo | null): string {
  return node ? `选中节点深度 ${node.depth}` : '点选节点查看深度'
}

export default function LodControl({
  tabId,
  visibility,
  readOnlyState,
  zoomLevel,
  effectiveMode,
  policySource,
  profileId,
  effectiveProfileId,
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
            {/* 唯一功能区：历史打开过的房间。视图配置已迁入左栏「画布设置」页，
                抽屉不再重复渲染一套控件；data-tm-lod-* 诊断属性仍在根节点上。 */}
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
