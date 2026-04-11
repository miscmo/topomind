<!-- 面包屑导航 -->
<template>
  <div id="breadcrumb" class="active">
    <span class="bc-link" @click="$emit('go-root')">🏠 {{ crumbs[0]?.label || '根' }}</span>
    <template v-for="(crumb, i) in crumbs.slice(1)" :key="crumb.path">
      <span class="bc-sep">›</span>
      <span
        v-if="i < crumbs.length - 2"
        class="bc-link"
        @click="$emit('jump', crumb.path)"
      >{{ crumb.label }}</span>
      <span v-else class="bc-current">{{ crumb.label }}</span>
    </template>
  </div>
</template>

<script setup>
defineProps({ crumbs: { type: Array, default: () => [] } })
defineEmits(['jump', 'go-root'])
</script>
