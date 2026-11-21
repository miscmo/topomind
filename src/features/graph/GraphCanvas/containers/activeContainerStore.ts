/**
 * 全屏容器编辑会话：全局恰好一个，且只属于打开它的那个标签页。
 *
 * 会话是纯 UI 状态，不落盘、不进 _graph.json、不触发图谱保存。
 * 与 v1.3 的差别：编辑不再发生在节点内部，节点只是只读预览，所以会话必须携带
 * 宿主读写载荷所需的完整上下文（tabId / cardPath / documentId / containerType）。
 *
 * revision 是「全屏宿主已成功落盘」的信号：节点订阅它，在退出编辑后重读一次
 * 磁盘并重建 SVG 预览。编辑期间节点不读盘，避免 400ms debounce 打成无效 IO。
 */
import { create } from 'zustand'

export interface ActiveContainerSession {
  nodeId: string
  tabId: string
  cardPath: string
  documentId: string
  containerType: string
  title: string
}

interface ActiveContainerState {
  session: ActiveContainerSession | null
  revision: number
  activate: (session: ActiveContainerSession) => void
  deactivate: (nodeId?: string) => void
  bumpRevision: () => void
}

export const useActiveContainerStore = create<ActiveContainerState>()((set, get) => ({
  session: null,
  revision: 0,
  activate: (session) => set({ session }),
  deactivate: (nodeId) => {
    const current = get().session
    if (nodeId && current?.nodeId !== nodeId) return
    if (!current) return
    set({ session: null })
  },
  bumpRevision: () => set((state) => ({ revision: state.revision + 1 })),
}))

export function deactivateActiveContainer(nodeId?: string): void {
  useActiveContainerStore.getState().deactivate(nodeId)
}

export function getActiveContainerSession(): ActiveContainerSession | null {
  return useActiveContainerStore.getState().session
}
