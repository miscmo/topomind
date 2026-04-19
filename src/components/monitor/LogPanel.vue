<template>
  <aside class="log-panel">
    <div class="panel-header">
      <span class="panel-title">监控中心</span>
    </div>

    <nav class="panel-nav">
      <button
        class="nav-item"
        :class="{ active: activePanel === 'log' }"
        @click="$emit('switch', 'log')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <span>日志监控</span>
        <span class="badge" :title="'实时流: ' + entryCount + ' 条'">{{ entryCount > 999 ? '999+' : entryCount }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: activePanel === 'perf' }"
        @click="$emit('switch', 'perf')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span>性能监控</span>
        <span class="badge soon">Phase 2</span>
      </button>
    </nav>

    <div class="panel-footer">
      <div class="footer-info">
        <span class="label">缓冲</span>
        <span class="value">2000 条</span>
      </div>
      <div class="footer-info">
        <span class="label">格式</span>
        <span class="value">JSON Lines</span>
      </div>
    </div>
  </aside>
</template>

<script setup>
defineProps({
  activePanel: {
    type: String,
    default: 'log',
  },
  entryCount: {
    type: Number,
    default: 0,
  },
})

defineEmits(['switch'])
</script>

<style scoped>
.log-panel {
  width: 200px;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  background: #16162a;
  border-right: 1px solid #2a2a4a;
  overflow: hidden;
}

.panel-header {
  padding: 16px 16px 12px;
  border-bottom: 1px solid #2a2a4a;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #c0c0d0;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.panel-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 2px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8888a0;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  position: relative;
}

.nav-item:hover {
  background: #1e1e3a;
  color: #b0b0c8;
}

.nav-item.active {
  background: #252550;
  color: #e0e0f0;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  background: #5c7cfa;
  border-radius: 0 2px 2px 0;
}

.nav-item svg {
  flex-shrink: 0;
  opacity: 0.7;
}

.nav-item.active svg {
  opacity: 1;
}

.nav-item span {
  flex: 1;
}

.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  background: #2a2a50;
  color: #8888b0;
  font-weight: 500;
}

.badge.soon {
  background: #2a2a40;
  color: #666680;
}

.panel-footer {
  padding: 12px 16px;
  border-top: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.footer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-info .label {
  font-size: 11px;
  color: #555570;
}

.footer-info .value {
  font-size: 11px;
  color: #707090;
}
</style>
