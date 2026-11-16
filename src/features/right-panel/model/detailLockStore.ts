import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * 锁定的不只是一个裸 nodeId：nodeId 是房间内相对 id，脱离原房间就无法定位文档目录。
 * 必须同时带上锁定发生时的 roomPath（以及展示用的 label / childCount），
 * 这样在同一个知识库内切到别的房间后，右栏仍能按原房间路径读到锁定节点的文档。
 */
export interface DetailLockTarget {
  nodeId: string
  roomPath: string
  label: string
  childCount: number
}

interface DetailLockStore {
  // 按知识库(kbPath)维度存储锁定节点：key = kbPath，value = 锁定目标或 null。
  // 锁定在整个知识库内有效，切房间不清空，只有显式解锁才解除。
  lockedByKb: Record<string, DetailLockTarget | null>
  lockNode: (kbPath: string, target: DetailLockTarget) => void
  unlock: (kbPath: string) => void
  toggleLock: (kbPath: string, target: DetailLockTarget | null) => void
}

export const useDetailLockStore = create<DetailLockStore>()(
  persist(
    (set) => ({
      lockedByKb: {},
      lockNode: (kbPath, target) => {
        if (!kbPath || !target?.nodeId) return
        set((state) => ({ lockedByKb: { ...state.lockedByKb, [kbPath]: target } }))
      },
      unlock: (kbPath) => {
        if (!kbPath) return
        set((state) => ({ lockedByKb: { ...state.lockedByKb, [kbPath]: null } }))
      },
      toggleLock: (kbPath, target) =>
        set((state) => {
          if (!kbPath) return state
          const current = state.lockedByKb[kbPath] ?? null
          // 已锁定 -> 解锁
          if (current) return { lockedByKb: { ...state.lockedByKb, [kbPath]: null } }
          // 未锁定且有目标节点 -> 锁定
          if (target?.nodeId) return { lockedByKb: { ...state.lockedByKb, [kbPath]: target } }
          // 未锁定且无目标节点 -> 不变
          return state
        }),
    }),
    {
      name: 'topomind-detail-lock-storage',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      partialize: (state) => ({ lockedByKb: state.lockedByKb }),
      // v1 只存裸 nodeId，没有房间信息，跨房间必然解析到错误路径。
      // 升级时保留 nodeId 但 roomPath 留空：渲染侧仍按当前房间解析（旧行为），
      // 用户重新锁定一次即可获得跨房间能力。
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as DetailLockStore
        const old = (persisted as { lockedByKb?: Record<string, string | null> } | undefined)?.lockedByKb ?? {}
        const lockedByKb: Record<string, DetailLockTarget | null> = {}
        for (const [kbPath, nodeId] of Object.entries(old)) {
          lockedByKb[kbPath] = nodeId ? { nodeId, roomPath: '', label: '', childCount: 0 } : null
        }
        return { lockedByKb } as DetailLockStore
      },
    },
  ),
)
