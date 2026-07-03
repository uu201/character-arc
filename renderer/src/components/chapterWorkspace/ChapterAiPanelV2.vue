<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import {
  History,
  MessageSquareText,
  Plus,
  Sparkles,
  SquareStack,
  X
} from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { type useAssistant } from '@/composables/useAssistant'
import AssistantSessionList from '@/components/assistantV2/AssistantSessionList.vue'
import AssistantMessages from '@/components/assistantV2/AssistantMessages.vue'
import AssistantComposer from '@/components/assistantV2/AssistantComposer.vue'
import StagedChangesView from '@/components/assistantV2/StagedChangesView.vue'
import ChapterFirstDraftDialog from './ChapterFirstDraftDialog.vue'
import { useChapterFirstDraft, type FirstDraftConfig } from './useChapterFirstDraft'

const props = defineProps<{
  /** 由父级 ChapterWorkspace 持有的 assistant 实例，避免 v-if 销毁时丢失暂存状态 */
  assistant: ReturnType<typeof useAssistant>
}>()

const emit = defineEmits<{
  close: []
  'generate-draft': []
}>()

const appStore = useAppStore()
const { selectedChapter } = storeToRefs(appStore)
const message = useMessage()

// 使用父级传入的实例
const assistant = props.assistant

const composerValue = computed({
  get: () => assistant.composerValue.value,
  set: (value) => { assistant.composerValue.value = value }
})

type PanelTab = 'chat' | 'staged' | 'sessions'
type ChapterMode = 'chat' | 'diagnose' | 'polish'

const activeTab = ref<PanelTab>('chat')
const activeMode = ref<ChapterMode>('chat')
const isCommitting = ref(false)

const draft = useChapterFirstDraft()

const modeOptions: Array<{ id: ChapterMode; label: string; description: string }> = [
  { id: 'chat', label: '对话', description: '问答、分析、建议' },
  { id: 'diagnose', label: '诊断', description: '检查问题并给建议' },
  { id: 'polish', label: '改写', description: '直接输出修改提案' }
]

const quickActions: Record<ChapterMode, Array<{ label: string; prompt: string }>> = {
  chat: [
    { label: '分析这段', prompt: '分析当前选中段落的写作问题和改进方向' },
    { label: '续写建议', prompt: '基于当前章节上下文，给出续写方向建议' },
    { label: '节奏检查', prompt: '检查当前章节的叙事节奏和信息密度' }
  ],
  diagnose: [
    { label: '全章诊断', prompt: '诊断当前章节的整体问题，给出优先级排序的修改建议' },
    { label: '开头诊断', prompt: '诊断章节开头的吸引力和节奏问题' },
    { label: 'AI味检测', prompt: '检测当前章节中AI感强的表达，并给出修改建议' }
  ],
  polish: [
    { label: '压缩拖沓段落', prompt: '找出拖沓冗余的段落并直接改写压缩' },
    { label: '拆分长句', prompt: '找出过长的句子并拆分改写，让句子长短交替' },
    { label: '降低AI感', prompt: '改写AI味较重的句子，让表达更自然' }
  ]
}

const currentMode = computed(() =>
  modeOptions.find((mode) => mode.id === activeMode.value) ?? modeOptions[0]
)

const stagedBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter((change) =>
    change.status === 'pending' || change.status === 'accepted' || change.status === 'streaming'
  ).length
)

const acceptedCount = computed(() =>
  assistant.stagedChanges.value.filter((change) => change.status === 'accepted').length
)

const activeSessionTitle = computed(() =>
  assistant.activeSession.value?.title || '新对话'
)

const hasSelection = computed(() => Boolean(appStore.currentChapterSelection?.text.trim()))

const selectionHint = computed(() => {
  if (!hasSelection.value) return ''
  const text = appStore.currentChapterSelection?.text.trim() || ''
  const snippet = text.length > 20 ? text.slice(0, 20) + '…' : text
  return `已选「${snippet}」`
})

