<!-- 多标签页栏 -->
<template>
  <div id="tab-bar">
    <div
      v-for="tab in roomStore.tabs"
      :key="tab.id"
      class="tab-item"
      :class="{ active: tab.id === roomStore.activeTabId }"
      @click="roomStore.switchTab(tab.id)"
    >
      <span class="tab-label">{{ tab.label }}</span>
      <button class="tab-close" @click.stop="closeTab(tab.id)" title="关闭">✕</button>
    </div>
    <button class="tab-home-btn" @click="appStore.showHome()" title="返回首页">🏠</button>
  </div>
</template>

<script setup>
import { useRoomStore } from '@/stores/room'
import { useAppStore } from '@/stores/app'

const roomStore = useRoomStore()
const appStore = useAppStore()

function closeTab(tabId) {
  roomStore.closeTab(tabId)
  if (roomStore.tabs.length === 0) {
    appStore.showHome()
  }
}
</script>

<style scoped>
#tab-bar {
  display: flex;
  align-items: center;
  height: 36px;
  background: #1e2330;
  border-bottom: 1px solid #2d3347;
  padding: 0 4px;
  gap: 2px;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 14px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  color: #8891aa;
  font-size: 12px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
  max-width: 180px;
}

.tab-item:hover { background: #2d3347; color: #c8d0e7; }
.tab-item.active { background: #2d3347; color: #e0e6f0; font-weight: 500; }

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.tab-close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  padding: 2px;
  border-radius: 3px;
  opacity: 0.5;
  flex-shrink: 0;
}
.tab-close:hover { opacity: 1; background: rgba(255,255,255,.1); }

.tab-home-btn {
  background: none;
  border: none;
  color: #8891aa;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  margin-left: auto;
  flex-shrink: 0;
}
.tab-home-btn:hover { background: #2d3347; color: #c8d0e7; }
</style>
