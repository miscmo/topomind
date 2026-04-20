/**
 * TopoMind UI Constants & Design Tokens (TypeScript side)
 *
 * Mirrors the CSS custom properties defined in src/styles/tokens.css.
 * Keep in sync with tokens.css.
 *
 * CSS Variables (recommended for styling):
 *   import 'styles/tokens.css'
 *   color: var(--color-primary)
 *
 * TypeScript values (for logic):
 *   import { COLORS } from '@/types'
 *   const color = COLORS.primary
 */

/** 颜色方案 */
export const COLORS = {
  primary: '#1a3a5c',
  primaryHover: '#254d73',
  accent: '#3498db',
  pageBg: '#f0f2f5',
  panelBg: '#ffffff',
  canvasBg: '#eef0f4',
  textPrimary: '#2d3436',
  textSecondary: '#555555',
  border: '#e0e4ea',
  borderLight: '#e8ecf0',
  danger: '#e74c3c',
  dangerHover: '#c0392b',
  success: '#2ecc71',
  searchMatch: '#f1c40f',
  hoverHighlight: '#f39c12',
  edgeEvolution: '#5cb85c',
  edgeDepend: '#e8913a',
  edgeMinor: '#cccccc',
  gridDot: '#c8cdd6',
} as const

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