function fillQuickAction(prompt: string): void {
  activeTab.value = 'chat'
  composerValue.value = prompt
}

function sendWithMode(): void {
  activeTab.value = 'chat'

  const selectionHintSuffix = hasSelection.value ? ':with-selection' : ''
  if (hasSelection.value && appStore.currentChapterSelection) {
    const selection = appStore.currentChapterSelection.text.trim()
    // 选区内容前置到消息，并在 intentHint 中标记有选区
    composerValue.value = `【选中内容】\n${selection}\n\n【用户指令】\n${composerValue.value}`
    // 用完后清除选区，避免下一次发送时重复携带
    appStore.updateChapterSelection(null)
  }

  void assistant.send({
    intentHint: `chapter-assistant-v2:${activeMode.value}${selectionHintSuffix}`
  })
}

function createSession(): void {
  activeTab.value = 'chat'
  void assistant.createSession()
}

function switchSession(sessionId: string): void {
  activeTab.value = 'chat'
  void assistant.switchSession(sessionId)
}

async function handleCommit(ids?: string[]): Promise<void> {
  if (isCommitting.value) return
  isCommitting.value = true
  try {
    const { committed, failed } = await assistant.commitAccepted(ids)
    if (failed > 0 && committed > 0) {
      message.warning(`已写回 ${committed} 项，${failed} 项失败`)
    } else if (failed > 0) {
      message.error(`写回失败：${failed} 项未能提交`)
    } else if (committed > 0) {
      message.success(`已成功写回 ${committed} 项变更`)
    }
  } finally {
    isCommitting.value = false
  }
}

function sendPrompt(prompt: string): void {
  composerValue.value = prompt
  void assistant.send()
}

// 悬浮工具栏调用：携带完整选区文本和动作类型发送
function sendPromptWithAction(action: string, selectionText: string): void {
  activeTab.value = 'chat'
  composerValue.value = `【选中内容】\n${selectionText}\n\n【用户指令】\n${action}以上选中内容`
  // 用完后清除选区，避免后续发送时重复携带
  appStore.updateChapterSelection(null)
  void assistant.send({
    intentHint: `chapter-assistant-v2:polish:with-selection`
  })
}

function triggerDraft(config?: FirstDraftConfig): void {
  void handleDraft(config)
}


async function handleDraft(config?: FirstDraftConfig): Promise<void> {
  if (!config) return
  try { await draft.start(config) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 初稿生成失败') }
}

function handlePanelMouseDown(event: MouseEvent): void {
  // 点击面板时保留编辑器选区
  const target = event.target as HTMLElement

  // 对于输入框和文本区域，不阻止默认行为（需要能正常获得焦点）
  // 但通过 relatedTarget 检查，如果是从编辑器失焦过来的，不清除选区
  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    // 不阻止，让输入框正常获得焦点
    return
  }

  // 允许这些元素的默认行为（可选中文字、可点击）
  if (
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.closest('button') || // 包含在button内的元素
    target.closest('.n-button') || // naive-ui button
    target.closest('pre') || // 代码块
    target.closest('.markdown-body') || // markdown渲染的内容
    target.closest('.assistant-copy') || // 助手回复内容
    target.closest('.user-content') // 用户消息内容
  ) {
    return
  }

  // 其他区域阻止默认行为，保留编辑器选区
  event.preventDefault()
}

defineExpose({ sendPrompt, sendPromptWithAction, triggerDraft })
</script>

