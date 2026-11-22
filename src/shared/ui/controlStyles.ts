/**
 * 统一控件契约（TS 侧入口）。
 *
 * 唯一视觉真源是 `src/styles/controls.css`；本文件只提供类型安全的类名引用，
 * **不要在这里写 Tailwind 字符串或颜色值**，否则又会出现第二份真源。
 *
 * 用法：
 *   import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
 *   <button className={tmUI('nodrag nowheel flex-1', TM_UI.button)} ... />
 *
 * 约定：
 *   - 布局类（宽高 / flex / margin / nodrag nowheel）留在组件里；
 *   - 视觉类一律取 TM_UI，交互态由 controls.css 统一提供；
 *   - 新增控件类型先加 .tm-* 类到 controls.css，再加同名常量到这里；
 *   - `scripts/verify-design-system.mts` 会校验两边一一对应，并拦截散落的
 *     硬编码颜色 / 圆角 / 阴影 / z-index。
 */
export const TM_UI = {
  surface: 'tm-surface',
  popover: 'tm-popover',
  menu: 'tm-menu',
  menuItem: 'tm-menu-item',
  button: 'tm-btn',
  buttonPrimary: 'tm-btn tm-btn--primary',
  buttonActive: 'tm-btn tm-btn--active',
  buttonGhost: 'tm-btn tm-btn--ghost',
  buttonPrimaryLg: 'tm-btn tm-btn--lg tm-btn--primary',
  iconButton: 'tm-icon-btn',
  iconButtonOutlined: 'tm-icon-btn tm-icon-btn--outlined',
  iconButtonRound: 'tm-icon-btn tm-icon-btn--round',
  iconButtonLg: 'tm-icon-btn tm-icon-btn--lg',
  pill: 'tm-pill',
  pillButton: 'tm-pill-btn',
  input: 'tm-input',
  select: 'tm-select',
  badge: 'tm-badge',
  badgeAccent: 'tm-badge tm-badge--accent',
  badgeDanger: 'tm-badge tm-badge--danger',
  badgeWarning: 'tm-badge tm-badge--warning',
  divider: 'tm-divider',
  sectionHeader: 'tm-section-header',
  label: 'tm-label',
  hint: 'tm-hint',
  scroll: 'tm-scroll',
  icon: 'tm-icon',
  iconSm: 'tm-icon tm-icon--sm',
  iconLg: 'tm-icon tm-icon--lg',
  tabStrip: 'tm-tab-strip',
  tab: 'tm-tab',
  tabActive: 'tm-tab tm-tab--active',
  tabIcon: 'tm-tab-icon',
  tabLabel: 'tm-tab-label',
  tabLabelFade: 'tm-tab-label tm-tab-label--fade',
  tabTrailing: 'tm-tab-trailing',
  tabDot: 'tm-tab-dot',
  tabClose: 'tm-tab-close',
  tabActionCount: 'tm-tab-action tm-tab-action--count',
  menuGroup: 'tm-menu-group',
  menuGroupTitle: 'tm-menu-group-title',
  tabMenuRow: 'tm-tab-menu-row',
  tabMenuLabel: 'tm-tab-menu-label',
} as const

export type TmUiToken = keyof typeof TM_UI

/** 轻量拼接：不用 cn/tailwind-merge，保证类名可静态扫描、门禁可校验。 */
export function tmUI(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
