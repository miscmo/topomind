/**
 * confirmStore — replaces window.confirm() in Electron renderer.
 * Usage:
 *   const confirmed = await useConfirmStore.getState().open({ title: '确认关闭？', message: '...' })
 *   if (confirmed) { ... }
 */
import { create } from 'zustand'

interface ConfirmState {
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  extraButtonText?: string
  onExtraAction?: () => void
  /** 主按钮语义：破坏性操作用 destructive（默认），纯提示用 default */
  confirmVariant?: 'default' | 'destructive'
  resolve: ((value: boolean) => void) | null
}

interface ConfirmActions {
  open: (options: { 
    title?: string; 
    message?: string;
    confirmText?: string;
    cancelText?: string;
    extraButtonText?: string;
    onExtraAction?: () => void;
    confirmVariant?: 'default' | 'destructive';
  }) => Promise<boolean>
  confirm: () => void
  cancel: () => void
}

type ConfirmStore = ConfirmState & ConfirmActions

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  visible: false,
  title: '确认',
  message: '',
  confirmText: undefined,
  cancelText: undefined,
  extraButtonText: undefined,
  onExtraAction: undefined,
  confirmVariant: 'destructive',
  resolve: null,

  open: ({ title = '确认', message = '', confirmText, cancelText, extraButtonText, onExtraAction, confirmVariant = 'destructive' } = {}) => {
    return new Promise<boolean>((resolve) => {
      const previousResolve = get().resolve
      previousResolve?.(false)
      set({ visible: true, title, message, confirmText, cancelText, extraButtonText, onExtraAction, confirmVariant, resolve })
    })
  },

  confirm: () => {
    const { resolve } = get()
    resolve?.(true)
    set({ visible: false, resolve: null })
  },

  cancel: () => {
    const { resolve } = get()
    resolve?.(false)
    set({ visible: false, resolve: null })
  },
}))
