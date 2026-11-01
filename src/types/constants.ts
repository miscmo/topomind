/**
 * TopoMind UI Constants & Design Tokens (TypeScript side)
 *
 * Colors live ONLY in CSS custom properties (src/styles/tokens.css) so they can
 * follow the theme. Read them with `getComputedStyle`/`var(--color-*)` rather
 * than duplicating hex values here — a second copy silently drifts out of sync
 * (the old COLORS map did exactly that: it still held the retired navy brand).
 *
 * This file therefore only holds NON-color values (zoom limits, sizing, ...).
 */

/** 布局常量 */
export const LAYOUT = {
  MIN_ZOOM: 0.15,
  MAX_ZOOM: 3.5,
  WHEEL_SENSITIVITY: 0.2,
  GLOBAL_DIRECTION: 'RIGHT' as const,
  ROOM_DIRECTION: 'DOWN' as const,
  BASE_SPACING: 70,
  MIN_SPACING: 30,
} as const

/** 尺寸常量 */
export const SIZES = {
  LEFT_PANEL_WIDTH: 200,
  RIGHT_PANEL_WIDTH: 320,
  RIGHT_PANEL_MIN: 180,
  RIGHT_PANEL_MAX: 600,
  GRID_SMALL: 20,
  GRID_LARGE: 100,
  HEADER_HEIGHT: 44,
  TOOLBAR_HEIGHT: 40,
} as const

/** 领域颜色池（循环分配给顶层节点） */
export const DOMAIN_COLORS = [
  '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  '#16a085', '#c0392b', '#8e44ad', '#27ae60',
] as const
