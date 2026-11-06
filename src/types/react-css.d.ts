import 'react'

declare module 'react' {
  interface CSSProperties {
    /** Electron 无边框窗口的拖拽区域标记；React 的 CSSProperties 未内置该属性。 */
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
