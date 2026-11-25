import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { DefaultEdgeStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits, DefaultEditorStyle } from '../types/uiStoreTypes'
import { STYLE_CONFIG_DEFAULTS } from '../domain/style/styleDefaults'
import type { EdgeStylePatch, KnowledgeNodeStyle } from '../types'
import { normalizeEdgeRelationDefinitions, type EdgeRelationDefinition } from '../domain/graph/edgeRelations'
import { normalizeRoomProfiles, type GraphProfileId } from '../domain/graph/graphProfiles'

interface GraphUiStore {
  showGrid: boolean
  selectedEdgeId: string | null
  connectingSourceId: string | null
  connectingTargetId: string | null
  formatPainterStyle: KnowledgeNodeStyle | null
  /** 连线格式刷：激活时点击连线即把这份样式应用过去（与节点格式刷互斥） */
  edgeFormatPainterStyle: EdgeStylePatch | null
  /**
   * 是否正在缩放（不含平移）。缩放期间大量节点进出视口（实测 2~3 秒可达 1600+ 次
   * mount/unmount），让每个节点都只按最低细节渲染，能把这笔挂载成本压到最小。
   * 只在"开始缩放/结束缩放"各翻转一次，不是每帧变化。
   */
  isViewportZooming: boolean
  defaultEdgeStyle: DefaultEdgeStyle
  defaultNodeStyle: DefaultNodeStyle
  defaultNodeSize: DefaultNodeSize
  defaultEditorStyle: DefaultEditorStyle
  nodeSizeLimits: NodeSizeLimits
  nodeBadgeSize: number
  /** 全局连线关系定义（由 _config.json hydrate，不进 localStorage） */
  edgeRelations: EdgeRelationDefinition[]
  /** 是否在连线上显示关系名小标签 */
  showEdgeRelationLabels: boolean
  /** 拖动节点时的智能参考线 / 对齐吸附（关闭后完全自由摆放） */
  smartGuidesEnabled: boolean
  /** 房间图型（roomPath → id），由 _config.json hydrate，不进 localStorage */
  roomProfiles: Record<string, GraphProfileId>
  setSelectedEdgeId: (edgeId: string | null) => void
  setConnectingSourceId: (nodeId: string | null) => void
  setConnectingTargetId: (nodeId: string | null) => void
  setFormatPainterStyle: (style: KnowledgeNodeStyle | null) => void
  setEdgeFormatPainterStyle: (style: EdgeStylePatch | null) => void
  setViewportZooming: (isViewportZooming: boolean) => void
  setDefaultEdgeStyle: (style: Partial<DefaultEdgeStyle>) => void
  replaceDefaultEdgeStyle: (style: DefaultEdgeStyle) => void
  setDefaultNodeStyle: (style: Partial<DefaultNodeStyle>) => void
  replaceDefaultNodeStyle: (style: DefaultNodeStyle) => void
  setDefaultNodeSize: (size: Partial<DefaultNodeSize>) => void
  replaceDefaultNodeSize: (size: DefaultNodeSize) => void
  setDefaultEditorStyle: (style: Partial<DefaultEditorStyle>) => void
  replaceDefaultEditorStyle: (style: DefaultEditorStyle) => void
  setNodeSizeLimits: (limits: Partial<NodeSizeLimits>) => void
  replaceNodeSizeLimits: (limits: NodeSizeLimits) => void
  setNodeBadgeSize: (size: number) => void
  setEdgeRelations: (relations: EdgeRelationDefinition[]) => void
  setShowEdgeRelationLabels: (visible: boolean) => void
  setSmartGuidesEnabled: (enabled: boolean) => void
  setRoomProfiles: (profiles: Record<string, GraphProfileId>) => void
  resetGraphUi: () => void
}

