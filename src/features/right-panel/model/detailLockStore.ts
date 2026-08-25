import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface DetailLockStore {
  // 锁定的节点 id；为 null 表示未锁定（右栏内容与选中节点保持一致）
  lockedNodeId: string | null
  // 锁定到指定节点
  lockNode: (nodeId: string) => void
  // 解锁
  unlock: () => void
  // 切换：已锁定时解锁；未锁定时若传入 nodeId 则锁定该节点
  toggleLock: (nodeId: string | null) => void
}

export const useDetailLockStore = create<DetailLockStore>()(
  persist(
    (set) => ({
      lockedNodeId: null,
      lockNode: (nodeId) => {
        if (!nodeId) return
        set({ lockedNodeId: nodeId })
      },
      unlock: () => set({ lockedNodeId: null }),
      toggleLock: (nodeId) =>
        set((state) => {
          // 已锁定 -> 解锁
          if (state.lockedNodeId) return { lockedNodeId: null }
          // 未锁定且有目标节点 -> 锁定
          if (nodeId) return { lockedNodeId: nodeId }
          // 未锁定且无目标节点 -> 不变
          return state
        }),
    }),
    {
      name: 'topomind-detail-lock-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
