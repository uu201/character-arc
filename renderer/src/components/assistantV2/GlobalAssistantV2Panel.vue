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
import type { SurfaceDefinition } from '@shared/assistant-runtime'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import AssistantSessionList from './AssistantSessionList.vue'
import AssistantMessages from './AssistantMessages.vue'
import AssistantComposer from './AssistantComposer.vue'
import StagedChangesView from './StagedChangesView.vue'

const props = defineProps<{
  activeViewLabel?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const appStore = useAppStore()
const { selectedProjectId } = storeToRefs(appStore)
const message = useMessage()

const SURFACE: SurfaceDefinition = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 8
}

const assistant = useAssistant({
  projectId: () => selectedProjectId.value,
  surface: SURFACE
})

const composerValue = computed({
  get: () => assistant.composerValue.value,
  set: (value) => { assistant.composerValue.value = value }
})

type AssistantMode = 'ingest' | 'correct' | 'audit'
type PanelTab = 'chat' | 'staged' | 'sessions'

const activeTab = ref<PanelTab>('chat')
const activeMode = ref<AssistantMode>('ingest')
const isCommitting = ref(false)

const modeOptions: Array<{ id: AssistantMode; label: string; description: string }> = [
  { id: 'ingest', label: '录入', description: '沉淀设定、计划和创作记忆' },
  { id: 'correct', label: '修正', description: '生成可审阅的最小修正' },
  { id: 'audit', label: '审计', description: '检查矛盾、OOC 与连续性' }
]

const quickActions: Record<AssistantMode, Array<{ label: string; prompt: string }>> = {
  ingest: [
    { label: '整理项目现状', prompt: '请读取项目资料，整理当前项目概况、下一步创作计划和需要沉淀的创作记忆。' },
    { label: '录入设定草稿', prompt: '我会给你一段设定草稿，请拆成可写入的世界观、人物、组织、大纲或创作记忆暂存变更。' },
    { label: '补全创作记忆', prompt: '请基于现有项目资料，补全当前状态、创作计划、待回收伏笔和素材清单。' }
  ],
  correct: [
    { label: '修正跑偏设定', prompt: '请检查项目里可能跑偏或重复的设定，并把需要修正的内容产出为暂存变更。' },
    { label: '统一人物口径', prompt: '请检查主要人物的定位、动机和关系是否有矛盾，并给出可暂存的修正方案。' },
    { label: '调整大纲承接', prompt: '请检查大纲与现有章节的承接问题，必要时产出大纲或创作记忆的暂存修改。' }
  ],
  audit: [
    { label: '全项目审计', prompt: '请审计当前项目的一致性风险，包括世界观矛盾、人物 OOC、大纲断裂、伏笔未回收和硬约束冲突。' },
    { label: '伏笔审计', prompt: '请读取剧情线索、章节摘要和创作记忆，列出待回收伏笔、风险和建议处理顺序。' },
    { label: '章节连续性审计', prompt: '请检查最近章节和大纲之间的连续性，指出问题并给出最小修正方案。' }
  ]
}

const currentMode = computed(() =>
  modeOptions.find((mode) => mode.id === activeMode.value) ?? modeOptions[0]
)

const stagedBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter((change) =>
    change.status === 'pending' ||
    change.status === 'accepted' ||
    change.status === 'streaming'
  ).length
)

const acceptedCount = computed(() =>
  assistant.stagedChanges.value.filter((change) => change.status === 'accepted').length
)

const activeSessionTitle = computed(() =>
  assistant.activeSession.value?.title || '新会话'
)

const activeContextLabel = computed(() =>
  props.activeViewLabel?.trim() || '项目工作台'
)

function fillQuickAction(prompt: string): void {
  activeTab.value = 'chat'
  composerValue.value = prompt
}

function sendWithMode(): void {
  activeTab.value = 'chat'
  void assistant.send({
    intentHint: `global-assistant-v2:${activeMode.value}`
  })
}

function openKnowledgeDocument(documentId?: string): void {
  appStore.setPanel('project-knowledge')
  if (documentId) {
    appStore.setAssistantFocusTarget('project-knowledge', documentId)
  }
  emit('close')
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
</script>

<template>
  <section class="v2-dock">
    <header class="dock-head">
      <div class="dock-brand">
        <span class="brand-mark"><Sparkles :size="15" /></span>
        <div class="brand-copy">
          <strong>全局助手 v2</strong>
          <span>{{ activeContextLabel }}</span>
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
        @open-knowledge="openKnowledgeDocument"
      />

      <div v-else class="starter">
        <div class="starter-head">
          <div class="starter-kicker">Runtime v2</div>
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
      </div>

      <div v-if="assistant.lastError.value" class="err-banner">
        {{ assistant.lastError.value }}
      </div>

      <AssistantComposer
        v-model="composerValue"
        :is-streaming="assistant.isStreaming.value"
        :mode-label="currentMode.label"
        @send="sendWithMode"
        @cancel="assistant.cancel()"
      />
    </div>

    <footer v-if="activeTab !== 'chat' && acceptedCount > 0" class="dock-foot">
      <button type="button" @click="activeTab = 'staged'">
        {{ acceptedCount }} 项已确认，待写回
      </button>
    </footer>
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
  background: var(--arc-bg-body);
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

.chat-pane :deep(.composer .hint span:last-child) {
  display: none;
}

.chat-pane :deep(.composer .foot) {
  align-items: flex-end;
}
</style>
