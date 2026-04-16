<!-- 左侧导航树：当前房间的子卡片列表 -->
<template>
  <div id="nav-tree">
    <div class="nav-back-row">
      <button class="nav-back-btn" @click="$emit('go-back')">← 返回</button>
    </div>

    <div
      v-for="card in cards"
      :key="card.path"
      class="nav-item"
      :class="{ active: selectedNodeId === card.path }"
      @click="handleClick(card.path)"
      @dblclick="$emit('drill', card.path)"
    >{{ card.name }}</div>

    <div class="nav-add-row">
      <button class="nav-add-btn" @click="$emit('add-card')">＋ 新建卡片</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useStorage } from '@/composables/useStorage'
import { useRoomStore } from '@/stores/room'
import { logger } from '@/core/logger.js'

const props = defineProps({
  selectedNodeId: { type: String, default: null },
})
const emit = defineEmits(['select', 'drill', 'go-back', 'add-card'])

const storage = useStorage()
const roomStore = useRoomStore()
const cards = ref([])

async function loadCards() {
  const dirPath = roomStore.currentRoomPath || roomStore.currentKBPath
  if (!dirPath) { cards.value = []; return }
  try {
    const list = await storage.listCards(dirPath)
    cards.value = (list || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  } catch (e) {
    logger.catch('NavTree', '加载卡片列表', e)
    cards.value = []
  }
}

watch(() => roomStore.currentRoomPath, loadCards, { immediate: true })
watch(() => roomStore.currentKBPath, loadCards)

// ─── 单击/双击防抖 ────────────────────────────────────────────
let _clickTimer = null
function handleClick(path) {
  if (_clickTimer) {
    clearTimeout(_clickTimer)
    _clickTimer = null
    // 双击已触发 drill，不处理单击
    return
  }
  _clickTimer = setTimeout(() => {
    _clickTimer = null
    // 300ms 内无 dblclick 才触发 select
    emit('select', path)
  }, 300)
}

onUnmounted(() => {
  clearTimeout(_clickTimer)
})
</script>

<style scoped>
#nav-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}

.nav-back-row {
  padding: 4px 10px 6px;
}

.nav-back-btn {
  width: 100%;
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 11px;
  color: #666;
}
.nav-back-btn:hover { background: #f5f5f5; }

.nav-item {
  padding: 6px 14px;
  font-size: 12px;
  color: #444;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.nav-item:hover { background: #f0f4ff; color: #2c5aa0; }
.nav-item.active { background: #e8eeff; color: #2c5aa0; font-weight: 500; }

.nav-add-row {
  padding: 6px 10px 4px;
  margin-top: auto;
}

.nav-add-btn {
  width: 100%;
  height: 28px;
  border: 1.5px dashed #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 11px;
  color: #999;
}
.nav-add-btn:hover { border-color: #aaa; color: #666; }
</style>
