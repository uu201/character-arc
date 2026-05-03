<script setup lang="ts">
import { computed } from 'vue'
import { Bot } from 'lucide-vue-next'
import AiAssistantPanel from '@/components/AiAssistantPanel.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

// 判断当前是否具备章节上下文：必须同时存在项目和已选中的章节
// 有上下文时显示 AI 助手面板，否则显示等待提示
const hasChapterContext = computed(() => Boolean(appStore.currentProject && appStore.selectedChapter))
</script>

<template>
  <section class="assistant-window-page">
    <div v-if="hasChapterContext" class="assistant-window-frame">
      <AiAssistantPanel />
    </div>

    <div v-else class="assistant-window-empty">
      <div class="assistant-window-empty-badge">
        <Bot :size="20" />
      </div>
      <strong>等待章节上下文</strong>
      <p>请先在主窗口进入章节创作页，再使用独立 AI 创作助理。</p>
    </div>
  </section>
</template>

<style scoped>
.assistant-window-page {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  background: var(--arc-bg-body);
}

.assistant-window-frame {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-sm);
}

.assistant-window-frame :deep(.assistant-shell) {
  width: 100%;
  min-width: 0;
  border-left: none;
  background: var(--arc-bg-surface);
}

.assistant-window-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  text-align: center;
}

.assistant-window-empty-badge {
  display: inline-flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.assistant-window-empty strong {
  color: var(--arc-text-primary);
  font-size: 16px;
}

.assistant-window-empty p {
  max-width: 260px;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 720px) {
  .assistant-window-page {
    padding: 10px;
  }

  .assistant-window-frame {
    border-radius: 10px;
  }
}
</style>
