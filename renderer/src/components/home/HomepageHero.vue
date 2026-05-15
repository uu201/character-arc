<script setup lang="ts">
import { ImagePlus, LibraryBig, Plus, Settings2, Wrench } from 'lucide-vue-next'
import { NButton } from 'naive-ui'

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'openDeconstruction'): void
  (e: 'openCoverWorkbench'): void
  (e: 'openSkills'): void
  (e: 'openSettings'): void
}>()
</script>

<template>
  <header class="homepage-hero">
    <div class="hero-copy">
      <h1>我的作品</h1>
      <p>选择一个项目继续写作，或开始新的作品。</p>
    </div>

    <div class="hero-actions">
      <div class="action-group secondary-actions">
        <n-button quaternary circle size="large" title="拆书知识库" @click="emit('openDeconstruction')">
          <template #icon><LibraryBig :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="Skills" @click="emit('openSkills')">
          <template #icon><Wrench :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="封面工作台" @click="emit('openCoverWorkbench')">
          <template #icon><ImagePlus :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="设置" @click="emit('openSettings')">
          <template #icon><Settings2 :size="20" /></template>
        </n-button>
      </div>

      <n-button type="primary" size="large" class="create-btn" @click="emit('create')">
        <template #icon><Plus :size="20" /></template>
        新建作品
      </n-button>
    </div>
  </header>
</template>

<style scoped>
.homepage-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
  padding-bottom: 10px;
}

.hero-copy {
  min-width: 0;
}

.hero-copy h1 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 720;
  letter-spacing: -0.04em;
}

.hero-copy p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-weak);
}

.create-btn {
  border-radius: 12px !important;
  font-weight: 700 !important;
  padding: 0 20px !important;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--arc-primary) 25%, transparent);
}

@media (max-width: 720px) {
  .homepage-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
    flex-direction: column-reverse;
    align-items: stretch;
    gap: 12px;
  }

  .action-group {
    justify-content: center;
  }

  .create-btn {
    width: 100%;
  }
}
</style>
