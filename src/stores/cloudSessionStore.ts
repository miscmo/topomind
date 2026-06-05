import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface CloudUserSummary {
  id: string
  email: string
  displayName: string
}

export interface CloudSessionState {
  accessToken: string | null
  refreshToken: string | null
  user: CloudUserSummary | null
  setSession: (session: {
    accessToken: string
    refreshToken: string
    user: CloudUserSummary
  }) => void
  clearSession: () => void
}

const CLOUD_SESSION_STORAGE_KEY = 'topomind_cloud_session'

export const useCloudSessionStore = create<CloudSessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: ({ accessToken, refreshToken, user }) =>
        set({
          accessToken,
          refreshToken,
          user,
        }),
      clearSession: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
        }),
    }),
    {
      name: CLOUD_SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
