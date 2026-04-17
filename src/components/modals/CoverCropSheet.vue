<!-- 封面裁剪弹窗 -->
<template>
  <div class="home-form-overlay" :class="{ active: visible }">
    <div class="home-form home-crop-form">
      <div class="home-form-header">
        <h3>裁剪封面</h3>
        <button class="home-form-close" @click="emit('cancel')">✕</button>
      </div>
      <div class="home-form-body">
        <div class="home-crop-container" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp">
          <img :src="crop.url" class="home-crop-img" />
          <div class="home-crop-overlay">
            <div class="home-crop-box" :style="cropBoxStyle"></div>
          </div>
        </div>
        <p class="home-crop-hint">拖动选框调整裁剪区域</p>
      </div>
      <div class="home-form-footer">
        <button class="home-btn home-btn-cancel" @click="emit('cancel')">取消</button>
        <button class="home-btn home-btn-primary" @click="apply">应用裁剪</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'

const props = defineProps({
  visible: { type: Boolean, required: true },
  crop: { type: Object, default: () => ({ blob: null, url: '', width: 0, height: 0 }) },
})
const emit = defineEmits(['cancel', 'apply'])

const rect = ref({ x: 0, y: 0, w: 100, h: 100 })
const dragging = ref(false)
const dragStart = { x: 0, y: 0 }

const cropBoxStyle = computed(() => ({
  left: (rect.value.x / props.crop.width * 100) + '%',
  top: (rect.value.y / props.crop.height * 100) + '%',
  width: (rect.value.w / props.crop.width * 100) + '%',
  height: (rect.value.h / props.crop.height * 100) + '%',
}))

function initCrop() {
  if (!props.crop.width) return
  const minDim = Math.min(props.crop.width, props.crop.height)
  rect.value = {
    x: props.crop.width / 2 - minDim / 2,
    y: props.crop.height / 2 - minDim / 2,
    w: minDim,
    h: minDim,
  }
}

function onMouseDown(e) {
  dragging.value = true
  dragStart.x = e.clientX
  dragStart.y = e.clientY
}

function onMouseMove(e) {
  if (!dragging.value) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  dragStart.x = e.clientX
  dragStart.y = e.clientY
  const container = e.currentTarget
  const scaleX = props.crop.width / container.offsetWidth
  const scaleY = props.crop.height / container.offsetHeight
  rect.value.x += dx * scaleX
  rect.value.y += dy * scaleY
}

function onMouseUp() { dragging.value = false }

function apply() {
  const { blob } = props.crop
  if (!blob || !props.crop.width) return
  const canvas = document.createElement('canvas')
  const img = new Image()
  img.onload = () => {
    canvas.width = rect.value.w
    canvas.height = rect.value.h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, rect.value.x, rect.value.y, rect.value.w, rect.value.h, 0, 0, rect.value.w, rect.value.h)
    canvas.toBlob((cropBlob) => {
      if (cropBlob) {
        emit('apply', new File([cropBlob], blob.name || 'cover.png', { type: 'image/png' }))
      }
    }, 'image/png')
  }
  img.src = props.crop.url
}

// Expose init for parent to call when crop data is set
defineExpose({ initCrop })

onUnmounted(() => {
  if (props.crop.url && props.crop.url.startsWith('blob:')) {
    URL.revokeObjectURL(props.crop.url)
  }
})
</script>
