/**
 * 软件明暗主题 → Excalidraw 外观的唯一映射。
 *
 * 关键约束（来自 @excalidraw/excalidraw 0.18 源码，别改路线）：
 * - `theme` prop 是**可响应的**：App.componentDidUpdate 里 `prevProps.theme !==
 *   this.props.theme` 会 setState，所以切换软件主题无需重挂编辑器实例。
 * - dark 模式的画布不是靠改 `viewBackgroundColor`，而是靠 CSS 规则
 *   `.excalidraw.theme--dark canvas { filter: invert(93%) hue-rotate(180deg) }`
 *   把整块画布（含白色背景、黑色线条）一起反转。因此**不要**把主题色写进
 *   appState.viewBackgroundColor：那会把 UI 偏好固化进文档，换主题 / 换设备打开
 *   就是错的，还会让每次切主题都把文档标脏。
 * - 只读预览用 exportToSvg 导出的是「浅色场景」，给预览容器套同一个 filter 就与
 *   编辑器画布逐像素一致；SVG 内容与主题无关，缓存键因此不需要带主题，切主题
 *   零重导出。
 */
import { isDarkTheme, useThemeStore, type ThemeMode } from '../../../stores/themeStore'

export type ExcalidrawColorMode = 'light' | 'dark'

/** 与 Excalidraw 内部 THEME_FILTER 保持一致（dist/dev/chunk-4FTI6OG3.js）。 */
export const EXCALIDRAW_DARK_CANVAS_FILTER = 'invert(93%) hue-rotate(180deg)'

/** 纯函数：静态门禁可直接核对映射，不依赖 DOM / React。 */
export function toExcalidrawColorMode(theme: ThemeMode): ExcalidrawColorMode {
  return isDarkTheme(theme) ? 'dark' : 'light'
}

/** 订阅软件主题；主题变化会让编辑器和预览同时换肤。 */
export function useExcalidrawColorMode(): ExcalidrawColorMode {
  return useThemeStore((state) => toExcalidrawColorMode(state.theme))
}

/** 预览容器在深色下需要的 CSS filter；浅色返回 undefined 以免多建合成层。 */
export function excalidrawPreviewFilter(mode: ExcalidrawColorMode): string | undefined {
  return mode === 'dark' ? EXCALIDRAW_DARK_CANVAS_FILTER : undefined
}
