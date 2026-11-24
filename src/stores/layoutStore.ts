/**
 * 全局导航层状态
 *
 * 设计契约：这里的任何状态都**不参与画布布局计算**。
 * NavRail 是 App 层的 absolute 浮层，画布仍是
 * `#graph-panel { absolute inset-0 isolate }`，宽度与 React Flow Panel 定位恒定。
 *
 * 导航栏显隐收敛为**单一全局二态** `railVisible`。二级面板与临时视图态已移除；
 * 唯一控制入口是顶部标题栏的按钮，任何视图下都生效。
 */
import { create } from 'zustand'
import { attachStateObservation } from '../core/observabilityStoreMiddleware.ts'

const STORAGE_KEY = 'topomind_navigation_v2'
/** 旧版偏好的 key，仅用于一次性迁移，迁移后不再写入。 */
const LEGACY_STORAGE_KEY = 'topomind_navigation_v1'

interface PersistedNavigation {
  /** 全局导航栏是否显示。true = 所有视图（含画布）都显示 48px 浮层。 */
  railVisible: boolean
}

const INITIAL_PERSISTED: PersistedNavigation = {
  railVisible: true,
}

function readLegacyRailVisible(): boolean {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as { railMode?: unknown }
    return parsed.railMode === 'hidden' ? false : true
  } catch {
    return true
  }
}

function readPersisted(): PersistedNavigation {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...INITIAL_PERSISTED, railVisible: readLegacyRailVisible() }
    }
    const parsed = JSON.parse(raw) as Partial<PersistedNavigation>
    return {
      railVisible: typeof parsed.railVisible === 'boolean' ? parsed.railVisible : INITIAL_PERSISTED.railVisible,
    }
  } catch {
    return { ...INITIAL_PERSISTED }
  }
}

function persist(state: PersistedNavigation): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式 / 配额不足时退化为内存态，不影响功能
  }
}

interface LayoutStore extends PersistedNavigation {
  setRailVisible: (value: boolean) => void
  toggleRailVisible: () => void
  resetNavigation: () => void
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  ...readPersisted(),
  setRailVisible: (railVisible) => {
    set({ railVisible })
    persist({ railVisible })
  },
  toggleRailVisible: () => get().setRailVisible(!get().railVisible),
  resetNavigation: () => {
    set({ ...INITIAL_PERSISTED })
    persist(INITIAL_PERSISTED)
  },
}))

// P7 M3：导航布局持久化状态变更自动补一条内存步骤（不落盘）。
attachStateObservation(useLayoutStore, { name: 'layout' })
