import { create } from 'zustand'

export type ToastLevel = 'info' | 'warn' | 'error'

export interface ToastItem {
  id: string
  level: ToastLevel
  title: string
  message?: string
  /** 可选的右上角操作按钮（如「撤销」）。 */
  action?: { label: string; onClick: () => void }
  /** 自动关闭时长（ms）；0 表示常驻，需手动关闭。 */
  duration: number
}

interface ToastState {
  toasts: ToastItem[]
  pushToast: (toast: { level?: ToastLevel; title: string; message?: string; action?: { label: string; onClick: () => void }; duration?: number }) => string
  dismissToast: (id: string) => void
}

let toastSeq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  // action 必须原样带进 toast：Toaster 会渲染它（如「撤销」）。
  // 早期实现解构时漏掉 action，导致所有带撤销入口的 toast 按钮从未显示。
  pushToast: ({ level = 'info', title, message, action, duration = 5000 }) => {
    const id = `toast-${++toastSeq}`
    set((state) => ({ toasts: [...state.toasts, { id, level, title, message, action, duration }] }))
    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

/** 命令式入口，供非组件代码（如 model hook）调用。 */
export function toast(input: { level?: ToastLevel; title: string; message?: string; action?: { label: string; onClick: () => void }; duration?: number }): string {
  return useToastStore.getState().pushToast(input)
}
