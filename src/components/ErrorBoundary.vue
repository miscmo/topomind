<!--
  ErrorBoundary 组件
  使用 Vue 3 的 onErrorCaptured 捕获子组件树中的错误，
  显示友好的 fallback UI 并支持恢复。
-->
<template>
  <template v-if="hasError">
    <div class="error-boundary-fallback">
      <div class="error-boundary-icon">⚠</div>
      <div class="error-boundary-title">组件渲染出错</div>
      <div class="error-boundary-msg">{{ errorMessage }}</div>
      <button class="error-boundary-reset" @click="reset">重新加载</button>
    </div>
  </template>
  <template v-else>
    <slot />
  </template>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'
import { logger } from '@/core/logger.js'

const hasError = ref(false)
const errorMessage = ref('')

onErrorCaptured((err, instance, info) => {
  hasError.value = true
  errorMessage.value = err instanceof Error ? err.message : String(err)
  logger.catch('ErrorBoundary', `组件错误 [${info || 'unknown'}]`, err)
  // 返回 false 阻止错误继续向上传播
  return false
})

function reset() {
  hasError.value = false
  errorMessage.value = ''
}
</script>

<style scoped>
.error-boundary-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 24px;
  gap: 8px;
  color: #666;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.error-boundary-icon {
  font-size: 32px;
  line-height: 1;
}

.error-boundary-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.error-boundary-msg {
  font-size: 12px;
  color: #999;
  max-width: 360px;
  text-align: center;
  word-break: break-all;
}

.error-boundary-reset {
  margin-top: 8px;
  padding: 6px 20px;
  border: none;
  border-radius: 6px;
  background: #4a6fa5;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.error-boundary-reset:hover {
  background: #3a5a8a;
}
</style>
