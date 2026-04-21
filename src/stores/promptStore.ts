/**
 * Global prompt modal state — accessed via useAppStore.getState().prompt()
 * The PromptModal component is rendered in App.tsx and reads from this store.
 */
import { create } from 'zustand'

interface PromptState {
  visible: boolean
  title: string
  placeholder: string
  defaultValue: string
  resolve: ((value: string | null) => void) | null
}

interface PromptActions {
  open: (options: { title?: string; placeholder?: string; defaultValue?: string }) => Promise<string | null>
  close: (value: string | null) => void
}

type PromptStore = PromptState & PromptActions

export const usePromptStore = create<PromptStore>((set, get) => ({
  visible: false,
  title: '输入',
  placeholder: '',
  defaultValue: '',
  resolve: null,

  open: ({ title = '输入', placeholder = '', defaultValue = '' } = {}) => {
    return new Promise<string | null>((resolve) => {
      set({ visible: true, title, placeholder, defaultValue, resolve })
    })
  },

  close: (value: string | null) => {
    const { resolve } = get()
    resolve?.(value)
    set({ visible: false, resolve: null })
  },
}))
