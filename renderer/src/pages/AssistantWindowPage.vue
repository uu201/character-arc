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
  background:
    linear-gradient(180deg, #f4f6fb, #f7f9fc 24%, #eef2f7 100%),
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 10%, white), transparent 28%),
    radial-gradient(circle at bottom left, rgba(255, 255, 255, 0.82), transparent 26%);
}

.assistant-window-frame {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 26px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(244, 248, 253, 0.9));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.88),
    0 28px 70px rgba(15, 23, 42, 0.08);
}

.assistant-window-frame :deep(.assistant-shell) {
  width: 100%;
  min-width: 0;
  border-left: none;
  background:
    linear-gradient(180deg, rgba(249, 251, 254, 0.94), rgba(241, 245, 251, 0.98)),
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 8%, white), transparent 32%);
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
  border-radius: 18px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
}

.assistant-window-empty strong {
  color: #111827;
  font-size: 16px;
}

.assistant-window-empty p {
  max-width: 260px;
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 720px) {
  .assistant-window-page {
    padding: 10px;
  }

  .assistant-window-frame {
    border-radius: 20px;
  }
}
</style>
