<!-- 多标签页栏 -->
<template>
  <div id="tab-bar">
    <div
      v-if="roomStore.tabs.length > 0"
      class="tab-item home-tab"
      :class="{ active: appStore.view === 'home' }"
      @click="appStore.showHome()"
    >
      <span class="tab-item-label">主页</span>
    </div>

    <div
      v-for="tab in roomStore.tabs"
      :key="tab.id"
      class="tab-item"
      :class="{ active: tab.id === roomStore.activeTabId && appStore.view === 'graph' }"
      @click="openTab(tab.id)"
    >
      <span class="tab-item-label">{{ tab.label }}</span>
      <span class="tab-item-close" @click.stop="closeTab(tab.id)" title="关闭">✕</span>
    </div>
  </div>
</template>

<script setup>
import { useRoomStore } from '@/stores/room'
import { useAppStore } from '@/stores/app'

const roomStore = useRoomStore()
const appStore = useAppStore()

function openTab(tabId) {
  roomStore.switchTab(tabId)
  appStore.showGraph()
}

function closeTab(tabId) {
  roomStore.closeTab(tabId)
  if (roomStore.tabs.length === 0) {
    appStore.showHome()
  }
}
</script>
