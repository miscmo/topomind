/**
 * 画布「视图」配置（原画布状态抽屉 view 分区，2026-11-25 迁入左栏画布设置页）。
 *
 * 【为什么能搬】这里没有第二份画布状态：所有可写项本来就落在全局偏好或工作区配置里
 *  - LOD 模式 / 永久显示层数 / 置顶 → lodPreferences（localStorage，按房间隔离）
 *  - 房间图型 → graphUiStore.roomProfiles（_config.json，按房间隔离）
 *  - 选中节点 → graphStore；只读态 → canvasReadOnlyStore；紧凑镜头 → React Flow viewport
 * 画布实例只负责消费这些偏好，控件放抽屉还是左栏，写的是同一份数据。
 *
 * 【稳定性】data-tm-* 选择器全部沿用旧名：GUI 回归对图型 / 层数 / 模式 / 置顶的
 * 点击与读数不需要重写，只要先把左栏切到画布设置页即可。
 */
import { memo, useCallback, useState } from 'react'
import { useStore } from '@xyflow/react'
import { Lock, Map, Pin } from 'lucide-react'
import { useStorage } from '@/core/storage'
import { useGraphUiStore } from '@/stores/graphUiStore'
import { useGraphStore, useGraphStoreApi } from '@/stores/graphStore'
import { useActiveCanvasReadOnly } from '@/stores/canvasReadOnlyStore'
import { useGraphSession } from '@/stores/tabs/tabStore'
import {
  GRAPH_PROFILE_DEFINITIONS,
  normalizeGraphProfileId,
  type GraphProfileId,
} from '@/domain/graph/graphProfiles'
import {
  LOD_DEFAULT_PRESERVED_DEPTH,
  LOD_MAX_PRESERVED_DEPTH,
  type LodMode,
} from '@/domain/graph/lod'
import {
  COMPACT_START_PERCENT,
  MIN_DISPLAY_PERCENT,
  isCompactZoom,
} from '@/domain/graph/zoomScale'
import {
  clearPinned,
  prunePinned,
  setLodMode,
  setLodPreservedDepth,
  togglePinned,
  useLodPreferences,
} from '@/features/graph/GraphCanvas/model/lodPreferences'

const EMPTY_IDS: readonly string[] = []

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

const ROW = 'flex items-center gap-2'
const ROW_LABEL = 'tm-label w-[56px] shrink-0'