export const GRAPH_UI_INITIAL_STATE: Pick<GraphUiStore, 'showGrid' | 'selectedEdgeId' | 'connectingSourceId' | 'connectingTargetId' | 'formatPainterStyle' | 'edgeFormatPainterStyle' | 'isViewportZooming' | 'defaultEdgeStyle' | 'defaultNodeStyle' | 'defaultNodeSize' | 'defaultEditorStyle' | 'nodeSizeLimits' | 'nodeBadgeSize' | 'edgeRelations' | 'showEdgeRelationLabels' | 'smartGuidesEnabled' | 'roomProfiles'> = {
  showGrid: true,
  selectedEdgeId: null,
  connectingSourceId: null,
  connectingTargetId: null,
  formatPainterStyle: null,
  edgeFormatPainterStyle: null,
  isViewportZooming: false,
  ...STYLE_CONFIG_DEFAULTS,
  edgeRelations: normalizeEdgeRelationDefinitions(undefined),
  showEdgeRelationLabels: true,
  smartGuidesEnabled: true,
  roomProfiles: {},
}

export const useGraphUiStore = create<GraphUiStore>()(
  persist(
    (set) => ({
      ...GRAPH_UI_INITIAL_STATE,
      setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
      setConnectingSourceId: (connectingSourceId) => set({ connectingSourceId }),
      setConnectingTargetId: (connectingTargetId) => set({ connectingTargetId }),
      setFormatPainterStyle: (formatPainterStyle) => set({ formatPainterStyle }),
      setEdgeFormatPainterStyle: (edgeFormatPainterStyle) => set({ edgeFormatPainterStyle }),
      setViewportZooming: (isViewportZooming) => set({ isViewportZooming }),
      setDefaultEdgeStyle: (style) => set((state) => ({
        defaultEdgeStyle: { ...state.defaultEdgeStyle, ...style },
      })),
      replaceDefaultEdgeStyle: (defaultEdgeStyle) => set({ defaultEdgeStyle }),
      setDefaultNodeStyle: (style) => set((state) => ({
        defaultNodeStyle: { ...state.defaultNodeStyle, ...style },
      })),
      replaceDefaultNodeStyle: (defaultNodeStyle) => set({ defaultNodeStyle }),
      setDefaultNodeSize: (size) => set((state) => ({
        defaultNodeSize: { ...state.defaultNodeSize, ...size },
      })),
      replaceDefaultNodeSize: (defaultNodeSize) => set({ defaultNodeSize }),
      setDefaultEditorStyle: (style) => set((state) => ({
        defaultEditorStyle: { ...state.defaultEditorStyle, ...style },
      })),
      replaceDefaultEditorStyle: (defaultEditorStyle) => set({ defaultEditorStyle }),
      setNodeSizeLimits: (limits) => set((state) => ({
        nodeSizeLimits: { ...state.nodeSizeLimits, ...limits },
      })),
      replaceNodeSizeLimits: (nodeSizeLimits) => set({ nodeSizeLimits }),
      setNodeBadgeSize: (nodeBadgeSize) => set({ nodeBadgeSize }),
      setEdgeRelations: (edgeRelations) => set({ edgeRelations: normalizeEdgeRelationDefinitions(edgeRelations) }),
      setShowEdgeRelationLabels: (showEdgeRelationLabels) => set({ showEdgeRelationLabels }),
      setSmartGuidesEnabled: (smartGuidesEnabled) => set({ smartGuidesEnabled }),
      setRoomProfiles: (roomProfiles) => set({ roomProfiles: normalizeRoomProfiles(roomProfiles) }),
      resetGraphUi: () => set({ ...GRAPH_UI_INITIAL_STATE }),
    }),
    {
      name: 'topomind-graph-ui-storage',
      storage: createJSONStorage(() => localStorage),
      // 缩略图显隐 / 尺寸偏好已随组件下线；这里只持久化仍存在的用户设置。
      partialize: (state) => ({
        smartGuidesEnabled: state.smartGuidesEnabled,
      }),
    }
  )
)
