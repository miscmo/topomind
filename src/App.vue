<template>
  <div id="topomind-app">
    <!-- 监控窗口路由 -->
    <LogMonitorView v-if="isMonitorView" />

    <!-- 正常应用路由 -->
    <template v-else>
      <ErrorBoundary>
        <!-- 工作目录设置页 -->
        <WorkDirPage v-if="appStore.view === 'setup'" @opened="handleWorkDirOpened" @created="handleWorkDirCreated" />

        <!-- 标签栏：仅在存在知识库标签时显示（主页作为一个 Tab） -->
        <TabBar v-if="appStore.view !== 'setup' && roomStore.tabs.length > 0" />

        <!-- 首页 -->
        <HomePage v-if="appStore.view === 'home'" />

        <!-- 图谱页：左侧样式面板 + 中间图谱 + 右侧详情 -->
        <GraphView v-else-if="appStore.view === 'graph'" />
      </ErrorBoundary>

      <!-- 全局模态框（不受 ErrorBoundary 保护，避免错误级联） -->
      <InputModal />
      <ConfirmModal />
    </template>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, nextTick, ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRoomStore } from '@/stores/room'
import { useStorage } from '@/composables/useStorage'
import { logger } from '@/core/logger.js'
import { startGitCacheCleanup, stopGitCacheCleanup } from '@/core/git-backend.js'

import WorkDirPage from '@/components/WorkDirPage.vue'
import ErrorBoundary from '@/components/ErrorBoundary.vue'
import TabBar from '@/components/TabBar.vue'
import HomePage from '@/components/HomePage.vue'
import GraphView from '@/components/GraphView.vue'
import InputModal from '@/components/modals/InputModal.vue'
import ConfirmModal from '@/components/modals/ConfirmModal.vue'
import LogMonitorView from '@/components/monitor/LogMonitorView.vue'

const appStore = useAppStore()
const roomStore = useRoomStore()
const storage = useStorage()

const isMonitorView = computed(() => window.location.hash === '#/monitor')

let autoOpenPromise = null

// 监听 Electron 退出前保存事件
function handleBeforeQuit() {
  // 触发 roomStore 的保存请求，useGraph watch 会响应执行
  roomStore.saveCurrentLayout()
}

async function ensureAutoOpenLastKB() {
  if (!autoOpenPromise) {
    autoOpenPromise = autoOpenLastKB().finally(() => {
      autoOpenPromise = null
    })
  }
  return autoOpenPromise
}

onMounted(async () => {
  // 初始化工作目录
  const workDir = await storage.init()
  startGitCacheCleanup()
  if (!workDir?.valid) {
    appStore.view = 'setup'
  } else {
    appStore.view = 'home'
    await nextTick()
    await ensureAutoOpenLastKB()
  }
  if (window.electronAPI) {
    window.electronAPI.on('save:before-quit', handleBeforeQuit)
  }
})

/**
 * 自动打开上次关闭的知识库（如果仍然存在）
 */
async function autoOpenLastKB() {
  try {
    const lastKBPath = await storage.getLastOpenedKB()
    if (!lastKBPath) return

    const kbs = await storage.listKBs()
    const exists = (kbs || []).some(kb => kb.path === lastKBPath)
    if (!exists) return

    const kbName = lastKBPath.split('/').pop()
    roomStore.openTab(lastKBPath, kbName)
    appStore.showGraph()
  } catch (e) {
    logger.catch('App', '自动打开上次知识库', e)
  }
}

async function handleWorkDirOpened() {
  appStore.view = 'home'
  await nextTick()
  await ensureAutoOpenLastKB()
}

async function handleWorkDirCreated() {
  appStore.view = 'home'
}

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.off('save:before-quit', handleBeforeQuit)
  }
  stopGitCacheCleanup()
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
