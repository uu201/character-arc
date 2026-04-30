<script setup lang="ts">
// 共享面板布局框架：提供统一的头部标题 + 操作栏 + 可滚动内容区域的布局容器
defineProps<{
  title: string // 面板标题，可通过 title slot 覆盖
}>()
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <div class="panel-title">
        <slot name="title">{{ title }}</slot>
      </div>
      <div class="panel-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="panel-body arc-scrollbar">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

.panel-header {
  display: flex;
  height: 64px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  padding: 0 32px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}
</style>
