<!-- 导入知识库表单 -->
<template>
  <div class="home-form-overlay" :class="{ active: visible }">
    <div class="home-form">
      <div class="home-form-header">
        <h3>导入知识库</h3>
        <button class="home-form-close" @click="emit('cancel')">✕</button>
      </div>
      <div class="home-form-body">
        <div class="home-form-group">
          <label>选择知识库文件夹</label>
          <div v-if="selected" class="home-import-selected">
            <template v-if="selected.valid">
              <div class="home-import-valid">
                <span class="home-import-badge">✓ 有效知识库</span>
                <div class="home-import-info">
                  <span>📁 {{ selected.path }}</span>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="home-import-invalid">
                <span class="home-import-badge home-import-badge--error">✕ {{ selected.error }}</span>
                <div class="home-import-info">
                  <span>📁 {{ selected.path }}</span>
                </div>
              </div>
            </template>
          </div>
          <button class="home-btn home-btn-cancel" @click="doSelect" style="width:100%;padding:10px 14px">
            {{ selected ? '重新选择...' : '📂 选择文件夹' }}
          </button>
        </div>
        <div v-if="errorMsg" class="home-import-error">{{ errorMsg }}</div>
      </div>
      <div class="home-form-footer">
        <button class="home-btn home-btn-cancel" @click="emit('cancel')">取消</button>
        <button
          class="home-btn home-btn-primary"
          :disabled="!selected || !selected.valid || loading"
          @click="submit"
        >
          {{ loading ? '导入中...' : '导入' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useStorage } from '@/composables/useStorage'

const props = defineProps({
  visible: { type: Boolean, required: true },
})
const emit = defineEmits(['cancel', 'submit'])

const storage = useStorage()
const selected = ref(null)
const loading = ref(false)
const errorMsg = ref(null)

// Reset on open
watch(() => props.visible, (v) => {
  if (v) {
    selected.value = null
    loading.value = false
    errorMsg.value = null
  }
})

async function doSelect() {
  errorMsg.value = null
  try {
    const result = await storage.selectWorkDirCandidate()
    selected.value = result
  } catch (e) {
    if (String(e?.message || '').includes('取消')) return
    errorMsg.value = e?.message || '选择知识库失败'
  }
}

async function submit() {
  if (!selected.value || !selected.value.valid) return
  loading.value = true
  errorMsg.value = null
  try {
    const kbPath = await storage.importKB(selected.value.path)
    emit('submit', kbPath)
  } catch (err) {
    errorMsg.value = '导入失败: ' + (err?.message || String(err))
  } finally {
    loading.value = false
  }
}
</script>
