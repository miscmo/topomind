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
  resolve: ((value: boolean) => void) | null
}

interface ConfirmActions {
  open: (options: { title?: string; message?: string }) => Promise<boolean>
  confirm: () => void
  cancel: () => void
}

type ConfirmStore = ConfirmState & ConfirmActions

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  visible: false,
  title: '确认',
  message: '',
  resolve: null,

  open: ({ title = '确认', message = '' } = {}) => {
    return new Promise<boolean>((resolve) => {
      set({ visible: true, title, message, resolve })
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