<template>
  <section class="v2-dock chapter-dock" @mousedown.capture="handlePanelMouseDown">
    <header class="dock-head">
      <div class="dock-brand">
        <span class="brand-mark"><Sparkles :size="15" /></span>
        <div class="brand-copy">
          <strong>创作助理</strong>
          <span>{{ selectedChapter?.title || '章节工作台' }}</span>
        </div>
      </div>
      <div class="head-actions">
        <button type="button" title="新建对话" @click="createSession">
          <Plus :size="16" />
        </button>
        <button type="button" title="关闭" @click="emit('close')">
          <X :size="16" />
        </button>
      </div>
    </header>

    <div class="session-strip">
      <span>{{ activeSessionTitle }}</span>
      <button type="button" @click="activeTab = 'sessions'">
        {{ assistant.sessions.value.length }} 个会话
      </button>
    </div>

    <nav class="dock-tabs" aria-label="助手视图">
      <button
        type="button"
        :class="{ active: activeTab === 'chat' }"
        @click="activeTab = 'chat'"
      >
        <MessageSquareText :size="14" />
        对话
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'staged' }"
        @click="activeTab = 'staged'"
      >
        <SquareStack :size="14" />
        暂存
        <span v-if="stagedBadgeCount > 0" class="tab-badge">{{ stagedBadgeCount }}</span>
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'sessions' }"
        @click="activeTab = 'sessions'"
      >
        <History :size="14" />
        历史
      </button>
    </nav>

    <div v-if="activeTab === 'sessions'" class="sessions-pane">
      <AssistantSessionList
        :sessions="assistant.sessions.value"
        :active-session-id="assistant.activeSessionId.value"
        @switch="switchSession"
        @create="createSession"
        @delete="(id) => assistant.deleteSession(id)"
        @collapse="activeTab = 'chat'"
      />
    </div>

    <div v-else-if="activeTab === 'staged'" class="staged-pane">
      <StagedChangesView
        :changes="assistant.stagedChanges.value"
        :is-busy="assistant.isStreaming.value"
        :is-committing="isCommitting"
        @accept="(ids) => assistant.acceptChanges(ids)"
        @reject="(ids) => assistant.rejectChanges(ids)"
        @bind-target="(changeId, entityId) => assistant.bindTarget(changeId, entityId)"
        @commit="(ids) => handleCommit(ids)"
      />
    </div>

    <div v-else class="chat-pane">
      <div v-if="assistant.isStreaming.value" class="stream-strip">
        <span class="stream-dot" />
        生成中
      </div>

      <AssistantMessages
        v-if="assistant.messages.value.length > 0 || assistant.isStreaming.value"
        :messages="assistant.messages.value"
        :is-streaming="assistant.isStreaming.value"
        assistant-name="创作助理"
        @continue="assistant.continueWithPrompt"
      />

      <div v-else class="starter">
        <div class="starter-head">
          <div class="starter-kicker">Chapter Assistant v2</div>
          <h3>从哪里开始？</h3>
          <p>{{ currentMode.description }}</p>
        </div>

        <div class="mode-switch" role="tablist" aria-label="助手模式">
          <button
            v-for="mode in modeOptions"
            :key="mode.id"
            type="button"
            :class="{ active: activeMode === mode.id }"
            @click="activeMode = mode.id"
          >
            {{ mode.label }}
          </button>
        </div>

        <div class="quick-list">
          <button
            v-for="action in quickActions[activeMode]"
            :key="action.label"
            type="button"
            @click="fillQuickAction(action.prompt)"
          >
            {{ action.label }}
          </button>
        </div>

        <div class="draft-entry">
          <button type="button" class="draft-btn" @click="emit('generate-draft')">
            <Sparkles :size="14" />
            生成章节初稿
          </button>
        </div>
      </div>

      <div v-if="assistant.lastError.value" class="err-banner">
        {{ assistant.lastError.value }}
      </div>

      <AssistantComposer
        v-model="composerValue"
        :is-streaming="assistant.isStreaming.value"
        :mode-label="hasSelection ? selectionHint : currentMode.label"
        @send="sendWithMode"
        @cancel="assistant.cancel()"
      />
    </div>

    <footer v-if="activeTab !== 'chat' && acceptedCount > 0" class="dock-foot">
      <button type="button" @click="activeTab = 'staged'">
        {{ acceptedCount }} 项已确认，待写回
      </button>
    </footer>

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
  </section>
</template>

