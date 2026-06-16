<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { GitCompare, History, Plus, Sparkles, Trash2, X } from 'lucide-vue-next'
import { NTooltip, useMessage } from 'naive-ui'
import ChapterAiMessages from './ChapterAiMessages.vue'
import ChapterAiInput from './ChapterAiInput.vue'
import ChapterFirstDraftDialog from './ChapterFirstDraftDialog.vue'
import ChapterThreadDetectDialog from './ChapterThreadDetectDialog.vue'
import GlobalAssistantDiffReviewDialog from '@/components/GlobalAssistantDiffReviewDialog.vue'
import { useChapterAi } from './useChapterAi'
import { useChapterFirstDraft, type FirstDraftConfig } from './useChapterFirstDraft'
import { useChapterThreadDetect } from './useChapterThreadDetect'
import { useChapterSummary } from './useChapterSummary'
import { useChapterInspiration, type ChapterInspirationFocus } from './useChapterInspiration'
import { useChapterHumanize } from './useChapterHumanize'
import { useAppStore } from '@/stores/app'
import { getResolvedChapterAssistantTemplates, chapterAssistantQuickActionGroups } from '@/features/ai/chapterAssistantOptions'
import type { ChapterInsertionMode } from '@/types/app'
import type { ContextModule } from './useChapterAi'

defineEmits<{
  close: []
}>()

const message = useMessage()
const appStore = useAppStore()

const showSessionList = ref(false)
const showCommandPanel = ref(false)
const showContextPanel = ref(false)

const { messages, isResponding, agentStatus, hasSelection, selectedText, enabledContextModules, toggleContextModule, currentSessionId, sessions, send, stop, resetMessages, newSession, saveCurrentSession, loadSession, deleteSession, refreshSessions, applyToChapter, registerStreamListener: registerChatStream, unregisterStreamListener: unregisterChatStream, showDiffReview, pendingEditProposals, proposalDiffFiles, proposalDiffPatch, proposalDiffStats, acceptEditProposal, acceptAllEditProposals, rejectEditProposal, clearEditProposals } = useChapterAi()

const draft = useChapterFirstDraft()
const detect = useChapterThreadDetect()
const summary = useChapterSummary()
const inspiration = useChapterInspiration()
const humanize = useChapterHumanize()

const enabledContextCount = computed(() => enabledContextModules.size)

const selectionPreview = computed(() => {
  const text = selectedText.value
  if (!text) return ''
  const snippet = text.length > 20 ? text.slice(0, 20) + '...' : text
  return `已选「${snippet}」(${text.length}字)`
})

const commandTemplates = computed(() => {
  return getResolvedChapterAssistantTemplates(appStore.currentProject)
})

const groupedCommands = computed(() => {
  const templates = commandTemplates.value
  return chapterAssistantQuickActionGroups.map((group) => ({
    ...group,
    items: templates.filter((t) => t.group === group.key)
  })).filter((g) => g.items.length > 0)
})

const contextModules: { module: ContextModule; label: string }[] = [
  { module: 'chapter', label: '当前章节' },
  { module: 'outline', label: '章节大纲' },
  { module: 'characters', label: '角色卡' },
  { module: 'worldview', label: '世界观' },
  { module: 'plotThreads', label: '剧情线索' },
  { module: 'knowledge', label: '项目知识库' },
  { module: 'deconstructionLibrary', label: '拆书知识库' }
]

function closeAllPanels(): void {
  showCommandPanel.value = false
  showContextPanel.value = false
  showSessionList.value = false
}

function toggleCommands(): void {
  const next = !showCommandPanel.value
  closeAllPanels()
  showCommandPanel.value = next
}

function toggleContext(): void {
  const next = !showContextPanel.value
  closeAllPanels()
  showContextPanel.value = next
}

function toggleSessions(): void {
  const next = !showSessionList.value
  closeAllPanels()
  showSessionList.value = next
  if (next) void refreshSessions()
}

function handleNewSession(): void {
  if (messages.value.length > 0) {
    void (async () => {
      try {
        await saveCurrentSession()
        newSession()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '保存历史会话失败')
      }
    })()
    return
  }
  newSession()
}

async function handleLoadSession(sessionId: string): Promise<void> {
  try {
    if (messages.value.length > 0 && currentSessionId.value !== sessionId) {
      await saveCurrentSession()
    }
    await loadSession(sessionId)
    showSessionList.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载历史会话失败')
  }
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  try {
    await deleteSession(sessionId)
    message.success('已删除历史会话')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除历史会话失败')
  }
}

function handleApply(content: string, mode: ChapterInsertionMode): void {
  const ok = applyToChapter(content, mode)
  if (!ok) {
    message.warning('当前没有可写入的章节')
    return
  }
  message.success(mode === 'replace-selection' ? '已替换选中内容' : '已插入到正文')
}

