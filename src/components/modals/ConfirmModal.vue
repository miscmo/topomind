<template>
  <Teleport to="body">
    <div v-if="modalStore.confirm.visible" class="modal-overlay active" @click.self="modalStore.cancelAction()">
      <div class="modal" style="width:360px">
        <div class="modal-header">
          <h3>确认</h3>
          <button class="modal-close" @click="modalStore.cancelAction()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:13px;color:#555">{{ modalStore.confirm.message }}</p>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="modalStore.cancelAction()">取消</button>
          <button
            :class="['btn', modalStore.confirm.danger ? 'btn-danger' : 'btn-primary']"
            @click="modalStore.confirmAction()"
          >确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { useModalStore } from '@/stores/modal'
const modalStore = useModalStore()
</script>
