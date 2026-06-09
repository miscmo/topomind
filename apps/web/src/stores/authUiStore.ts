import { create } from 'zustand'

export type AuthNoticeTone = 'info' | 'success' | 'warning'

interface AuthUiStore {
  noticeMessage: string
  noticeTone: AuthNoticeTone
  setAuthNotice: (input: { message: string; tone?: AuthNoticeTone }) => void
  clearAuthNotice: () => void
}

export const useAuthUiStore = create<AuthUiStore>((set) => ({
  noticeMessage: '',
  noticeTone: 'info',
  setAuthNotice: ({ message, tone = 'info' }) =>
    set({
      noticeMessage: message,
      noticeTone: tone,
    }),
  clearAuthNotice: () =>
    set({
      noticeMessage: '',
      noticeTone: 'info',
    }),
}))
