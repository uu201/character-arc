<script setup lang="ts">
import { ref } from 'vue'
import { NButton } from 'naive-ui'

const props = defineProps<{
  modelValue: string
  isStreaming: boolean
  modeLabel?: string
  streamingCharCount?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'cancel'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  autosize(target)
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(180, el.scrollHeight) + 'px'
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (props.isStreaming) return
    emit('send')
  }
}
</script>

<template>
  <div class="composer-wrap">
    <div class="composer" :class="{ streaming: props.isStreaming }">
      <textarea
        ref="textareaRef"
        :value="props.modelValue"
        placeholder="继续追问，或让助理动手。Enter 发送 · Shift+Enter 换行"
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <div class="foot">
        <div class="hint">
          <span v-if="props.modeLabel" class="mode-chip">{{ props.modeLabel }}</span>
          <span v-if="props.isStreaming" class="streaming-hint">
            <span class="streaming-dot" />AI 正在回答<template v-if="props.streamingCharCount && props.streamingCharCount > 0"> · 已生成 {{ props.streamingCharCount }} 字</template>
          </span>
          <span v-else>AI的修改会显示在暂存区，需要你逐条确认。</span>
        </div>
        <div class="actions">
          <NButton
            v-if="props.isStreaming"
            size="small"
            @click="emit('cancel')"
          >
            停止
          </NButton>
          <NButton
            v-else
            size="small"
            type="primary"
            :disabled="!props.modelValue.trim()"
            @click="emit('send')"
          >
            发送
          </NButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  padding: 12px 32px 22px;
  background: linear-gradient(180deg, transparent, var(--arc-bg-body) 30%);
}
.composer {
  max-width: 720px;
  margin: 0 auto;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  border-radius: 16px;
  padding: 12px 14px 10px;
  box-shadow: var(--arc-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
.composer.streaming {
  border-color: rgba(13, 125, 90, 0.4);
  box-shadow: 0 0 0 3px rgba(13, 125, 90, 0.06), var(--arc-shadow-md);
}
textarea {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--arc-text-primary);
  min-height: 40px;
  max-height: 180px;
  line-height: 1.5;
  padding: 0;
  font-size: 14px;
}
textarea::placeholder {
  color: var(--arc-text-hint);
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hint {
  font-size: 11.5px;
  color: var(--arc-text-hint);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.mode-chip {
  flex: 0 1 auto;
  max-width: 160px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}
.hint > span:not(.mode-chip):not(.streaming-hint) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.streaming-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--arc-primary);
  font-weight: 500;
}
.streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--arc-primary);
  animation: streamPulse 1.4s ease-in-out infinite;
}
@keyframes streamPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.actions {
  display: flex;
  gap: 6px;
}
</style>