<style scoped>
.v2-dock {
  --arc-primary: #0d7d5a;
  --arc-primary-hover: #0a6b4e;
  --arc-primary-pressed: #085d43;
  --arc-primary-soft: rgba(13, 125, 90, 0.08);
  --v2-accent-line: rgba(13, 125, 90, 0.22);
  --v2-warn: #b45309;
  --v2-warn-soft: rgba(180, 83, 9, 0.08);
  --v2-danger: #b91c1c;
  --v2-danger-soft: rgba(185, 28, 28, 0.06);
  --v2-add: #047857;
  --v2-add-bg: rgba(4, 120, 87, 0.09);
  --v2-del: #b91c1c;
  --v2-del-bg: rgba(185, 28, 28, 0.07);
  --v2-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  --v2-radius-card: 8px;
  --v2-radius-btn: 8px;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-surface);
  border-left: 2px solid var(--arc-border-strong);
  color: var(--arc-text-primary);
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.brand-mark {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.brand-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.brand-copy strong {
  font-size: 13px;
  color: var(--arc-text-primary);
}

.brand-copy span {
  max-width: 210px;
  overflow: hidden;
  color: var(--arc-text-hint);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.head-actions button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
}

.head-actions button:hover {
  border-color: var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.session-strip {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.session-strip span {
  min-width: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-strip button {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 11.5px;
}

.dock-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  flex-shrink: 0;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-tabs button {
  display: inline-flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.dock-tabs button.active {
  border-color: var(--v2-accent-line);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}

.tab-badge {
  min-width: 16px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: #fff;
  font-family: var(--v2-mono);
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
}

.chat-pane,
.staged-pane,
.sessions-pane {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.chat-pane {
  position: relative;
}

.starter {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 16px;
}

.starter-head {
  margin: 8px 0 16px;
}

.starter-kicker {
  margin-bottom: 5px;
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.starter h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 20px;
  line-height: 1.2;
}

.starter p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}

.mode-switch {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.mode-switch button {
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 6px 7px;
}

.mode-switch button.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}

.quick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.quick-list button {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 12.5px;
  line-height: 1.4;
  padding: 10px 11px;
  text-align: left;
}

.quick-list button:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.draft-entry {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--arc-border);
}

.draft-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 10px 12px;
}

.draft-btn:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.stream-strip {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(180, 83, 9, 0.2);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--v2-warn);
  font-family: var(--v2-mono);
  font-size: 11px;
  padding: 4px 8px;
}

.stream-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--v2-warn);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

.err-banner {
  margin: 0 14px 8px;
  border: 1px solid rgba(185, 28, 28, 0.2);
  border-radius: 8px;
  background: var(--v2-danger-soft);
  color: var(--v2-danger);
  font-size: 12px;
  padding: 8px 10px;
}

.selection-chip {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}

.dock-foot {
  flex-shrink: 0;
  padding: 9px 12px;
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-foot button {
  width: 100%;
  border: 1px solid var(--v2-accent-line);
  border-radius: 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 10px;
}

.sessions-pane :deep(.session-list) {
  width: 100%;
  flex: 1;
  border-right: none;
}

.staged-pane :deep(.stage) {
  height: 100%;
  border-left: none;
}

.staged-pane :deep(.head) {
  padding: 14px 14px 10px;
}

.staged-pane :deep(.list) {
  padding: 10px 12px 14px;
}

.staged-pane :deep(.change) {
  border-radius: 8px;
  padding: 10px 11px;
}

.chat-pane :deep(.messages) {
  padding: 18px 16px 10px;
  gap: 18px;
}

.chat-pane :deep(.composer-wrap) {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  background: linear-gradient(180deg, transparent, var(--arc-bg-body) 35%);
}

.chat-pane :deep(.composer) {
  max-width: none;
  border-radius: 12px;
  box-shadow: var(--arc-shadow-sm);
}

.chat-pane :deep(.composer .foot) {
  align-items: flex-end;
}
</style>
