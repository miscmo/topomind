/**
 * 图谱引擎常量
 * 集中管理散落在 useGraph.js 等文件中的 magic numbers
 * 便于调优、修改和维护
 */

export const GraphConstants = {
  // ===== Cytoscape 实例池大小 =====
  CY_INSTANCE_POOL_SIZE: 4,

  // ===== 布局保存防抖 =====
  LAYOUT_SAVE_DEBOUNCE_MS: 300,

  // ===== 缩放范围 =====
  ZOOM_MIN: 0.15,
  ZOOM_MAX: 3.5,
  ZOOM_WHEEL_FACTOR: 1.08,

  // ===== 节点尺寸约束 =====
  NODE_WIDTH_MIN: 40,
  NODE_WIDTH_MAX: 1200,
  NODE_HEIGHT_MIN: 30,
  NODE_HEIGHT_MAX: 1200,

  // ===== 边的默认样式 =====
  EDGE_DEFAULT_LABEL: '相关',
  EDGE_COUNTER_INITIAL: 1,
  EDGE_COUNTER_CAP: 9999,

  // ===== 搜索相关 =====
  SEARCH_MIN_CHARS: 1,

  // ===== ELK 布局参数 =====
  ELK_NODE_SPACING: 40,
  ELK_PORT_SPACING: 80,
  ELK_PADDING_TOP: 40,
  ELK_PADDING_SIDES: 30,
  ELK_DIRECTION: 'DOWN',

  // ===== 视图操作 =====
  FIT_PADDING: 50,
  FIT_ANIMATION_DURATION_MS: 300,

  // ===== DOM 事件阈值 =====
  PAN_RIGHT_DRAG_THRESHOLD: 3, // 右键拖拽判定阈值(px)

  // ===== 节点默认尺寸 =====
  DEFAULT_NODE_WIDTH: 120,
  DEFAULT_NODE_HEIGHT: 60,

  // ===== 节点文字样式默认值 =====
  DEFAULT_FONT_SIZE: 12,
  DEFAULT_FONT_COLOR: '#fff',
  DEFAULT_TEXT_ALIGN: 'center',
  DEFAULT_TEXT_WRAP: true,

  // ===== 节点默认 z-index =====
  DEFAULT_Z_INDEX: 0,

  // ===== 图谱样式面板预设 =====
  GRAPH_STYLE_PRESETS: [
    { id: 'default', label: '默认' },
    { id: 'dark', label: '深色' },
    { id: 'light', label: '浅色' },
    { id: 'nature', label: '自然' },
    { id: 'neon', label: '霓虹' },
  ],

  // ===== 关系类型预设 =====
  RELATION_PRESETS: [
    { id: 'evolve', label: '演进', icon: 'arrow-up' },
    { id: 'depend', label: '依赖', icon: 'arrow-right' },
    { id: 'related', label: '相关', icon: 'minus' },
  ],
}