export default memo(function CanvasViewSettings({ tabId }: { tabId: string }) {
  // 与 GraphCanvas 的 currentRoom / useSemanticLod 的 roomPath 严格同源：
  // 房间根用 tabId 兜底，否则 pin 与图型会写进另一个 key，出现「改了没反应」。
  const roomPath = useGraphSession(tabId)?.roomPath ?? ''
  const roomKey = roomPath || tabId

  const storage = useStorage()
  const graphStoreApi = useGraphStoreApi()
  const prefs = useLodPreferences()
  const profileId = useGraphUiStore((s) => normalizeGraphProfileId(s.roomProfiles[roomKey]))
  const setRoomProfiles = useGraphUiStore((s) => s.setRoomProfiles)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  // 与旧状态抽屉的 pinTarget 等价：store 选中态为空时回退到 React Flow 的 .selected，
  // 两者本就是同一份选中态的两个视图，避免「画布里选中了、置顶按钮却禁用」。
  const fallbackSelectedNodeId = useStore((s) => s.nodes.find((node) => node.selected)?.id ?? null)
  const pinTarget = selectedNodeId ?? fallbackSelectedNodeId
  const readOnly = useActiveCanvasReadOnly()
  // 只订阅布尔：缩放每帧改 transform，但跨过紧凑阈值才触发一次重渲染。
  const compactZoom = useStore((s) => isCompactZoom(s.transform[2]))
  const [profileSaveError, setProfileSaveError] = useState('')

  const pinnedIds = prefs.pinnedByRoom[roomKey] ?? EMPTY_IDS
  const isSelectedPinned = !!pinTarget && pinnedIds.includes(pinTarget)

  const handleProfileChange = useCallback((next: GraphProfileId) => {
    const normalized = normalizeGraphProfileId(next)
    // read-modify-write：从最新 store 取，避免快速切换时覆盖别的房间。
    const map = { ...useGraphUiStore.getState().roomProfiles, [roomKey]: normalized }
    setRoomProfiles(map)
    setProfileSaveError('')
    void storage.writeConfig({ roomProfiles: map }).catch((error) => {
      setProfileSaveError(error instanceof Error ? error.message : String(error))
    })
  }, [roomKey, setRoomProfiles, storage])

  const handleTogglePin = useCallback((nodeId: string) => {
    togglePinned(roomKey, nodeId)
    // 与画布一致：置顶时顺手剪掉已删除节点的 id，避免偏好无限膨胀。
    prunePinned(roomKey, new Set(graphStoreApi.getState().nodesMap.keys()))
  }, [roomKey, graphStoreApi])

  const handleClearPin = useCallback(() => clearPinned(roomKey), [roomKey])

  // 偏好里可能存着面板当前没列出的层数（手工改过 localStorage），补一个选项避免 select 空白。
  const depthOptions = PRESERVED_DEPTH_OPTIONS.some((item) => item.value === prefs.preservedDepth)
    ? PRESERVED_DEPTH_OPTIONS
    : [{ value: prefs.preservedDepth, label: `${prefs.preservedDepth} 层` }, ...PRESERVED_DEPTH_OPTIONS]

  return (
    <div
      id="view"
      data-tm-canvas-view-settings=""
      data-tm-graph-profile-error={profileSaveError || ''}
      className="flex flex-col gap-2"
    >
      {readOnly && (
        <div
          data-tm-lod-readonly=""
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent-soft)] px-2 py-1.5 font-medium text-[var(--color-accent)]"
          style={{ fontSize: 'var(--font-size-xs)' }}
          title="缩小视图下画布信息失真，移动节点 / 连线、增删连线、重命名等编辑操作已全部停用"
        >
          <Lock className="tm-icon tm-icon--sm" aria-hidden="true" />
          <span className="min-w-0 flex-1">只读 · 回到 100% 解锁</span>
        </div>
      )}

      <div className={ROW}>
        <span className={ROW_LABEL}>房间图型</span>
        <select
          data-tm-graph-profile-select=""
          aria-label="房间图型"
          value={profileId}
          onChange={(event) => handleProfileChange(event.target.value as GraphProfileId)}
          className="min-w-0 flex-1 tm-select"
        >
          {GRAPH_PROFILE_DEFINITIONS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
      {/* 图型当前是自动推断还是用户指定：纯状态提示，真实生效图型仍由抽屉诊断属性暴露。 */}
      <div data-tm-graph-profile-status="" className="tm-hint">
        {profileId === 'auto'
          ? '自动识别 · 按房间结构推断，可在下方切换 LOD 模式'
          : `已指定 · ${GRAPH_PROFILE_DEFINITIONS.find((item) => item.id === profileId)?.label ?? profileId}`}
      </div>

      <div data-tm-lod-preserved-depth-row="" className={ROW}>
        <span className={ROW_LABEL}>永久显示</span>
        <select
          data-tm-lod-preserved-depth-select=""
          aria-label="永久显示层级"
          title="缩小到最远镜头也保留该深度以内的全部节点（树根算第 1 层），可随时变更"
          value={prefs.preservedDepth}
          onChange={(event) => setLodPreservedDepth(Number(event.target.value))}
          className="min-w-0 flex-1 tm-select"
        >
          {depthOptions.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>

      {compactZoom && (
        <div
          data-tm-lod-compact-hint=""
          data-tm-lod-compact-glyph-held="true"
          className="flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] px-2 py-1.5 font-medium text-[var(--color-accent)]"
          style={{ fontSize: 'var(--font-size-xs)' }}
          title={`${COMPACT_START_PERCENT}% 以下不再隐藏节点，标题文字保持可读；继续缩小只让图谱更紧凑，越接近 ${MIN_DISPLAY_PERCENT}% 幅度越小`}
        >
          <Map className="tm-icon tm-icon--sm" aria-hidden="true" />
          <span className="min-w-0 flex-1">紧凑镜头 · 节点冻结 · 文字保持</span>
        </div>
      )}

      <div className="flex gap-1">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            data-tm-lod-mode={option.value}
            aria-pressed={prefs.mode === option.value}
            title={option.title}
            onClick={() => setLodMode(option.value)}
            className={prefs.mode === option.value ? 'flex-1 tm-btn tm-btn--active' : 'flex-1 tm-btn'}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={ROW}>
        <button
          type="button"
          data-tm-lod-pin-toggle=""
          disabled={!pinTarget}
          title={pinTarget ? '把当前选中节点置顶（始终显示）' : '先选中一个节点'}
          onClick={() => pinTarget && handleTogglePin(pinTarget)}
          className="min-w-0 flex-1 tm-btn"
        >
          <Pin className="tm-icon tm-icon--sm" />
          {isSelectedPinned ? '取消置顶' : '置顶选中'}
        </button>
        <span data-tm-lod-pinned-count="" className="min-w-[20px] text-center text-[var(--color-text-secondary)]" style={{ fontSize: 'var(--font-size-xs)' }}>
          {pinnedIds.length}
        </span>
        {pinnedIds.length > 0 && (
          <button
            type="button"
            data-tm-lod-pin-clear=""
            title="清除本房间全部置顶"
            onClick={handleClearPin}
            className="tm-btn tm-btn--ghost"
          >
            清除
          </button>
        )}
      </div>

      {profileSaveError && (
        <div className="rounded-md bg-[var(--color-danger-soft)] px-2 py-1.5 text-[var(--color-danger)]" style={{ fontSize: 'var(--font-size-xs)' }}>
          图型保存失败：{profileSaveError}
        </div>
      )}
    </div>
  )
})
