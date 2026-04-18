<!-- 新建知识库表单 -->
<template>
  <div class="home-form-overlay" :class="{ active: visible }">
    <div class="home-form">
      <div class="home-form-header">
        <h3>新建知识库</h3>
        <button class="home-form-close" @click="emit('cancel')">✕</button>
      </div>
      <div class="home-form-body">
        <div class="home-form-group">
          <label>知识库名称</label>
          <input
            ref="nameInputRef"
            type="text"
            v-model="localName"
            placeholder="输入名称..."
            :style="{ borderColor: nameError ? '#e74c3c' : '' }"
            @keydown.enter="submit"
          />
        </div>
        <div class="home-form-group">
          <label>封面图片</label>
          <div
            class="home-image-upload"
            :class="{ 'has-image': localCoverPreview }"
            @click="triggerCoverSelect"
          >
            <template v-if="localCoverPreview">
              <img :src="localCoverPreview" />
              <button class="home-remove-image" @click.stop="removeCover">✕</button>
            </template>
            <template v-else>
              <div class="home-image-upload-text">📷 点击选择封面</div>
              <div class="home-image-upload-hint">可选，不设置使用默认</div>
            </template>
          </div>
          <input ref="coverInputRef" type="file" accept="image/*" style="display:none" @change="coverChanged" />
        </div>
      </div>
      <div class="home-form-footer">
        <button class="home-btn home-btn-cancel" @click="emit('cancel')">取消</button>
        <button class="home-btn home-btn-primary" @click="submit">创建</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  visible: { type: Boolean, required: true },
})
const emit = defineEmits(['cancel', 'submit'])

const localName = ref('')
const localCoverBlob = ref(null)
const localCoverPreview = ref(null)
const nameError = ref(false)
const nameInputRef = ref(null)
const coverInputRef = ref(null)
let _nameErrorTimer = null

// Reset on open
watch(() => props.visible, (v) => {
  if (v) {
    localName.value = ''
    localCoverBlob.value = null
    localCoverPreview.value = null
    nameError.value = false
  }
})

function triggerCoverSelect() { coverInputRef.value?.click() }

function coverChanged(e) {
  const file = e.target.files?.[0]
  if (!file) return
  localCoverBlob.value = file
  const reader = new FileReader()
  reader.onload = (ev) => { localCoverPreview.value = ev.target.result }
  reader.readAsDataURL(file)
}

function removeCover() {
  localCoverBlob.value = null
  localCoverPreview.value = null
  if (coverInputRef.value) coverInputRef.value.value = ''
}

function submit() {
  const name = localName.value.trim()
  if (!name) {
    nameError.value = true
    nameInputRef.value?.focus()
    clearTimeout(_nameErrorTimer)
    _nameErrorTimer = setTimeout(() => { nameError.value = false }, 2000)
    return
  }
  emit('submit', { name, coverBlob: localCoverBlob.value })
}

onUnmounted(() => {
  clearTimeout(_nameErrorTimer)
  // Data URLs from FileReader.readAsDataURL don't need revocation.
  // Blob URLs (if ever added) must be revoked here.
})
</script>
