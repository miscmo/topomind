<template>
  <footer class="status-bar">
    <div class="status-left">
      <span class="status-item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="count">{{ filteredCount.toLocaleString() }}</span>
        <span class="separator">/</span>
        <span class="count total">{{ totalCount.toLocaleString() }}</span>
        <span class="label">条日志</span>
      </span>

      <span v-if="filteredCount < totalCount" class="status-item filter-indicator">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        <span>已筛选</span>
      </span>
    </div>

    <div class="status-right">
      <span class="status-item buffer-indicator">
        <span class="buffer-dot" :class="bufferStatus"></span>
        <span>缓冲: {{ bufferSize }} 条</span>
      </span>

      <!-- 日志等级切换 -->
      <div class="level-switcher">
        <span class="switcher-label">显示等级</span>
        <div class="level-buttons">
          <button
            v-for="level in LEVELS"
            :key="level"
            class="level-btn"
            :class="[level.toLowerCase(), { active: currentLevel === level }]"
            @click="$emit('level-change', level)"
          >
            {{ level }}
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup>
import { computed } from 'vue'

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']

const props = defineProps({
  totalCount: { type: Number, default: 0 },
  filteredCount: { type: Number, default: 0 },
  currentLevel: { type: String, default: 'INFO' },
  bufferSize: { type: Number, default: 2000 },
})

defineEmits(['level-change'])

const bufferStatus = computed(() => {
  const ratio = props.filteredCount / props.bufferSize
  if (ratio > 0.9) return 'danger'
  if (ratio > 0.6) return 'warning'
  return 'ok'
})
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 36px;
  background: #141428;
  border-top: 1px solid #2a2a4a;
  font-size: 11px;
  color: #555570;
  flex-shrink: 0;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.count {
  color: #a0a0c0;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.count.total {
  color: #555570;
}

.separator {
  color: #333;
}

.filter-indicator {
  color: #f0a040;
}

.level-buttons {
  display: flex;
  gap: 2px;
}

.level-btn {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.3px;
  color: #444460;
}

.level-btn:hover {
  border-color: #3a3a50;
  color: #888;
}

.level-btn.active {
  border-color: currentColor;
}

.level-btn.debug.active { color: #888; background: #2a2a30; }
.level-btn.info.active { color: #5c9cfa; background: #1a2a4a; }
.level-btn.warn.active { color: #f0a040; background: #2a2a10; }
.level-btn.error.active { color: #f06060; background: #2a1a1a; }

.buffer-indicator {
  font-size: 11px;
}

.buffer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3a3a50;
}

.buffer-dot.ok { background: #4caf50; }
.buffer-dot.warning { background: #f0a040; }
.buffer-dot.danger { background: #f06060; }

.switcher-label {
  font-size: 10px;
  color: #444460;
  margin-right: 4px;
}
</style>
