<!-- 知识库设置弹窗 -->
<template>
  <div class="home-form-overlay" :class="{ active: visible }">
    <div class="home-form">
      <div class="home-form-header">
        <h3>知识库设置</h3>
        <button class="home-form-close" @click="emit('cancel')">✕</button>
      </div>
      <div class="home-form-body">
        <div class="home-form-group">
          <label>知识库名称（显示名）</label>
          <input
            type="text"
            v-model="localName"
            placeholder="输入新名称..."
            :style="{ borderColor: nameError ? '#e74c3c' : '' }"
          />
        </div>

        <div class="home-form-group home-kb-advanced">
          <label>高级信息（只读）</label>
          <div class="home-kb-advanced-grid">
            <div class="home-kb-advanced-row">
              <span class="k">目录名</span>
              <span class="v">{{ kbPath || '—' }}</span>
            </div>
            <div class="home-kb-advanced-row">
              <span class="k">完整路径</span>
              <span class="v" :title="fullPath">{{ fullPath || '—' }}</span>
            </div>
            <div class="home-kb-advanced-row">
              <span class="k">创建时间</span>
              <span class="v">{{ formattedTime }}</span>
            </div>
            <div class="home-kb-advanced-row">
              <span class="k">节点数量</span>
              <span class="v">{{ nodeCount ?? 0 }}</span>
            </div>
          </div>
        </div>

        <div class="home-form-group">
          <label>封面图片</label>
          <div
            class="home-image-upload"
            :class="{ 'has-image': localCoverPreview || keepCurrentCover }"
            @click="triggerCoverSelect"
          >
            <template v-if="localCoverPreview">
              <img :src="localCoverPreview" />
              <button class="home-remove-image" @click.stop="removeCover">✕</button>
            </template>
            <template v-else>
              <div class="home-image-upload-text">📷 点击更换封面</div>
              <div class="home-image-upload-hint">可选，不改则保留原封面</div>
            </template>
          </div>
          <input ref="coverInputRef" type="file" accept="image/*" style="display:none" @change="coverChanged" />
        </div>
      </div>
      <div class="home-form-footer">
        <button class="home-btn home-btn-cancel" @click="emit('cancel')">取消</button>
        <button class="home-btn home-btn-primary" @click="emit('save', localName, localCoverBlob)">保存</button>
        <button class="home-btn home-btn-danger" @click="emit('delete', kbPath)">删除知识库</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'

const props = defineProps({
  visible: { type: Boolean, required: true },
  kbName: { type: String, default: '' },
  kbPath: { type: String, default: '' },
  kbCreatedAt: { type: [String, Number, null], default: null },
  nodeCount: { type: Number, default: 0 },
  currentCoverUrl: { type: String, default: null },
  hasExistingCover: { type: Boolean, default: false },
  rootDir: { type: String, default: '' },
})
const emit = defineEmits(['cancel', 'save', 'delete', 'crop'])

const localName = ref('')
const localCoverBlob = ref(null)
const localCoverPreview = ref(null)
const keepCurrentCover = ref(false)
const nameError = ref(false)
const coverInputRef = ref(null)

const fullPath = computed(() =>
  props.rootDir ? `${props.rootDir}/${props.kbPath}` : props.kbPath
)
const formattedTime = computed(() => {
  if (!props.kbCreatedAt) return '—'
  try { return new Date(props.kbCreatedAt).toLocaleString() } catch { return '—' }
})

// Init on open
watch(() => props.visible, (v) => {
  if (v) {
    _blobUrls.forEach(url => { try { URL.revokeObjectURL(url) } catch (e) {} })
    _blobUrls.length = 0
    localName.value = props.kbName
    localCoverBlob.value = null
    localCoverPreview.value = props.currentCoverUrl
    keepCurrentCover.value = props.hasExistingCover
    nameError.value = false
  }
})

let _saveTimer = null
const _blobUrls = []

onUnmounted(() => {
  _blobUrls.forEach(url => { try { URL.revokeObjectURL(url) } catch (e) {} })
  _blobUrls.length = 0
  clearTimeout(_saveTimer)
})

function triggerCoverSelect() { coverInputRef.value?.click() }

function coverChanged(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const url = ev.target.result
    const img = new Image()
    img.onload = () => {
      const source = { blob: file, url, width: img.width, height: img.height }
      emit('crop', source)
    }
    img.src = url
  }
  reader.readAsDataURL(file)
}

function removeCover() {
  localCoverBlob.value = null
  _blobUrls.forEach(url => { try { URL.revokeObjectURL(url) } catch (e) {} })
  _blobUrls.length = 0
  localCoverPreview.value = null
  keepCurrentCover.value = false
  if (coverInputRef.value) coverInputRef.value.value = ''
}

function applyCroppedFile(file) {
  localCoverBlob.value = file
  const newUrl = URL.createObjectURL(file)
  _blobUrls.push(newUrl)
  localCoverPreview.value = newUrl
  keepCurrentCover.value = false
}

defineExpose({ applyCroppedFile })
</script>