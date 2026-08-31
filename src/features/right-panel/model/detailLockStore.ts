import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface DetailLockStore {
  // 按知识库(kbPath)维度存储锁定节点：key = kbPath，value = 锁定的节点 id 或 null。
  // 这样不同知识库的锁定互不影响；切回某知识库时该库的锁定仍保留。
  lockedByKb: Record<string, string | null>
  // 在指定知识库锁定到指定节点
  lockNode: (kbPath: string, nodeId: string) => void
  // 解除指定知识的锁定
  unlock: (kbPath: string) => void
  // 切换：指定知识库已锁定时解锁；未锁定时若传入 nodeId 则锁定该节点
  toggleLock: (kbPath: string, nodeId: string | null) => void
}

export const useDetailLockStore = create<DetailLockStore>()(
  persist(
    (set) => ({
      lockedByKb: {},
      lockNode: (kbPath, nodeId) => {
        if (!kbPath || !nodeId) return
        set((state) => ({ lockedByKb: { ...state.lockedByKb, [kbPath]: nodeId } }))
      },
      unlock: (kbPath) => {
        if (!kbPath) return
        set((state) => ({ lockedByKb: { ...state.lockedByKb, [kbPath]: null } }))
      },
      toggleLock: (kbPath, nodeId) =>
        set((state) => {
          if (!kbPath) return state
          const current = state.lockedByKb[kbPath] ?? null
          // 已锁定 -> 解锁
          if (current) return { lockedByKb: { ...state.lockedByKb, [kbPath]: null } }
          // 未锁定且有目标节点 -> 锁定
          if (nodeId) return { lockedByKb: { ...state.lockedByKb, [kbPath]: nodeId } }
          // 未锁定且无目标节点 -> 不变
          return state
        }),
    }),
    {
      name: 'topomind-detail-lock-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ lockedByKb: state.lockedByKb }),
      // 旧版本持久化的是单一全局 lockedNodeId（无知识库维度），切换知识库会串扰；
      // 升级时直接丢弃旧的全局锁定，由各知识库重新按需锁定。
      migrate: () => ({ lockedByKb: {} } as DetailLockStore),
    },
  ),
)
