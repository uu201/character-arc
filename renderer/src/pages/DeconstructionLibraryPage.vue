<script setup lang="ts">
import { ChevronLeft, LibraryBig } from 'lucide-vue-next'
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import KnowledgeCenterPanel from '@/components/KnowledgeCenterPanel.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
function backToProjectCenter(): void {
  appStore.backToProjects()
}
</script>

<template>
  <section class="deconstruction-page">
    <header class="deconstruction-header arc-drag-region">
      <div class="deconstruction-header-actions arc-no-drag">
        <n-button quaternary @click="backToProjectCenter">
          <template #icon><ChevronLeft :size="16" /></template>
          返回项目中心
        </n-button>
      </div>
    </header>

    <main class="deconstruction-main">
      <div class="deconstruction-body arc-scrollbar">
        <KnowledgeCenterPanel />
      </div>
    </main>
  </section>
</template>

<style scoped>
.deconstruction-page {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--arc-primary) 8%, transparent) 0%, transparent 30%),
    var(--arc-bg-body);
}

.deconstruction-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding:
    calc(var(--arc-titlebar-height) + 18px)
    max(20px, calc(var(--arc-window-controls-width) + 18px))
    14px
    20px;
}

.deconstruction-header-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.deconstruction-header-kicker {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  text-transform: uppercase;
}

.deconstruction-header-copy strong {
  color: var(--arc-text-primary);
  font-size: 28px;
  font-weight: 760;
  letter-spacing: -0.05em;
}

.deconstruction-header-copy p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.deconstruction-header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.deconstruction-main {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.deconstruction-body {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0 clamp(16px, 2vw, 24px) clamp(16px, 2vw, 24px);
}

@media (max-width: 860px) {
  .deconstruction-header {
    flex-direction: column;
    padding:
      calc(var(--arc-titlebar-height) + 16px)
      max(14px, calc(var(--arc-window-controls-width) + 14px))
      12px
      14px;
  }

  .deconstruction-header-actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
