<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { NButton } from 'naive-ui'
import ProjectSkillsPanel from '@/components/ProjectSkillsPanel.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

function backToProjectCenter(): void {
  appStore.backToProjects()
}
</script>

<template>
  <section class="skills-page">
    <header class="skills-header arc-drag-region">
      <div class="skills-header-actions arc-no-drag">
        <n-button quaternary @click="backToProjectCenter">
          <template #icon><ChevronLeft :size="16" /></template>
          返回项目中心
        </n-button>
      </div>
    </header>

    <main class="skills-main">
      <div class="skills-body arc-scrollbar">
        <ProjectSkillsPanel />
      </div>
    </main>
  </section>
</template>

<style scoped>
.skills-page {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
  background: var(--arc-bg-body);
}

.skills-header {
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

.skills-header-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.skills-header-copy strong {
  color: var(--arc-text-primary);
  font-size: 28px;
  font-weight: 760;
  letter-spacing: -0.04em;
}

.skills-header-copy p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.skills-header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.skills-main {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.skills-body {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0 clamp(16px, 2vw, 24px) clamp(16px, 2vw, 24px);
}

@media (max-width: 860px) {
  .skills-header {
    flex-direction: column;
    padding:
      calc(var(--arc-titlebar-height) + 16px)
      max(14px, calc(var(--arc-window-controls-width) + 14px))
      12px
      14px;
  }

  .skills-header-actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
