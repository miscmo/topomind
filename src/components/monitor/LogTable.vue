<template>
  <div class="log-table-container" ref="containerRef">
    <table class="log-table">
      <thead class="log-thead">
        <tr>
          <th class="col-time">时间</th>
          <th class="col-level">等级</th>
          <th class="col-module">模块</th>
          <th class="col-action">动作</th>
          <th class="col-message">消息</th>
          <th class="col-op">操作</th>
        </tr>
      </thead>
      <tbody class="log-tbody" ref="tbodyRef" @scroll.passive="handleScroll">
        <!-- 空状态 -->
        <tr v-if="entries.length === 0" class="empty-row">
          <td colspan="6">
            <div class="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>暂无日志</span>
            </div>
          </td>
        </tr>

        <template v-for="entry in entries" :key="entry.id">
          <!-- 日志行 -->
          <tr
            class="log-row"
            :class="{
              'row-expanded': expandedId === entry.id,
              'level-debug': entry.level === 'DEBUG',
              'level-info': entry.level === 'INFO',
              'level-warn': entry.level === 'WARN',
              'level-error': entry.level === 'ERROR',
            }"
            @click="$emit('toggle', entry.id)"
          >
            <td class="col-time">
              <span class="timestamp">{{ formatTime(entry.timestamp) }}</span>
              <span class="timestamp-ms">{{ formatMs(entry.timestamp) }}</span>
            </td>
            <td class="col-level">
              <span class="level-badge" :class="'badge-' + entry.level.toLowerCase()">
                {{ entry.level }}
              </span>
            </td>
            <td class="col-module">
              <span class="module-tag" :title="entry.file">{{ entry.module }}</span>
            </td>
            <td class="col-action">
              <span v-if="entry.action" class="action-tag">{{ entry.action }}</span>
              <span v-else class="no-action">—</span>
            </td>
            <td class="col-message">
              <span class="message-text">{{ entry.message }}</span>
            </td>
            <td class="col-op">
              <button class="expand-btn" :title="expandedId === entry.id ? '收起详情' : '展开详情'">
                <svg
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2"
                  :style="{ transform: expandedId === entry.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }"
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </td>
          </tr>

          <!-- 展开详情行 -->
          <tr v-if="expandedId === entry.id" class="detail-row">
            <td colspan="6">
              <div class="detail-panel">
                <div class="detail-grid">
                  <div class="detail-item">
                    <span class="detail-label">ID</span>
                    <span class="detail-value code">{{ entry.id }}</span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">函数</span>
                    <span class="detail-value code">{{ entry.func || '—' }}</span>
                  </div>
                  <div v-if="entry.file" class="detail-item">
                    <span class="detail-label">文件</span>
                    <span class="detail-value code">{{ entry.file }}:{{ entry.line }}</span>
                  </div>
                  <div v-if="entry.traceId" class="detail-item">
                    <span class="detail-label">TraceId</span>
                    <span class="detail-value code">{{ entry.traceId }}</span>
                  </div>
                  <div v-if="entry.spanId" class="detail-item">
                    <span class="detail-label">SpanId</span>
                    <span class="detail-value code">{{ entry.spanId }}</span>
                  </div>
                </div>

                <div v-if="entry.params" class="detail-section">
                  <span class="detail-label">Params</span>
                  <pre class="detail-json">{{ JSON.stringify(entry.params, null, 2) }}</pre>
                </div>

                <div v-if="entry.meta" class="detail-section">
                  <span class="detail-label">Meta</span>
                  <pre class="detail-json">{{ JSON.stringify(entry.meta, null, 2) }}</pre>
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  entries: { type: Array, default: () => [] },
  expandedId: { type: String, default: null },
})

defineEmits(['toggle'])

const containerRef = ref(null)
const tbodyRef = ref(null)

function formatTime(timestamp) {
  if (!timestamp) return ''
  try {
    const d = new Date(timestamp)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return timestamp
  }
}

function formatMs(timestamp) {
  if (!timestamp) return ''
  try {
    const d = new Date(timestamp)
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return '.' + ms
  } catch {
    return ''
  }
}

function handleScroll(e) {
  // Future: implement virtual scrolling if needed
}
</script>

<style scoped>
.log-table-container {
  flex: 1;
  overflow: auto;
  position: relative;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.log-thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #1a1a2e;
}

.log-thead th {
  padding: 8px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: #555570;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #2a2a4a;
  white-space: nowrap;
}

.col-time { width: 110px; }
.col-level { width: 70px; }
.col-module { width: 120px; }
.col-action { width: 140px; }
.col-message { min-width: 200px; }
.col-op { width: 50px; text-align: center; }

.log-tbody {
  display: block;
  max-height: calc(100vh - 48px - 40px - 48px);
  overflow-y: auto;
}

.log-thead,
.log-tbody tr {
  display: table;
  width: 100%;
  table-layout: fixed;
}

.log-row {
  cursor: pointer;
  transition: background 0.1s;
}

.log-row:hover {
  background: #1e1e3a;
}

.log-row.row-expanded {
  background: #1e1e3a;
}

.log-row td {
  padding: 6px 12px;
  border-bottom: 1px solid #1e1e2e;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-time {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.timestamp {
  color: #707090;
  font-size: 12px;
}

.timestamp-ms {
  color: #444460;
  font-size: 10px;
}

.level-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.badge-debug { background: #2a2a30; color: #888; }
.badge-info { background: #1a2a4a; color: #5c9cfa; }
.badge-warn { background: #2a2a10; color: #f0a040; }
.badge-error { background: #2a1a1a; color: #f06060; }

.row-expanded .badge-error { background: #3a2020; }
.row-expanded .badge-warn { background: #3a3010; }

.module-tag {
  color: #8080a0;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}

.action-tag {
  color: #c080c0;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  background: #1e1a2e;
  padding: 1px 6px;
  border-radius: 3px;
}

.no-action {
  color: #333;
}

.message-text {
  color: #c0c0d0;
  font-size: 12px;
}

.level-error .message-text { color: #e08080; }
.level-warn .message-text { color: #e0c080; }
.level-debug .message-text { color: #606080; }

.expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #555570;
  cursor: pointer;
  transition: all 0.15s;
}

.expand-btn:hover {
  background: #2a2a50;
  color: #a0a0c0;
}

/* 展开详情 */
.detail-row td {
  padding: 0;
  border-bottom: 1px solid #2a2a4a;
}

.detail-panel {
  padding: 12px 16px;
  background: #141428;
  border-top: 1px solid #2a2a4a;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.detail-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.detail-label {
  font-size: 10px;
  color: #555570;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  min-width: 60px;
}

.detail-value {
  font-size: 11px;
  color: #9090b0;
  word-break: break-all;
}

.detail-value.code {
  font-family: 'JetBrains Mono', monospace;
  color: #a0a0c8;
}

.detail-section {
  margin-bottom: 8px;
}

.detail-json {
  margin: 4px 0 0;
  padding: 8px 12px;
  background: #0e0e1e;
  border-radius: 5px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #a0a0c0;
  overflow-x: auto;
  max-height: 200px;
  white-space: pre;
}

/* 空状态 */
.empty-row td {
  padding: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #3a3a50;
  gap: 12px;
}

.empty-state svg {
  color: #2a2a40;
}

.empty-state span {
  font-size: 14px;
}
</style>
