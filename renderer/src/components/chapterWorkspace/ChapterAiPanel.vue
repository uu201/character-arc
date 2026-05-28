<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { BookOpen, FileText, GitMerge, Globe, Plus, Route, Sparkles, Users, X } from 'lucide-vue-next'
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
const { messages, isResponding, agentStatus, hasSelection, enabledContextModules, toggleContextModule, send, stop, resetMessages, applyToChapter, registerStreamListener: registerChatStream, unregisterStreamListener: unregisterChatStream } = useChapterAi()
const draft = useChapterFirstDraft()
const detect = useChapterThreadDetect()
const summary = useChapterSummary()
const inspiration = useChapterInspiration()
const humanize = useChapterHumanize()

const contextChips = computed(() => {
  const chapter = appStore.selectedChapter
  const chips: { label: string; icon: string; module: import('./useChapterAi').ContextModule; available: boolean }[] = []
  chips.push({ label: '当前章节', icon: 'file-text', module: 'chapter', available: !!chapter })
  chips.push({ label: '章节大纲', icon: 'git-merge', module: 'outline', available: appStore.outlineItems.length > 0 })
  chips.push({ label: '角色卡', icon: 'users', module: 'characters', available: appStore.characters.length > 0 })
  chips.push({ label: '世界观', icon: 'globe', module: 'worldview', available: appStore.worldviewEntries.length > 0 })
  chips.push({ label: '剧情线索', icon: 'route', module: 'plotThreads', available: appStore.plotThreads.length > 0 })
  chips.push({ label: '知识文档', icon: 'book-open', module: 'knowledge', available: appStore.knowledgeDocuments.length > 0 })
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
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="icon-btn" :disabled="isResponding" @click="resetMessages">
              <Plus :size="13" />
            </button>
          </template>
          新对话
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="icon-btn" @click="$emit('close')"><X :size="13" /></button>
          </template>
          关闭
        </n-tooltip>
      </div>
    </header>

    <div class="context-strip">
      <span class="context-label">上下文</span>
      <span
        v-for="chip in contextChips"
        :key="chip.module"
        class="ctx-chip"
        :class="{ active: chip.available && enabledContextModules.has(chip.module), inactive: !chip.available || !enabledContextModules.has(chip.module) }"
        @click="chip.available && toggleContextModule(chip.module)"
      >
        <FileText v-if="chip.icon === 'file-text'" :size="11" />
        <GitMerge v-if="chip.icon === 'git-merge'" :size="11" />
        <Users v-if="chip.icon === 'users'" :size="11" />
        <Globe v-if="chip.icon === 'globe'" :size="11" />
        <Route v-if="chip.icon === 'route'" :size="11" />
        <BookOpen v-if="chip.icon === 'book-open'" :size="11" />
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

    <div v-if="agentStatus" class="agent-status">
      <span class="agent-pulse" />
      <span>{{ agentStatus }}</span>
    </div>

    <ChapterAiInput :disabled="isResponding" @send="send" @stop="stop" />

    <ChapterFirstDraftDialog
      :show="draft.modalVisible.value"
      :is-generating="draft.isGenerating.value"
      :is-stopping="draft.isStopping.value"
      :is-auditing="draft.isAuditing.value"
      :is-streaming="draft.isStreaming.value"
      :execution-label="draft.executionLabel.value"
      :preview-title="draft.previewTitle.value"
      :preview-content="draft.previewContent.value"
      :progress-percent="draft.progressPercent.value"
      :progress-text="draft.progressText.value"
      :audit-result="draft.auditResult.value"
      :elapsed-seconds="draft.elapsedSeconds.value"
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
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.context-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-hint);
  margin-right: 2px;
  user-select: none;
}

.ctx-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  user-select: none;
  border: 1px solid transparent;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.ctx-chip.active {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 18%, transparent);
  color: var(--arc-primary);
}

.ctx-chip.active:hover {
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-primary) 28%, transparent);
}

.ctx-chip.inactive {
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  border-color: var(--arc-border);
  text-decoration: line-through;
  text-decoration-color: var(--arc-border-strong);
}

.ctx-chip.inactive:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
  border-color: var(--arc-border-strong);
  text-decoration: none;
}

.selection-hint {
  padding: 6px 16px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  border-bottom: 1px solid var(--arc-border);
}

.agent-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
  border-top: 1px solid var(--arc-border);
}

.agent-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-primary);
  animation: agent-pulse-ring 1.4s ease-in-out infinite;
}

@keyframes agent-pulse-ring {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.4); }
}
</style>
