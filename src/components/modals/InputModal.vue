<!-- 两个简单的模态框组件 -->
<template>
  <Teleport to="body">
    <div v-if="modalStore.input.visible" class="modal-overlay active" @click.self="modalStore.cancelInput()">
      <div class="modal" style="width:380px">
        <div class="modal-header">
          <h3>{{ modalStore.input.title }}</h3>
          <button class="modal-close" @click="modalStore.cancelInput()">✕</button>
        </div>
        <div class="modal-body">
          <input
            ref="inputRef"
            type="text"
            v-model="modalStore.input.value"
            :placeholder="modalStore.input.placeholder"
            style="width:100%;height:36px;border:1px solid #ddd;border-radius:8px;padding:0 12px;font-size:14px;outline:none"
            @keydown.enter="modalStore.confirmInput()"
            @keydown.esc="modalStore.cancelInput()"
          />
        </div>
        <div class="modal-footer">
          <button class="btn" @click="modalStore.cancelInput()">取消</button>
          <button class="btn btn-primary" @click="modalStore.confirmInput()">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useModalStore } from '@/stores/modal'

const modalStore = useModalStore()
const inputRef = ref(null)

watch(() => modalStore.input.visible, async (val) => {
  if (val) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})
</script>
