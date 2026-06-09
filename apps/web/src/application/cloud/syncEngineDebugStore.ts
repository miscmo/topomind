import { create } from 'zustand'

export interface CloudSyncEngineDebugState {
  status: 'disabled' | 'idle' | 'running'
  inFlight: boolean
  currentWorkspaceId: string | null
  lastTriggerReason: string | null
  lastWakeAt: string | null
  lastCycleStartedAt: string | null
  lastCycleFinishedAt: string | null
  lastPushStartedAt: string | null
  lastPushFinishedAt: string | null
  lastPullStartedAt: string | null
  lastPullFinishedAt: string | null
  lastPushedCount: number
  lastPulledCount: number
  pushError: string
  pullError: string
  syncError: string
}

interface CloudSyncEngineDebugStore extends CloudSyncEngineDebugState {
  patch: (partial: Partial<CloudSyncEngineDebugState>) => void
  reset: () => void
}

const INITIAL_STATE: CloudSyncEngineDebugState = {
  status: 'disabled',
  inFlight: false,
  currentWorkspaceId: null,
  lastTriggerReason: null,
  lastWakeAt: null,
  lastCycleStartedAt: null,
  lastCycleFinishedAt: null,
  lastPushStartedAt: null,
  lastPushFinishedAt: null,
  lastPullStartedAt: null,
  lastPullFinishedAt: null,
  lastPushedCount: 0,
  lastPulledCount: 0,
  pushError: '',
  pullError: '',
  syncError: '',
}

export const useCloudSyncEngineDebugStore = create<CloudSyncEngineDebugStore>((set) => ({
  ...INITIAL_STATE,
  patch: (partial) => set((state) => ({ ...state, ...partial })),
  reset: () => set({ ...INITIAL_STATE }),
}))
