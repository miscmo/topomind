export const PERFORMANCE_ACTION = '性能:记录'

export const PERFORMANCE_METRICS = {
  roomLoad: 'room_load',
  nodeSelect: 'node_select',
  detailRead: 'detail_read',
  detailSave: 'detail_save',
} as const

export type PerformanceMetricId = typeof PERFORMANCE_METRICS[keyof typeof PERFORMANCE_METRICS]

export interface PerformanceLogParams extends Record<string, unknown> {
  metric: PerformanceMetricId
  durationMs: number
  success?: boolean
}
