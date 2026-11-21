/**
 * 全局恰好一个活跃容器。刻意放在画布层的小 store 而不是节点 data：
 * 活跃态是纯 UI 状态，不落盘、不进 _graph.json、不触发图谱保存。
 */
import { create } from 'zustand'

interface ActiveContainerState {
  activeId: string | null
  activate: (id: string) => void
  deactivate: (id?: string) => void
}

export const useActiveContainerStore = create<ActiveContainerState>()((set, get) => ({
  activeId: null,
  activate: (id) => set({ activeId: id }),
  deactivate: (id) => {
    if (id && get().activeId !== id) return
    set({ activeId: null })
  },
}))

export function deactivateActiveContainer(id?: string): void {
  useActiveContainerStore.getState().deactivate(id)
}
