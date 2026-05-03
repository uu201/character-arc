<script setup lang="ts">
// 章节创作页面：独立的章节编辑入口，直接嵌入 ChaptersPanel 组件
// 该页面可从工作台的"章节创作"面板或独立路由进入
import ChaptersPanel from '@/components/ChaptersPanel.vue'
</script>

<template>
  <section class="chapter-studio-page">
    <main class="chapter-studio-main">
      <div class="studio-body arc-scrollbar">
        <ChaptersPanel />
      </div>
    </main>
  </section>
</template>

<style scoped>
.chapter-studio-page {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--arc-bg-body);
}

.chapter-studio-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.studio-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: clamp(16px, 2vw, 24px);
}
</style>