function handleCommandSelect(prompt: string): void {
  closeAllPanels()
  void send(prompt)
}

async function handleDraft(config?: FirstDraftConfig): Promise<void> {
  if (!config) return
  closeAllPanels()
  try { await draft.start(config) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 初稿生成失败') }
}

async function handleDetect(): Promise<void> {
  closeAllPanels()
  const result = await detect.start()
  if (!result.ok) message.warning(result.reason ?? '识别失败')
}

async function handleSummary(): Promise<void> {
  closeAllPanels()
  const result = await summary.generate()
  if (!result.ok) message.warning(result.reason ?? '生成摘要失败')
  else message.success('已生成章节摘要')
}

async function handleInspiration(focus: ChapterInspirationFocus): Promise<void> {
  closeAllPanels()
  const result = await inspiration.generate(focus)
  if (!result.ok) message.warning(result.reason ?? '本章灵感生成失败')
  else message.success(`已为当前章节生成 ${result.count} 张${focus}灵感卡`)
}

async function handleHumanize(): Promise<void> {
  closeAllPanels()
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

function triggerDraft(config?: FirstDraftConfig): void {
  void handleDraft(config)
}

defineExpose({ sendPrompt, triggerDraft })

onMounted(() => {
  registerChatStream()
  draft.registerStreamListener()
  void refreshSessions()
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
            <button class="icon-btn" :disabled="isResponding" @click="handleNewSession">
              <Plus :size="13" />
            </button>
          </template>
          新对话
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="icon-btn" :class="{ active: showSessionList }" @click="toggleSessions">
              <History :size="13" />
            </button>
          </template>
          历史会话
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="icon-btn" @click="$emit('close')"><X :size="13" /></button>
          </template>
          关闭
        </n-tooltip>
      </div>
    </header>

    <!-- 会话列表 popover -->
    <div v-if="showSessionList" class="session-list">
      <div v-if="sessions.length === 0" class="session-empty">暂无历史会话</div>
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: currentSessionId === session.id }"
        @click="handleLoadSession(session.id)"
      >
        <span class="session-item-title">{{ session.title }}</span>
        <button class="session-item-delete" title="删除" @click.stop="handleDeleteSession(session.id)">
          <Trash2 :size="11" />
        </button>
      </div>
    </div>

    <!-- 消息区域 -->
    <ChapterAiMessages
      :messages="messages"
      :is-responding="isResponding"
      :has-selection="hasSelection"
      @apply="handleApply"
      @regenerate="send"
      @undo="handleUndoEdit"
      @send="send"
    />

    <!-- Agent 状态条 -->
    <div v-if="agentStatus" class="agent-status">
      <span class="agent-pulse" />
      <span>{{ agentStatus }}</span>
    </div>

    <!-- 待审查编辑提示条 -->
    <div v-if="pendingEditProposals.length > 0 && !showDiffReview" class="ai-pending-review-bar" @click="showDiffReview = true">
      <GitCompare :size="13" />
      <span>{{ pendingEditProposals.length }} 项编辑待审查</span>
      <span class="ai-pending-review-action">点击查看</span>
    </div>

    <!-- Composer 输入区 -->
    <ChapterAiInput
      :disabled="isResponding"
      :has-selection="hasSelection"
      :selection-preview="selectionPreview"
      :enabled-context-count="enabledContextCount"
      @send="send"
      @stop="stop"
      @open-commands="toggleCommands"
      @open-context="toggleContext"
      @clear-selection="appStore.currentChapterSelection = null"
    />

    <!-- 指令面板 popover -->
    <Teleport to="body">
      <div v-if="showCommandPanel" class="popover-overlay" @click.self="closeAllPanels">
        <div class="popover-card command-popover">
          <div class="popover-header">
            <span class="popover-title">快捷指令</span>
            <span class="popover-hint">基于上下文快速执行</span>
          </div>
          <div class="popover-scroll">
            <div v-for="group in groupedCommands" :key="group.key" class="command-group">
              <div class="command-group-label">{{ group.label }}</div>
              <button
                v-for="item in group.items"
                :key="item.id"
                class="command-item"
                :disabled="item.requiresSelection && !hasSelection"
                @click="handleCommandSelect(item.prompt)"
              >
                <component :is="item.icon" :size="14" class="command-item-icon" />
                <div class="command-item-body">
                  <span class="command-item-title">{{ item.label }}</span>
                </div>
                <span v-if="item.requiresSelection" class="command-item-badge">需选区</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 上下文面板 popover -->
    <Teleport to="body">
      <div v-if="showContextPanel" class="popover-overlay" @click.self="closeAllPanels">
        <div class="popover-card context-popover">
          <div class="popover-header">
            <span class="popover-title">上下文模块</span>
            <span class="popover-hint">启用后作为背景发送</span>
          </div>
          <div class="ctx-list">
            <div
              v-for="mod in contextModules"
              :key="mod.module"
              class="ctx-item"
              :class="{ active: enabledContextModules.has(mod.module) }"
              @click="toggleContextModule(mod.module)"
            >
              <span class="ctx-item-label">{{ mod.label }}</span>
              <div class="ctx-item-toggle" />
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 对话框 -->
    <ChapterFirstDraftDialog
      :show="draft.modalVisible.value"
      :is-generating="draft.isGenerating.value"
      :is-stopping="draft.isStopping.value"
      :is-auditing="draft.isAuditing.value"
      :is-streaming="draft.isStreaming.value"
      :execution-label="draft.executionLabel.value"
      :reasoning-content="draft.reasoningContent.value"
      :preview-title="draft.previewTitle.value"
      :preview-content="draft.previewContent.value"
      :progress-percent="draft.progressPercent.value"
      :progress-text="draft.progressText.value"
      :audit-result="draft.auditResult.value"
      :elapsed-seconds="draft.elapsedSeconds.value"
      @stop="async () => { try { await draft.stop() } catch (e) { message.error(e instanceof Error ? e.message : '停止失败') } }"
      @close="draft.closeModal()"
    />

    <ChapterThreadDetectDialog
      :show="detect.modalVisible.value"
      :detected="detect.detected.value"
      @update:show="(v) => (detect.modalVisible.value = v)"
      @confirm="() => { const count = detect.confirmAdd(); if (count === 0) message.warning('请至少选择一条线索'); else message.success(`已添加 ${count} 条剧情线索`) }"
    />

    <GlobalAssistantDiffReviewDialog
      v-model:show="showDiffReview"
      summary="AI 章节编辑审查"
      :patch="proposalDiffPatch"
      :files="proposalDiffFiles"
      :stats="proposalDiffStats"
      @apply-file="acceptEditProposal"
      @apply-all="acceptAllEditProposals"
      @regenerate="clearEditProposals"
      @clear="clearEditProposals"
    />
  </aside>
</template>

<style scoped>
.ai-pending-review-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 6%, var(--arc-bg-surface, #ffffff));
  border: 1px solid color-mix(in srgb, var(--arc-primary, #2563eb) 20%, var(--arc-border, #e5e7eb));
  color: var(--arc-primary, #2563eb);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.ai-pending-review-bar:hover {
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 10%, var(--arc-bg-surface, #ffffff));
}

.ai-pending-review-action {
  margin-left: auto;
  font-weight: 500;
  opacity: 0.7;
}

.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--arc-bg-surface);
  border-left: 1px solid var(--arc-border);
  overflow: visible;
  position: relative;
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

.ai-title svg { color: var(--arc-primary); }

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

.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn.active { background: var(--arc-primary-soft); color: var(--arc-primary); }

/* ── Session List ── */
.session-list {
  max-height: 200px;
  overflow-y: auto;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-empty {
  padding: 12px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.session-item:hover { background: var(--arc-bg-surface-hover); }
.session-item.active { background: var(--arc-primary-soft); }

.session-item-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item.active .session-item-title { color: var(--arc-primary); }

.session-item-delete {
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  flex-shrink: 0;
}

.session-item:hover .session-item-delete { display: inline-flex; }
.session-item-delete:hover { color: #dc2626; background: #fef2f2; }

/* ── Agent Status ── */
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

<style>
.popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 0 12px 180px 0;
}

.popover-card {
  width: 340px;
  max-height: 400px;
  border-radius: 14px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.1), 0 4px 12px -2px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: popover-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes popover-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.popover-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--arc-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.popover-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.popover-hint {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.popover-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--arc-border) transparent;
}

/* ── Command Panel ── */
.command-group {
  margin-bottom: 8px;
}

.command-group-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--arc-text-hint);
  padding: 6px 8px 4px;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: var(--arc-text-primary);
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 0.12s;
}

.command-item:hover:not(:disabled) {
  background: var(--arc-bg-surface-hover);
}

.command-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.command-item-icon {
  color: var(--arc-primary);
  flex-shrink: 0;
}

.command-item-body {
  flex: 1;
  min-width: 0;
}

.command-item-title {
  font-size: 12px;
  font-weight: 550;
}

.command-item-badge {
  font-size: 9.5px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

/* ── Context Panel ── */
.ctx-list {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}

.ctx-item:hover {
  background: var(--arc-bg-surface-hover);
}

.ctx-item-label {
  flex: 1;
  font-size: 12.5px;
  color: var(--arc-text-primary);
}

.ctx-item-toggle {
  width: 32px;
  height: 18px;
  border-radius: 999px;
  background: var(--arc-border-strong);
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}

.ctx-item.active .ctx-item-toggle {
  background: var(--arc-primary);
}

.ctx-item-toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.ctx-item.active .ctx-item-toggle::after {
  transform: translateX(14px);
}
</style>
