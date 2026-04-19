<template>
  <div class="log-monitor-view">
    <!-- 左侧边栏 -->
    <LogPanel
      :active-panel="activePanel"
      @switch="activePanel = $event"
    />

    <!-- 主内容区 -->
    <div class="monitor-main">
      <!-- 筛选栏 -->
      <FilterBar
        v-if="activePanel === 'log'"
        v-model:keyword="filters.keyword"
        v-model:startTime="filters.startTime"
        v-model:endTime="filters.endTime"
        v-model:levels="filters.levels"
        v-model:actions="filters.actions"
        v-model:modules="filters.modules"
        :available-actions="availableActions"
        :available-modules="availableModules"
        @search="handleSearch"
        @reset="handleReset"
      />

      <!-- 日志表格 -->
      <LogTable
        v-if="activePanel === 'log'"
        :entries="filteredEntries"
        :expanded-id="expandedId"
        @toggle="toggleExpand"
      />

      <!-- 性能监控占位 -->
      <div v-else-if="activePanel === 'perf'" class="perf-placeholder">
        <div class="placeholder-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 3v18h18"/>
            <path d="M7 16l4-4 4 4 5-6"/>
          </svg>
        </div>
        <h3>性能监控</h3>
        <p>Phase 2 功能 — 敬请期待</p>
        <p class="sub">基于日志中的 perf:* 数据绘制实时图表</p>
      </div>

      <!-- 状态栏 -->
      <StatusBar
        v-if="activePanel === 'log'"
        :total-count="entries.length"
        :filtered-count="filteredEntries.length"
        :current-level="currentLevel"
        :buffer-size="bufferSize"
        @level-change="handleLevelChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import LogPanel from './LogPanel.vue'
import FilterBar from './FilterBar.vue'
import LogTable from './LogTable.vue'
import StatusBar from './StatusBar.vue'

// ============================================================
// 状态
// ============================================================

const activePanel = ref('log')

/** 所有日志条目（合并后的完整列表） */
const entries = ref([])

/** 展开详情的行 ID */
const expandedId = ref(null)

/** 当前日志等级 */
const currentLevel = ref('INFO')

/** 日志缓冲区大小上限（参考值） */
const bufferSize = 2000

/** 筛选条件 */
const filters = ref({
  keyword: '',
  startTime: '',
  endTime: '',
  levels: [],
  actions: [],
  modules: [],
})

// ============================================================
// 计算属性
// ============================================================

/** 从所有条目中提取可用的动作类型列表 */
const availableActions = computed(() => {
  const set = new Set()
  entries.value.forEach(e => { if (e.action) set.add(e.action) })
  return Array.from(set).sort()
})

/** 从所有条目中提取可用的模块列表 */
const availableModules = computed(() => {
  const set = new Set()
  entries.value.forEach(e => { if (e.module) set.add(e.module) })
  return Array.from(set).sort()
})

/** 根据筛选条件过滤日志条目 */
const filteredEntries = computed(() => {
  let result = entries.value

  // 关键词筛选（message / action / module / func）
  if (filters.value.keyword.trim()) {
    const kw = filters.value.keyword.toLowerCase()
    result = result.filter(e =>
      (e.message || '').toLowerCase().includes(kw) ||
      (e.action || '').toLowerCase().includes(kw) ||
      (e.module || '').toLowerCase().includes(kw) ||
      (e.func || '').toLowerCase().includes(kw)
    )
  }

  // 时间范围筛选
  if (filters.value.startTime) {
    result = result.filter(e => e.timestamp >= filters.value.startTime)
  }
  if (filters.value.endTime) {
    result = result.filter(e => e.timestamp <= filters.value.endTime)
  }

  // 日志等级筛选
  if (filters.value.levels.length > 0) {
    result = result.filter(e => filters.value.levels.includes(e.level))
  }

  // 动作类型筛选
  if (filters.value.actions.length > 0) {
    result = result.filter(e => filters.value.actions.includes(e.action))
  }

  // 模块筛选
  if (filters.value.modules.length > 0) {
    result = result.filter(e => filters.value.modules.includes(e.module))
  }

  return result
})

// ============================================================
// IPC 订阅
// ============================================================

/** 实时接收新日志条目 */
function handleLogEntry(entry) {
  // 追加到列表头部（最新的在前）
  entries.value = [entry, ...entries.value]
  // 限制总条目数，防止内存无限增长
  if (entries.value.length > bufferSize) {
    entries.value = entries.value.slice(0, bufferSize)
  }
}

// ============================================================
// 生命周期
// ============================================================

onMounted(async () => {
  // 加载初始缓冲区
  if (window.electronAPI) {
    try {
      const buffer = await window.electronAPI.invoke('log:getBuffer')
      // 缓冲区按时间顺序排列，新条目追加到头部
      entries.value = [...buffer].reverse()
    } catch (e) {
      console.error('[LogMonitorView] Failed to load buffer:', e)
    }

    // 订阅实时日志流
    window.electronAPI.send('log:subscribe')
    window.electronAPI.on('log:entry', handleLogEntry)
  }
})

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.off('log:entry', handleLogEntry)
    window.electronAPI.send('log:unsubscribe')
  }
})

// ============================================================
// 方法
// ============================================================

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function handleSearch() {
  // 筛选在 computed 中自动处理，触发重算
}

function handleReset() {
  filters.value = {
    keyword: '',
    startTime: '',
    endTime: '',
    levels: [],
    actions: [],
    modules: [],
  }
}

async function handleLevelChange(level) {
  currentLevel.value = level
  if (window.electronAPI) {
    await window.electronAPI.invoke('log:setLevel', level)
  }
}
</script>

<style scoped>
.log-monitor-view {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
}

.monitor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.perf-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
  gap: 8px;
}

.perf-placeholder .placeholder-icon {
  color: #444;
  margin-bottom: 8px;
}

.perf-placeholder h3 {
  font-size: 18px;
  font-weight: 500;
  color: #aaa;
  margin: 0;
}

.perf-placeholder p {
  margin: 0;
  font-size: 14px;
}

.perf-placeholder .sub {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}
</style>
