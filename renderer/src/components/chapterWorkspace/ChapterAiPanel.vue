<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { FileText, GitMerge, Globe, Plus, Sparkles, Users, X } from 'lucide-vue-next'
import { NTooltip, useMessage } from 'naive-ui'
import ChapterAiMessages from './ChapterAiMessages.vue'
import ChapterAiInput from './ChapterAiInput.vue'
import ChapterAiQuickActions from './ChapterAiQuickActions.vue'
import ChapterFirstDraftDialog from './ChapterFirstDraftDialog.vue'
import ChapterThreadDetectDialog from './ChapterThreadDetectDialog.vue'
import { useChapterAi } from './useChapterAi'
import { useChapterFirstDraft } from './useChapterFirstDraft'
import { useChapterThreadDetect } from './useChapterThreadDetect'
import { useChapterSummary } from './useChapterSummary'
import { useChapterInspiration, type ChapterInspirationFocus } from './useChapterInspiration'
import { useChapterHumanize } from './useChapterHumanize'
import { useAppStore } from '@/stores/app'
import type { ChapterInsertionMode } from '@/types/app'

defineEmits<{
  close: []
}>()

const message = useMessage()
const appStore = useAppStore()
const { messages, isResponding, hasSelection, send, stop, resetMessages, applyToChapter, registerStreamListener: registerChatStream, unregisterStreamListener: unregisterChatStream } = useChapterAi()
const draft = useChapterFirstDraft()
const detect = useChapterThreadDetect()
const summary = useChapterSummary()
const inspiration = useChapterInspiration()
const humanize = useChapterHumanize()

const contextChips = computed(() => {
  const chips: { label: string; icon: string; active: boolean }[] = []
  const chapter = appStore.selectedChapter
  if (chapter) {
    chips.push({ label: '当前章节', icon: 'file-text', active: true })
    if (chapter.summary) {
      chips.push({ label: '章节大纲', icon: 'git-merge', active: true })
    }
  }
  if (appStore.characters.length > 0) {
    chips.push({ label: '角色卡', icon: 'users', active: true })
  }
  if (appStore.worldviewEntries.length > 0) {
    chips.push({ label: '世界观', icon: 'globe', active: true })
  }
  return chips
})

function handleApply(content: string, mode: ChapterInsertionMode): void {
  const ok = applyToChapter(content, mode)
  if (!ok) {
    message.warning('当前没有可写入的章节')
    return
  }
  message.success(mode === 'replace-selection' ? '已替换选中内容' : '已插入到正文')
}

async function handleDraft(): Promise<void> {
  try {
    await draft.start()
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 初稿生成失败')
  }
}

async function handleDetect(): Promise<void> {
  const result = await detect.start()
  if (!result.ok) {
    message.warning(result.reason ?? '识别失败')
  }
}

async function handleStopDraft(): Promise<void> {
  try {
    await draft.stop()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '停止失败')
  }
}

function handleConfirmThreads(): void {
  const count = detect.confirmAdd()
  if (count === 0) message.warning('请至少选择一条线索')
  else message.success(`已添加 ${count} 条剧情线索`)
}

async function handleSummary(): Promise<void> {
  const result = await summary.generate()
  if (!result.ok) message.warning(result.reason ?? '生成摘要失败')
  else message.success('已生成章节摘要')
}

async function handleInspiration(focus: ChapterInspirationFocus): Promise<void> {
  const result = await inspiration.generate(focus)
  if (!result.ok) message.warning(result.reason ?? '本章灵感生成失败')
  else message.success(`已为当前章节生成 ${result.count} 张${focus}灵感卡`)
}

async function handleHumanize(): Promise<void> {
  const result = await humanize.run()
  if (!result.ok) message.warning(result.reason ?? '降低 AI 感失败')
  else message.success('已使用降低 AI 感结果替换选区')
}

async function handleUndoEdit(versionId: string): Promise<void> {
  const result = await appStore.restoreChapterVersion(versionId)
  if (result.success) message.success('已撤销 AI 编辑')
  else message.warning(result.error ?? '撤销失败')
}

