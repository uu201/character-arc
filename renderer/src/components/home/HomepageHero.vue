<script setup lang="ts">
import { Plus, Settings2 } from 'lucide-vue-next'
import { NButton } from 'naive-ui'

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'openSettings'): void
}>()
</script>

<template>
  <header class="homepage-hero arc-drag-region">
    <div class="hero-copy">
      <h1>我的作品</h1>
      <p>选择一个项目继续写作，或开始新的作品。</p>
    </div>

    <div class="hero-actions arc-no-drag">
      <n-button size="large" class="hero-btn arc-no-drag" @click="emit('openSettings')">
        <template #icon><Settings2 :size="18" /></template>
        设置
      </n-button>
      <n-button type="primary" size="large" class="hero-btn arc-no-drag" @click="emit('create')">
        <template #icon><Plus :size="18" /></template>
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
  gap: 10px;
  flex-shrink: 0;
}

.hero-btn {
  border-radius: 14px !important;
  font-weight: 650;
}

@media (max-width: 720px) {
  .homepage-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
  }

  .hero-actions :deep(.n-button) {
    flex: 1;
  }
}
</style>
