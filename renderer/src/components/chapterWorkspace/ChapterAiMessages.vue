<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDown, Copy, Replace, RotateCw } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import type { ChapterAiMessage } from './useChapterAi'

const props = defineProps<{
  messages: ChapterAiMessage[]
  isResponding: boolean
  hasSelection: boolean
}>()

const emit = defineEmits<{
  apply: [content: string, mode: 'cursor' | 'append' | 'replace-selection']
  regenerate: [prompt: string]
}>()

const message = useMessage()
const scrollRef = ref<HTMLDivElement | null>(null)

const lastMsg = computed(() => props.messages[props.messages.length - 1])

watch(
  () => [props.messages.length, lastMsg.value?.content] as const,
  () => nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  })
)

function isStreaming(msg: ChapterAiMessage): boolean {
  return props.isResponding && msg.id === lastMsg.value?.id && msg.role === 'assistant'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function findUserPromptBefore(msgId: string): string | undefined {
  const idx = props.messages.findIndex((m) => m.id === msgId)
  if (idx <= 0) return undefined
  for (let i = idx - 1; i >= 0; i--) {
    if (props.messages[i].role === 'user') return props.messages[i].content
  }
  return undefined
}

async function copyMessage(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
    message.success('已复制')
  } catch {
    message.error('复制失败')
  }
}
</script>

<template>
  <div ref="scrollRef" class="messages arc-scrollbar">
    <div v-if="!messages.length && !isResponding" class="empty">
      问问 AI 怎么写下一段、改写当前段落，或基于大纲给建议。
    </div>

    <div v-for="msg in messages" :key="msg.id" class="msg" :class="msg.role">
      <div class="bubble" :class="{ streaming: isStreaming(msg) }">
        <template v-if="msg.content">{{ msg.content }}</template>
        <template v-else-if="isStreaming(msg)">
          <span class="dot" /><span class="dot" /><span class="dot" />
        </template>
        <span v-if="isStreaming(msg) && msg.content" class="cursor" />
      </div>
      <div v-if="msg.role === 'assistant' && !isStreaming(msg) && msg.content" class="actions">
        <button
          v-if="hasSelection"
          class="mini primary"
          title="替换当前选区"
          @click="emit('apply', msg.content, 'replace-selection')"
        >
          <Replace :size="11" /> 替换选区
        </button>
        <button
          class="mini"
          title="插入到光标处"
          @click="emit('apply', msg.content, 'cursor')"
        >
          <ArrowDown :size="11" /> 插入光标
        </button>
        <button class="mini" title="复制" @click="copyMessage(msg.content)">
          <Copy :size="11" />
        </button>
        <button
          class="mini"
          title="重新生成"
          :disabled="isResponding"
          @click="() => { const p = findUserPromptBefore(msg.id); if (p) emit('regenerate', p) }"
        >
          <RotateCw :size="11" /> 重生成
        </button>
      </div>
      <div v-if="msg.role === 'assistant' && !isStreaming(msg) && msg.createdAt" class="msg-meta">
        {{ formatTime(msg.createdAt) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty {
  margin: auto;
  text-align: center;
  font-size: 13px;
  color: var(--arc-text-hint);
  max-width: 240px;
  line-height: 1.7;
  padding: 32px 0;
}

.msg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: text;
}

.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }

.bubble {
  max-width: 92%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg.user .bubble {
  background: var(--arc-primary);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 20%, transparent);
}

.msg.assistant .bubble {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
  border-bottom-left-radius: 4px;
}

.bubble.streaming {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
}

.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--arc-primary);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-text-hint);
  animation: bounce 1.2s infinite;
  margin-right: 4px;
}

.dot:nth-child(2) { animation-delay: 0.15s; }
.dot:nth-child(3) { animation-delay: 0.3s; margin-right: 0; }

@keyframes bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 2px;
}

.mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 14px;
  background: var(--arc-bg-surface);
  font-size: 11.5px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.mini:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.mini:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.mini.primary {
  background: var(--arc-primary);
  color: white;
  border-color: var(--arc-primary);
}

.mini.primary:hover {
  background: var(--arc-primary-hover);
  color: white;
}

.msg-meta {
  font-size: 11px;
  color: var(--arc-text-hint);
  padding: 0 4px;
  letter-spacing: 0.01em;
}
</style>