function sendPrompt(prompt: string): void {
  void send(prompt)
}

defineExpose({ sendPrompt })

onMounted(() => {
  registerChatStream()
  draft.registerStreamListener()
})
onBeforeUnmount(() => {
  unregisterChatStream()
  draft.unregisterStreamListener()
})
</script>

<template>
  <aside class="ai-panel">
    <header class="ai-header">
      <div class="ai-title">
        <Sparkles :size="14" />
        <span>创作助理</span>
      </div>
      <div class="ai-header-actions">
        <n-tooltip>
          <template #trigger>
            <button class="icon-btn" :disabled="isResponding" @click="resetMessages">
              <Plus :size="13" />
            </button>
          </template>
          新对话
        </n-tooltip>
        <n-tooltip>
          <template #trigger>
            <button class="icon-btn" @click="$emit('close')"><X :size="13" /></button>
          </template>
          关闭
        </n-tooltip>
      </div>
    </header>

    <div v-if="contextChips.length" class="context-strip">
      <span v-for="chip in contextChips" :key="chip.label" class="ctx-chip" :class="{ active: chip.active }">
        <FileText v-if="chip.icon === 'file-text'" :size="11" />
        <GitMerge v-if="chip.icon === 'git-merge'" :size="11" />
        <Users v-if="chip.icon === 'users'" :size="11" />
        <Globe v-if="chip.icon === 'globe'" :size="11" />
        {{ chip.label }}
      </span>
    </div>

    <ChapterAiQuickActions
      :is-draft-running="draft.isGenerating.value"
      :is-detect-running="detect.isDetecting.value"
      :is-summary-running="summary.isGenerating.value"
      :is-inspiration-running="inspiration.isGenerating.value"
      :is-humanize-running="humanize.isRunning.value"
      :has-selection="humanize.hasSelection.value"
      @draft="handleDraft"
      @detect="handleDetect"
      @summary="handleSummary"
      @inspiration="handleInspiration"
      @humanize="handleHumanize"
    />

    <div v-if="hasSelection" class="selection-hint">
      已选中正文片段，回复将带「替换选区」按钮
    </div>

    <ChapterAiMessages
      :messages="messages"
      :is-responding="isResponding"
      :has-selection="hasSelection"
      @apply="handleApply"
      @regenerate="send"
      @undo="handleUndoEdit"
    />

    <ChapterAiInput :disabled="isResponding" @send="send" @stop="stop" />

    <ChapterFirstDraftDialog
      :show="draft.modalVisible.value"
      :is-generating="draft.isGenerating.value"
      :is-stopping="draft.isStopping.value"
      :execution-label="draft.executionLabel.value"
      :streaming-content="draft.streamingContent.value"
      :progress-percent="draft.progressPercent.value"
      :progress-text="draft.progressText.value"
      @stop="handleStopDraft"
      @close="draft.closeModal()"
    />

    <ChapterThreadDetectDialog
      :show="detect.modalVisible.value"
      :detected="detect.detected.value"
      @update:show="(v) => (detect.modalVisible.value = v)"
      @confirm="handleConfirmThreads"
    />
  </aside>
</template>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--arc-bg-surface);
  border-left: 1px solid var(--arc-border);
  overflow: hidden;
}

.ai-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--arc-border);
}

.ai-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.ai-title svg {
  color: var(--arc-primary);
}

.ai-header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: 0.15s;
}

.icon-btn:hover:not(:disabled) {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.context-strip {
  padding: 8px 12px;
  background: var(--arc-bg-weak);
  border-bottom: 1px solid var(--arc-border);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ctx-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  font-size: 11px;
  color: var(--arc-text-secondary);
}

.ctx-chip.active {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 20%, transparent);
  color: var(--arc-primary);
}

.selection-hint {
  padding: 6px 16px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  border-bottom: 1px solid var(--arc-border);
}
</style>
