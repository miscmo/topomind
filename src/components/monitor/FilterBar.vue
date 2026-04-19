<template>
  <div class="filter-bar">
    <!-- 关键词搜索 -->
    <div class="filter-group search-group">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        type="text"
        class="filter-input keyword-input"
        placeholder="搜索关键词（消息/动作/模块/函数）..."
        :value="keyword"
        @input="$emit('update:keyword', $event.target.value)"
        @keydown.enter="$emit('search')"
      />
    </div>

    <!-- 日期时间筛选 -->
    <div class="filter-group">
      <label class="filter-label">从</label>
      <input
        type="datetime-local"
        class="filter-input time-input"
        :value="startTime"
        @change="$emit('update:startTime', $event.target.value)"
      />
    </div>

    <div class="filter-group">
      <label class="filter-label">至</label>
      <input
        type="datetime-local"
        class="filter-input time-input"
        :value="endTime"
        @change="$emit('update:endTime', $event.target.value)"
      />
    </div>

    <!-- 日志等级 -->
    <div class="filter-group levels-group">
      <span class="filter-label">等级</span>
      <div class="checkbox-group">
        <label
          v-for="level in LEVELS"
          :key="level"
          class="checkbox-label"
          :class="'level-' + level.toLowerCase()"
        >
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="levels.includes(level)"
            @change="toggleLevel(level)"
          />
          <span class="level-text">{{ level }}</span>
        </label>
      </div>
    </div>

    <!-- 动作类型筛选 -->
    <div v-if="availableActions.length > 0" class="filter-group actions-group">
      <span class="filter-label">动作</span>
      <div class="checkbox-group scrollable">
        <label
          v-for="action in availableActions.slice(0, 20)"
          :key="action"
          class="checkbox-label"
        >
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="actions.includes(action)"
            @change="toggleAction(action)"
          />
          <span class="action-text">{{ action }}</span>
        </label>
      </div>
    </div>

    <!-- 重置按钮 -->
    <button class="reset-btn" @click="$emit('reset')" title="重置所有筛选条件">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']

const props = defineProps({
  keyword: { type: String, default: '' },
  startTime: { type: String, default: '' },
  endTime: { type: String, default: '' },
  levels: { type: Array, default: () => [] },
  actions: { type: Array, default: () => [] },
  modules: { type: Array, default: () => [] },
  availableActions: { type: Array, default: () => [] },
  availableModules: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'update:keyword',
  'update:startTime',
  'update:endTime',
  'update:levels',
  'update:actions',
  'update:modules',
  'search',
  'reset',
])

function toggleLevel(level) {
  const newLevels = props.levels.includes(level)
    ? props.levels.filter(l => l !== level)
    : [...props.levels, level]
  emit('update:levels', newLevels)
}

function toggleAction(action) {
  const newActions = props.actions.includes(action)
    ? props.actions.filter(a => a !== action)
    : [...props.actions, action]
  emit('update:actions', newActions)
}
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  background: #16162a;
  border-bottom: 1px solid #2a2a4a;
  min-height: 48px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-group {
  flex: 1;
  min-width: 240px;
  position: relative;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: #555570;
  pointer-events: none;
}

.keyword-input {
  width: 100%;
  padding-left: 32px !important;
}

.filter-label {
  font-size: 11px;
  color: #555570;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.filter-input {
  background: #1e1e38;
  border: 1px solid #2a2a50;
  border-radius: 5px;
  color: #c0c0d0;
  font-family: inherit;
  font-size: 12px;
  padding: 5px 10px;
  outline: none;
  transition: border-color 0.15s;
}

.filter-input:focus {
  border-color: #5c7cfa;
}

.filter-input::placeholder {
  color: #444460;
}

.time-input {
  width: 180px;
}

.levels-group {
  gap: 8px;
}

.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.checkbox-group.scrollable {
  max-width: 300px;
  overflow-x: auto;
  flex-wrap: nowrap;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  transition: background 0.15s;
}

.checkbox-label:hover {
  background: #2a2a50;
}

.checkbox-input {
  width: 13px;
  height: 13px;
  cursor: pointer;
  accent-color: #5c7cfa;
}

.level-text {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.level-debug .level-text { color: #888; }
.level-info .level-text { color: #5c9cfa; }
.level-warn .level-text { color: #f0a040; }
.level-error .level-text { color: #f06060; }

.level-debug:has(.checkbox-input:checked) { background: #2a2a3a; }
.level-info:has(.checkbox-input:checked) { background: #1a2a4a; }
.level-warn:has(.checkbox-input:checked) { background: #2a2a1a; }
.level-error:has(.checkbox-input:checked) { background: #2a1a1a; }

.action-text {
  color: #8080a0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  white-space: nowrap;
}

.checkbox-label:has(.checkbox-input:checked) .action-text {
  color: #a0a0c0;
}

.reset-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid #2a2a50;
  border-radius: 5px;
  background: transparent;
  color: #666680;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.reset-btn:hover {
  background: #2a2a50;
  color: #a0a0c0;
}
</style>
