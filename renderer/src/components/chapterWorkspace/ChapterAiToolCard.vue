<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Edit3, Loader2, Search, List, CheckCircle2, XCircle } from 'lucide-vue-next'
import type { ChapterAiToolCall } from './useChapterAi'

const props = defineProps<{
  toolCall: ChapterAiToolCall
}>()

const toolLabel = computed(() => {
  switch (props.toolCall.toolName) {
    case 'read_chapter': return '读取章节'
    case 'edit_chapter': return '编辑章节'
    case 'search_project': return '搜索项目'
    case 'list_chapters': return '章节列表'
    default: return props.toolCall.toolName
  }
})

const toolIcon = computed(() => {
  switch (props.toolCall.toolName) {
    case 'read_chapter': return BookOpen
    case 'edit_chapter': return Edit3
    case 'search_project': return Search
    case 'list_chapters': return List
    default: return Search
  }
})
</script>

<template>
  <div class="tool-card" :class="toolCall.status">
    <div class="tool-header">
      <component :is="toolIcon" :size="12" />
      <span class="tool-label">{{ toolLabel }}</span>
      <Loader2 v-if="toolCall.status === 'running'" :size="12" class="spinner" />
      <CheckCircle2 v-else-if="toolCall.status === 'done'" :size="12" class="icon-done" />
      <XCircle v-else-if="toolCall.status === 'error'" :size="12" class="icon-error" />
      <span v-if="toolCall.durationMs" class="tool-duration">{{ toolCall.durationMs }}ms</span>
    </div>
    <div v-if="toolCall.result && toolCall.status !== 'running'" class="tool-result">
      {{ toolCall.result }}
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  font-size: 12px;
  margin: 4px 0;
}

.tool-card.error {
  border-color: #fca5a5;
  background: #fef2f2;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--arc-text-secondary);
}

.tool-label {
  font-weight: 500;
  color: var(--arc-text-primary);
}

.spinner {
  animation: spin 1s linear infinite;
  color: var(--arc-primary);
}

.icon-done { color: #16a34a; }
.icon-error { color: #dc2626; }

.tool-duration {
  margin-left: auto;
  font-size: 10px;
  color: var(--arc-text-hint);
  font-variant-numeric: tabular-nums;
}

.tool-result {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  font-size: 11px;
  line-height: 1.5;
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
