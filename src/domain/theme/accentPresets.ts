/**
 * 应用全局主题色 · 预设色板（数据层）
 *
 * 色值字面量只允许留在数据层（与 documentMeta.ts 的文档色板同一约定），
 * .tsx / 组件里不得再抄一份 hex。所有预设都刻意选在低饱和 / 中低明度区间，
 * 换上后与「单色制」的克制观感一致；过亮 / 过艳的自定义色由
 * harmonizeAccentColor() 自动收敛，见 accentColor.ts。
 */
export interface AccentPreset {
  id: string
  name: string
  hex: string
}

/**
 * 第一项必须是默认品牌色：设置页用它作为「恢复默认」的落点。
 * 每个值都是 harmonizeAccentColor() 的不动点（已按饱和度 / 明度 / 白字对比度校准过），
 * 这样色板上看到的颜色 === 全软件实际生效的颜色，不会出现「选了 A 显示 B」。
 */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'blue', name: '经典蓝', hex: '#0969da' },
  { id: 'indigo', name: '靛青', hex: '#3c45c3' },
  { id: 'violet', name: '紫罗兰', hex: '#743fc0' },
  { id: 'teal', name: '青碧', hex: '#12828c' },
  { id: 'green', name: '松绿', hex: '#268740' },
  { id: 'amber', name: '赭橙', hex: '#a85b12' },
  { id: 'rose', name: '绛红', hex: '#b83a4b' },
  { id: 'slate', name: '石板', hex: '#495b79' },
]
