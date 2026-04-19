<template>
  <div class="workdir-page">
    <div class="workdir-card">
      <div class="workdir-brand">
        <div class="workdir-logo">🧠</div>
        <div>
          <h1>TopoMind</h1>
          <p>先选择一个工作目录，再进入你的笔记本主页</p>
        </div>
      </div>

      <div class="workdir-actions">
        <button class="workdir-btn workdir-btn-primary" @click="pickExisting">打开已有工作目录</button>
        <button class="workdir-btn" @click="createNew">创建新的工作目录</button>
      </div>

      <div v-if="message" class="workdir-message" :class="{ error: isError }">{{ message }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useStorage } from '@/composables/useStorage'
import { useAppStore } from '@/stores/app'

const emit = defineEmits(['opened', 'created'])
const storage = useStorage()
const appStore = useAppStore()
const message = ref('')
const isError = ref(false)

async function pickExisting() {
  message.value = ''
  isError.value = false
  try {
    const picked = await storage.selectWorkDirCandidate()
    if (!picked?.valid) {
      // 用户取消选择时，不显示错误
      return
    }
    const res = await storage.selectExistingWorkDir(picked.path)
    if (!res?.valid) {
      isError.value = true
      message.value = res?.error || '不是有效的工作目录'
      return
    }
    appStore.view = 'home'
    emit('opened', res)
  } catch (e) {
    isError.value = true
    message.value = e?.message || '打开工作目录失败'
  }
}

async function createNew() {
  message.value = ''
  try {
    const picked = await storage.selectWorkDirCandidate()
    if (!picked?.valid) {
      isError.value = true
      message.value = picked?.error || '请选择一个空目录作为新的工作目录'
      return
    }
    const res = await storage.createWorkDir(picked.path)
    if (!res?.valid) {
      isError.value = true
      message.value = res?.error || '创建工作目录失败'
      return
    }
    appStore.view = 'home'
    emit('created', res)
  } catch (e) {
    isError.value = true
    message.value = e?.message || '创建工作目录失败'
  }
}
</script>

<style scoped>
.workdir-page { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #f7f9fc 0%, #eef3f9 100%); }
.workdir-card { width: min(560px, calc(100vw - 48px)); background: rgba(255,255,255,0.92); border: 1px solid #e6ebf2; box-shadow: 0 20px 60px rgba(17,24,39,0.08); border-radius: 20px; padding: 28px; }
.workdir-brand { display: flex; gap: 16px; align-items: center; margin-bottom: 24px; }
.workdir-logo { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; background: #1a3a5c; color: #fff; font-size: 28px; }
.workdir-brand h1 { margin: 0; font-size: 28px; color: #132238; }
.workdir-brand p { margin: 6px 0 0; color: #5f6b7a; }
.workdir-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.workdir-btn { border: 1px solid #d7deea; background: #fff; color: #132238; border-radius: 12px; padding: 12px 16px; cursor: pointer; font-size: 14px; }
.workdir-btn-primary { background: #1a3a5c; color: #fff; border-color: #1a3a5c; }
.workdir-message { margin-top: 16px; color: #1f7a3a; background: #eefaf1; border: 1px solid #c9ead4; padding: 10px 12px; border-radius: 10px; }
.workdir-message.error { color: #b42318; background: #fff1f0; border-color: #f5c2c0; }
</style>
