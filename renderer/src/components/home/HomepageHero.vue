<script setup lang="ts">
import { Bell, ImagePlus, LibraryBig, Plus, RefreshCw, Settings2, Wrench } from 'lucide-vue-next'
import { NButton } from 'naive-ui'
import type { StatusIndicator } from '@/composables/useStartupCheck'

defineProps<{
  announcementStatus?: StatusIndicator
  updateStatus?: StatusIndicator
}>()

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'openDeconstruction'): void
  (e: 'openCoverWorkbench'): void
  (e: 'openSkills'): void
  (e: 'openSettings'): void
  (e: 'openAnnouncement'): void
  (e: 'checkUpdate'): void
}>()
</script>

<template>
  <header class="homepage-hero">
    <div class="hero-copy">
      <h1>我的作品</h1>
      <p>选择一个项目继续写作，或开始新的作品。</p>
    </div>

    <div class="hero-actions">
      <button class="hero-icon-btn" title="公告" @click="emit('openAnnouncement')">
        <Bell :size="18" />
        <span v-if="announcementStatus && announcementStatus !== 'none'" class="status-dot" :class="`status-dot--${announcementStatus}`" />
      </button>
      <button class="hero-icon-btn" title="检查更新" @click="emit('checkUpdate')">
        <RefreshCw :size="18" />
        <span v-if="updateStatus && updateStatus !== 'none'" class="status-dot" :class="`status-dot--${updateStatus}`" />
      </button>

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
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--arc-border);
}

.hero-copy {
  min-width: 0;
}

.hero-copy h1 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 740;
  letter-spacing: -0.03em;
}

.hero-copy p {
  margin: 6px 0 0;
  color: var(--arc-text-hint);
  font-size: 14px;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.hero-icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition:
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    color 0.2s,
    background 0.2s,
    transform 0.15s;
}

.hero-icon-btn:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
  background: var(--arc-bg-weak);
  transform: translateY(-1px);
}

.hero-icon-btn:active {
  transform: translateY(0) scale(0.96);
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
  border-radius: 10px !important;
  font-weight: 700 !important;
  padding: 0 18px !important;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 18%, transparent);
}

@media (max-width: 720px) {
  .homepage-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .action-group {
    justify-content: center;
  }

  .create-btn {
    flex: 1;
    justify-content: center;
  }
}

.status-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  pointer-events: none;
}

.status-dot--new {
  background: #f43f5e;
  box-shadow: 0 0 0 2px var(--arc-bg-surface);
}

.status-dot--error {
  background: #f59e0b;
  box-shadow: 0 0 0 2px var(--arc-bg-surface);
}
</style>
