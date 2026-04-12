<template>
  <div id="topomind-app">
    <!-- 标签栏：仅在存在知识库标签时显示（主页作为一个 Tab） -->
    <TabBar v-if="roomStore.tabs.length > 0" />

    <!-- 首页 -->
    <HomePage v-if="appStore.view === 'home'" />

    <!-- 图谱页：左侧样式面板 + 中间图谱 + 右侧详情 -->
    <GraphView v-else-if="appStore.view === 'graph'" />

    <!-- 全局模态框 -->
    <InputModal />
    <ConfirmModal />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useStorage } from '@/composables/useStorage'

import TabBar from '@/components/TabBar.vue'
import HomePage from '@/components/HomePage.vue'
import GraphView from '@/components/GraphView.vue'
import InputModal from '@/components/modals/InputModal.vue'
import ConfirmModal from '@/components/modals/ConfirmModal.vue'

const appStore = useAppStore()
const roomStore = useRoomStore()
const { init } = useStorage()

// 监听 Electron 退出前保存事件
function handleBeforeQuit() {
  // 触发 roomStore 的保存请求，useGraph watch 会响应执行
  roomStore.saveCurrentLayout()
}

onMounted(async () => {
  // 初始化存储层（等同于原来的 Store.init()）
  await init()
  // 默认显示首页
  appStore.view = 'home'
  if (window.electronAPI) {
    window.electronAPI.on('save:before-quit', handleBeforeQuit)
  }
})

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.off('save:before-quit', handleBeforeQuit)
  }
})
</script>

<style>
#topomind-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
