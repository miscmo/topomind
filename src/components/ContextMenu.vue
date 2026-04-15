<!-- 右键上下文菜单 -->
<template>
  <Teleport to="body">
    <!-- 节点菜单 -->
    <div v-if="menu.type === 'node'" id="context-menu" :style="menuStyle" @click.stop>
      <div class="ctx-item" @click="emit('action', { action: 'drill', payload: { nodeId: menu.nodeId } })">🔍 进入</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" @click="emit('action', { action: 'edit-md', payload: { nodeId: menu.nodeId } })">✏️ 文档</div>
      <div class="ctx-item" @click="emit('action', { action: 'add-child', payload: { nodeId: menu.nodeId } })">＋ 子卡片</div>
      <div class="ctx-item" @click="emit('action', { action: 'connect', payload: { nodeId: menu.nodeId } })">⤯ 连线</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" @click="emit('action', { action: 'delete', payload: { nodeId: menu.nodeId } })">🗑 删除</div>
    </div>

    <!-- 批量选择菜单 -->
    <div v-else-if="menu.type === 'batch'" id="batch-context-menu" :style="menuStyle" @click.stop>
      <div style="padding:6px 14px 4px;font-size:11px;color:#999;font-weight:600">批量修改颜色</div>
      <div style="padding:4px 14px 8px;display:flex;gap:6px;flex-wrap:wrap">
        <span v-for="color in batchColors" :key="color"
          class="batch-color-dot" :style="{ background: color }"
          @click="emit('action', { action: 'batch-color', payload: { color } })"
        ></span>
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" @click="emit('action', { action: 'batch-delete', payload: {} })">🗑 批量删除</div>
    </div>

    <!-- 边菜单 -->
    <div v-else-if="menu.type === 'edge'" id="edge-context-menu" :style="menuStyle" @click.stop>
      <div class="ctx-item danger" @click="emit('action', { action: 'delete-edge', payload: { edgeId: menu.edgeId } })">🗑 删除连线</div>
    </div>

    <!-- 背景菜单 -->
    <div v-else-if="menu.type === 'bg'" id="bg-context-menu" :style="menuStyle" @click.stop>
      <div class="ctx-item" @click="emit('action', { action: 'add-card', payload: { bgPos: menu.bgPos } })">＋ 新建卡片</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" @click="emit('action', { action: 'fit-view', payload: {} })">⊡ 适应视图</div>
      <div class="ctx-item" @click="emit('action', { action: 'go-back', payload: {} })">← 返回上级</div>
    </div>

    <!-- 点击外部关闭 -->
    <div v-if="menu.type" class="ctx-backdrop" @click="emit('close')"></div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  menu: { type: Object, default: () => ({ type: null }) },
  edgeMode: Boolean,
})
const emit = defineEmits(['close', 'action'])

const menuStyle = computed(() => ({
  position: 'fixed',
  left: props.menu.x + 'px',
  top: props.menu.y + 'px',
  zIndex: 1000,
  display: 'block',
}))

const batchColors = ['#4a6fa5', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']
</script>

<style scoped>
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}
</style>
