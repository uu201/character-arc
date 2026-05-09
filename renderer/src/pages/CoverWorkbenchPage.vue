<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { NButton } from 'naive-ui'
import ProjectCoverWorkbenchPanel from '@/components/home/ProjectCoverWorkbenchPanel.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

function backToProjectCenter(): void {
  appStore.backToProjects()
}
</script>

<template>
  <section class="cover-workbench-page">
    <header class="cover-workbench-header">
      <div class="cover-workbench-header-actions">
        <n-button quaternary @click="backToProjectCenter">
          <template #icon><ChevronLeft :size="16" /></template>
          返回项目中心
        </n-button>
      </div>
    </header>

    <main class="cover-workbench-main">
      <ProjectCoverWorkbenchPanel />
    </main>
  </section>
</template>

<style scoped>
.cover-workbench-page {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--arc-bg-body);
}

.cover-workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 12px;
}

.cover-workbench-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cover-workbench-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0 20px 20px;
  overflow: auto;
}

@media (max-width: 720px) {
  .cover-workbench-header {
    padding: 14px 14px 10px;
  }

  .cover-workbench-main {
    padding: 0 14px 14px;
  }
}
</style>
