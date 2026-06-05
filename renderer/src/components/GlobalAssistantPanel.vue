<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronRight,
  GripHorizontal,
  History,
  Info,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-vue-next'
import { NButton, NPopover, NSelect, NTag, NTooltip } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { useGlobalAssistant } from '@/composables/useGlobalAssistant'

const props = defineProps<{
  activeViewLabel?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const appStore = useAppStore()

const {
  composerValue,
  activeMode,
  isSending,
  isProposalLoading,
  isRunningAudit,
  worldviewTargetMap,
  characterTargetMap,
  outlineTargetMap,
  messages,
  proposal,
  sessions,
  activeSessionId,
  currentModeMeta,
  isAuditMode,
  assistantStatus,
  hasActionableProposal,
  projectTitle,
  projectGenre,
  projectConstraintSummary,
  assetLinks,
  worldviewTargetOptions,
  characterTargetOptions,
  outlineTargetOptions,
  quickActions,
  modeOptions,
  setMode,
  fillQuickAction,
  openAsset,
  switchConversation,
  deleteConversation,
  handleNewSession,
  sendPrompt,
  stopStreaming,
  handleComposerKeydown,
  regenerateProposal,
  runAuditFromAssistant,
  applyConstraintProposal,
  applyWorldviewProposal,
  applyCharacterProposal,
  applyOutlineProposal,
  applyAllProposal,
  clearProposal,
  worldviewUpdateKey,
  characterUpdateKey,
  outlineUpdateKey,
  findWorldviewByTitle,
  findCharacterByName,
  findOutlineByTitle,
  resolveWorldviewTarget,
  resolveCharacterTarget,
  resolveOutlineTarget,
  hasWorldviewApplyTarget,
  hasCharacterApplyTarget,
  hasOutlineApplyTarget,
  renderMarkdown,
  formatToolArgs,
  formatToolResultPreview,
  getMessageToolCalls,
  describeToolAction,
  toolStatusLabel,
  groupedToolCalls
} = useGlobalAssistant({ activeViewLabel: () => props.activeViewLabel ?? '' })

// ─── 展示层：dock 专属 ───

const GLOBAL_ASSISTANT_INPUT_HEIGHT_STORAGE_KEY = 'arc-global-assistant-input-height'
const GLOBAL_ASSISTANT_INPUT_DEFAULT_HEIGHT = 96
const GLOBAL_ASSISTANT_INPUT_MIN_HEIGHT = 64
const GLOBAL_ASSISTANT_INPUT_MAX_VIEWPORT_RATIO = 0.48

const conversationRef = ref<HTMLDivElement | null>(null)
const inputHeight = ref(GLOBAL_ASSISTANT_INPUT_DEFAULT_HEIGHT)
const isDraggingInput = ref(false)
const showSessions = ref(false)

const maxInputHeight = computed(() =>
  Math.max(GLOBAL_ASSISTANT_INPUT_MIN_HEIGHT, Math.floor(window.innerHeight * GLOBAL_ASSISTANT_INPUT_MAX_VIEWPORT_RATIO))
)
const inputHeightStyle = computed(() => ({ height: `${inputHeight.value}px` }))

const activeViewLabel = computed(() => props.activeViewLabel ?? '项目工作台')

function clampInputHeight(height: number): number {
  return Math.max(GLOBAL_ASSISTANT_INPUT_MIN_HEIGHT, Math.min(maxInputHeight.value, height))
}

function startInputResize(event: MouseEvent): void {
  event.preventDefault()
  isDraggingInput.value = true
  const startY = event.clientY
  const startHeight = inputHeight.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'

  function onMove(moveEvent: MouseEvent): void {
    const delta = startY - moveEvent.clientY
    inputHeight.value = clampInputHeight(startHeight + delta)
  }

  function onEnd(): void {
    isDraggingInput.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem(GLOBAL_ASSISTANT_INPUT_HEIGHT_STORAGE_KEY, String(inputHeight.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
}

function resetInputHeight(): void {
  inputHeight.value = clampInputHeight(GLOBAL_ASSISTANT_INPUT_DEFAULT_HEIGHT)
  localStorage.setItem(GLOBAL_ASSISTANT_INPUT_HEIGHT_STORAGE_KEY, String(inputHeight.value))
}

function syncInputHeightBounds(): void {
  inputHeight.value = clampInputHeight(inputHeight.value)
}

function scrollToBottom(smooth = true): void {
  if (!conversationRef.value) return
  conversationRef.value.scrollTo({
    top: conversationRef.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  })
}

function closePanel(): void {
  emit('close')
}

function startNewConversation(): void {
  handleNewSession()
  showSessions.value = false
  nextTick(() => scrollToBottom(false))
}

onMounted(() => {
  const savedHeight = Number(localStorage.getItem(GLOBAL_ASSISTANT_INPUT_HEIGHT_STORAGE_KEY))
  if (Number.isFinite(savedHeight)) {
    inputHeight.value = clampInputHeight(savedHeight)
  }
  window.addEventListener('resize', syncInputHeightBounds)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncInputHeightBounds)
})

watch(
  () => [messages.value.length, messages.value.at(-1)?.content],
  () => {
    nextTick(() => scrollToBottom())
  }
)

watch(
  () => activeSessionId.value,
  () => {
    showSessions.value = false
    nextTick(() => scrollToBottom(false))
  }
)
</script>

<template>
  <aside class="ai-panel global-ai-panel">
    <header class="ai-header">
      <div class="ai-title">
        <Sparkles :size="14" />
        <span>全局 AI 助理</span>
      </div>
      <div class="ai-header-actions">
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="icon-btn" :disabled="isSending || isRunningAudit || isProposalLoading" @click="handleNewSession">
              <Plus :size="13" />
            </button>
          </template>
          新对话
        </n-tooltip>

        <n-popover trigger="click" placement="bottom-end" :show="showSessions" @update:show="showSessions = $event">
          <template #trigger>
            <button class="icon-btn" :class="{ active: showSessions }">
              <History :size="13" />
            </button>
          </template>
          <div class="session-popover">
            <div v-if="sessions.length === 0" class="session-empty">暂无历史会话</div>
            <div
              v-for="session in sessions"
              v-else
              :key="session.id"
              class="session-item"
              :class="{ active: appStore.activeGlobalAssistantSessionId === session.id }"
              @click="switchConversation(session.id)"
            >
              <span class="session-item-title">{{ session.title }}</span>
              <button class="session-item-delete" title="删除" @click.stop="deleteConversation(session.id)">
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </n-popover>

        <n-popover trigger="click" placement="bottom-end">
          <template #trigger>
            <button class="icon-btn">
              <Info :size="13" />
            </button>
          </template>
          <div class="context-popover">
            <div class="context-block">
              <strong>{{ projectTitle }}</strong>
              <span>{{ projectGenre }} · 当前视图 {{ activeViewLabel || '项目工作台' }}</span>
            </div>
            <div class="context-assets">
              <button
                v-for="item in assetLinks"
                :key="item.id"
                type="button"
                class="context-asset-chip"
                @click="openAsset(item.panel)"
              >
                <component :is="item.icon" :size="12" />
                <span>{{ item.label }}</span>
                <i>{{ item.count }}</i>
              </button>
            </div>
            <div v-if="projectConstraintSummary.length" class="context-block">
              <strong>当前项目约束</strong>
              <div class="constraint-mini-list">
                <div v-for="item in projectConstraintSummary" :key="item.id" class="constraint-mini-item">
                  <span>{{ item.title }}</span>
                  <button type="button" @click="appStore.removeProjectConstraint(item.id)">移除</button>
                </div>
              </div>
            </div>
          </div>
        </n-popover>

        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="icon-btn" @click="closePanel">
              <X :size="13" />
            </button>
          </template>
          关闭
        </n-tooltip>
      </div>
    </header>

    <div class="global-ai-modebar">
      <button
        v-for="item in modeOptions"
        :key="item.id"
        class="global-ai-mode-pill"
        :class="{ active: activeMode === item.id }"
        @click="setMode(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div ref="conversationRef" class="global-ai-messages messages arc-scrollbar">
      <div v-if="!messages.length && !isSending && !isRunningAudit" class="empty">
        <Sparkles :size="28" class="empty-icon" />
        <p class="empty-text">贴一段设定、提出一次修正，或者直接发起项目审计。</p>
        <div class="empty-suggestions">
          <button
            v-for="action in quickActions[activeMode]"
            :key="`${activeMode}-${action.label}`"
            class="suggestion-btn"
            @click="fillQuickAction(action)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>

      <template v-else>
        <div v-for="item in messages" :key="item.id" class="msg" :class="item.role">
          <div
            class="bubble"
            :class="item.role === 'user' ? 'user' : 'ai'"
          >
            <div v-if="item.role === 'assistant' && getMessageToolCalls(item).length" class="global-tool-log">
              <div
                v-for="group in groupedToolCalls(item)"
                :key="`${item.id}-${group.key}-${group.items[0]?.toolUseId ?? 'empty'}`"
                class="global-tool-group"
              >
                <div class="global-tool-group__title">{{ group.label }}</div>
                <div
                  v-for="toolCall in group.items"
                  :key="toolCall.toolUseId"
                  class="global-tool-log__item"
                  :class="toolCall.status"
                >
                  <div class="global-tool-log__head">
                    <span class="global-tool-log__name">
                      <ChevronRight :size="12" />
                      {{ describeToolAction(toolCall) }}
                    </span>
                    <span class="global-tool-log__status">
                      {{ toolStatusLabel(toolCall) }}
                    </span>
                  </div>
                  <div class="global-tool-log__args">参数：{{ formatToolArgs(toolCall.args) }}</div>
                  <div v-if="toolCall.result" class="global-tool-log__result">{{ formatToolResultPreview(toolCall.result, toolCall) }}</div>
                </div>
              </div>
            </div>
            <div v-if="item.role === 'assistant'" class="global-markdown-body" v-html="renderMarkdown(item.content)" />
            <template v-else>{{ item.content }}</template>
          </div>
        </div>

        <div v-if="isProposalLoading || hasActionableProposal" class="global-proposal">
          <div class="global-proposal__card">
            <div class="global-proposal__header">
              <div>
                <strong>写回提案</strong>
                <p>{{ proposal?.summary || '正在整理世界观、人物卡和大纲提案…' }}</p>
              </div>
              <div class="global-proposal__header-actions">
                <NButton size="small" tertiary :loading="isProposalLoading" :disabled="isSending || isRunningAudit || isProposalLoading" @click="isAuditMode ? runAuditFromAssistant() : regenerateProposal()">
                  {{ isAuditMode ? '重新审计' : '生成提案' }}
                </NButton>
                <NButton
                  v-if="proposal && (proposal.constraintCreates.length || hasWorldviewApplyTarget() || hasCharacterApplyTarget() || hasOutlineApplyTarget())"
                  size="small"
                  type="primary"
                  @click="applyAllProposal"
                >
                  全部写回
                </NButton>
              </div>
            </div>

            <div v-if="proposal" class="global-proposal__sections">
              <section v-if="proposal.constraintCreates.length" class="global-proposal__section">
                <div class="global-proposal__section-head">
                  <span>项目约束</span>
                  <NButton size="tiny" tertiary @click="applyConstraintProposal">写回约束</NButton>
                </div>
                <div class="global-proposal__items">
                  <div v-for="item in proposal.constraintCreates" :key="`gc-${item.title}`" class="global-proposal__item">
                    <div class="global-proposal__item-top">
                      <strong>新增 · {{ item.title }}</strong>
                      <NTag size="small" round :bordered="false" type="warning">{{ item.scope }}</NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <ul class="global-proposal__changes">
                      <li>约束内容：{{ item.content }}</li>
                      <li v-if="item.keywords.length">关键词：{{ item.keywords.join('、') }}</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section v-if="proposal.worldviewCreates.length || proposal.worldviewUpdates.length" class="global-proposal__section">
                <div class="global-proposal__section-head">
                  <span>世界观</span>
                  <NButton size="tiny" tertiary :disabled="!hasWorldviewApplyTarget()" @click="applyWorldviewProposal">写回世界观</NButton>
                </div>
                <div class="global-proposal__items">
                  <div v-for="item in proposal.worldviewCreates" :key="`wc-${item.title}`" class="global-proposal__item">
                    <div class="global-proposal__item-top">
                      <strong>新增 · {{ item.title }}</strong>
                      <NTag size="small" round :bordered="false">{{ item.type }}</NTag>
                    </div>
                    <p>{{ item.content }}</p>
                  </div>
                  <div
                    v-for="(item, index) in proposal.worldviewUpdates"
                    :key="`wu-${index}-${item.matchTitle}`"
                    class="global-proposal__item"
                  >
                    <div class="global-proposal__item-top">
                      <strong>更新 · {{ item.matchTitle }}</strong>
                      <NTag size="small" round :bordered="false" :type="resolveWorldviewTarget(item, index) ? 'success' : 'warning'">
                        {{ findWorldviewByTitle(item.matchTitle) ? '自动匹配' : resolveWorldviewTarget(item, index) ? '手动绑定' : '未匹配' }}
                      </NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <NSelect
                      v-if="!findWorldviewByTitle(item.matchTitle)"
                      :value="worldviewTargetMap[worldviewUpdateKey(index, item.matchTitle)] || null"
                      :options="worldviewTargetOptions"
                      size="small"
                      placeholder="选择要更新的世界观条目"
                      @update:value="(value) => { worldviewTargetMap[worldviewUpdateKey(index, item.matchTitle)] = String(value ?? '') }"
                    />
                    <ul class="global-proposal__changes">
                      <li v-if="item.title">新标题：{{ item.title }}</li>
                      <li v-if="item.type">新分类：{{ item.type }}</li>
                      <li v-if="item.content">新内容：{{ item.content }}</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section v-if="proposal.characterCreates.length || proposal.characterUpdates.length" class="global-proposal__section">
                <div class="global-proposal__section-head">
                  <span>人物卡</span>
                  <NButton size="tiny" tertiary :disabled="!hasCharacterApplyTarget()" @click="applyCharacterProposal">写回人物</NButton>
                </div>
                <div class="global-proposal__items">
                  <div v-for="item in proposal.characterCreates" :key="`cc-${item.name}`" class="global-proposal__item">
                    <div class="global-proposal__item-top">
                      <strong>新增 · {{ item.name }}</strong>
                      <NTag v-if="item.role" size="small" round :bordered="false">{{ item.role }}</NTag>
                    </div>
                    <p>{{ item.description }}</p>
                    <div v-if="item.tags.length" class="global-proposal__tags">
                      <NTag v-for="tag in item.tags" :key="`${item.name}-${tag}`" size="small" round :bordered="false" type="info">
                        {{ tag }}
                      </NTag>
                    </div>
                  </div>
                  <div
                    v-for="(item, index) in proposal.characterUpdates"
                    :key="`cu-${index}-${item.matchName}`"
                    class="global-proposal__item"
                  >
                    <div class="global-proposal__item-top">
                      <strong>更新 · {{ item.matchName }}</strong>
                      <NTag size="small" round :bordered="false" :type="resolveCharacterTarget(item, index) ? 'success' : 'warning'">
                        {{ findCharacterByName(item.matchName) ? '自动匹配' : resolveCharacterTarget(item, index) ? '手动绑定' : '未匹配' }}
                      </NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <NSelect
                      v-if="!findCharacterByName(item.matchName)"
                      :value="characterTargetMap[characterUpdateKey(index, item.matchName)] || null"
                      :options="characterTargetOptions"
                      size="small"
                      placeholder="选择要更新的人物卡"
                      @update:value="(value) => { characterTargetMap[characterUpdateKey(index, item.matchName)] = String(value ?? '') }"
                    />
                    <ul class="global-proposal__changes">
                      <li v-if="item.name">新名称：{{ item.name }}</li>
                      <li v-if="item.role">新定位：{{ item.role }}</li>
                      <li v-if="item.description">新简介：{{ item.description }}</li>
                      <li v-if="item.tags?.length">新标签：{{ item.tags.join('、') }}</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section v-if="proposal.outlineCreates.length || proposal.outlineUpdates.length" class="global-proposal__section">
                <div class="global-proposal__section-head">
                  <span>大纲</span>
                  <NButton size="tiny" tertiary :disabled="!hasOutlineApplyTarget()" @click="applyOutlineProposal">写回大纲</NButton>
                </div>
                <div class="global-proposal__items">
                  <div v-for="item in proposal.outlineCreates" :key="`oc-${item.title}`" class="global-proposal__item">
                    <div class="global-proposal__item-top">
                      <strong>新增 · {{ item.title }}</strong>
                      <NTag v-if="item.wordTarget" size="small" round :bordered="false">{{ item.wordTarget }}</NTag>
                    </div>
                    <p>{{ item.summary }}</p>
                    <ul class="global-proposal__changes">
                      <li v-if="item.conflict">冲突：{{ item.conflict }}</li>
                    </ul>
                  </div>
                  <div
                    v-for="(item, index) in proposal.outlineUpdates"
                    :key="`ou-${index}-${item.matchTitle}`"
                    class="global-proposal__item"
                  >
                    <div class="global-proposal__item-top">
                      <strong>更新 · {{ item.matchTitle }}</strong>
                      <NTag size="small" round :bordered="false" :type="resolveOutlineTarget(item, index) ? 'success' : 'warning'">
                        {{ findOutlineByTitle(item.matchTitle) ? '自动匹配' : resolveOutlineTarget(item, index) ? '手动绑定' : '未匹配' }}
                      </NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <NSelect
                      v-if="!findOutlineByTitle(item.matchTitle)"
                      :value="outlineTargetMap[outlineUpdateKey(index, item.matchTitle)] || null"
                      :options="outlineTargetOptions"
                      size="small"
                      placeholder="选择要更新的大纲节点"
                      @update:value="(value) => { outlineTargetMap[outlineUpdateKey(index, item.matchTitle)] = String(value ?? '') }"
                    />
                    <ul class="global-proposal__changes">
                      <li v-if="item.title">新标题：{{ item.title }}</li>
                      <li v-if="item.wordTarget">目标字数：{{ item.wordTarget }}</li>
                      <li v-if="item.conflict">冲突：{{ item.conflict }}</li>
                      <li v-if="item.summary">摘要：{{ item.summary }}</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section v-if="proposal.notes.length" class="global-proposal__section">
                <div class="global-proposal__section-head">
                  <span>提醒</span>
                </div>
                <ul class="global-proposal__notes">
                  <li v-for="note in proposal.notes" :key="note">{{ note }}</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="assistantStatus" class="agent-status">
      <span class="agent-pulse" />
      <span>{{ assistantStatus }}</span>
    </div>

    <div class="global-ai-composer">
      <div
        class="global-ai-input-resize-handle"
        :class="{ dragging: isDraggingInput }"
        title="拖拽调整输入栏高度，双击恢复默认"
        @mousedown="startInputResize"
        @dblclick="resetInputHeight"
      >
        <GripHorizontal :size="14" />
      </div>

      <div class="global-ai-toolbar">
        <button
          v-for="item in modeOptions"
          :key="item.id"
          class="global-ai-mode-tab"
          :class="{ active: activeMode === item.id }"
          @click="setMode(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="global-ai-input-wrap" :class="{ disabled: isSending || isRunningAudit }">
        <textarea
          v-model="composerValue"
          class="global-ai-input"
          rows="4"
          :style="inputHeightStyle"
          :disabled="isSending || isRunningAudit || isProposalLoading"
          :placeholder="isRunningAudit ? '正在执行项目审计…' : `当前模式：${currentModeMeta.label}。告诉 AI 你的全局创作需求，按 Enter 发送，Shift + Enter 换行。`"
          @keydown="handleComposerKeydown"
        />
        <div class="global-ai-input-footer">
          <div class="global-ai-actions">
            <button
              v-for="action in quickActions[activeMode]"
              :key="`${activeMode}-${action.label}`"
              class="global-ai-quick-btn"
              :disabled="isSending || isRunningAudit || isProposalLoading"
              @click="fillQuickAction(action)"
            >
              {{ action.label }}
            </button>
          </div>
          <div class="global-ai-submit">
            <NButton
              v-if="messages.length > 0"
              tertiary
              size="small"
              :loading="isProposalLoading"
              :disabled="isSending || isRunningAudit || isProposalLoading"
              @click="isAuditMode ? runAuditFromAssistant() : regenerateProposal()"
            >
              {{ isAuditMode ? '重新审计' : '生成提案' }}
            </NButton>
            <button
              class="global-ai-send"
              :class="{ active: isSending }"
              :disabled="isRunningAudit || isProposalLoading || (!isSending && !composerValue.trim())"
              @click="isSending ? stopStreaming() : sendPrompt()"
            >
              <X v-if="isSending" :size="14" />
              <Send v-else :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.global-ai-panel {
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
  flex-shrink: 0;
}

.ai-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.ai-title svg {
  color: var(--arc-primary);
  flex-shrink: 0;
}

.ai-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
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
  padding: 0;
  line-height: 1;
}

.icon-btn:hover:not(:disabled) {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.session-popover,
.context-popover {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 280px;
}

.session-empty {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.session-item:hover {
  background: var(--arc-bg-surface-hover);
}

.session-item.active {
  background: var(--arc-primary-soft);
}

.session-item-title {
  flex: 1;
  min-width: 0;
  color: var(--arc-text-primary);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item.active .session-item-title {
  color: var(--arc-primary);
}

.session-item-delete {
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  flex-shrink: 0;
}

.session-item:hover .session-item-delete {
  display: inline-flex;
}

.session-item-delete:hover {
  color: #dc2626;
  background: #fef2f2;
}

.context-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.context-block strong {
  font-size: 12px;
  color: var(--arc-text-primary);
}

.context-block span {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.context-assets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.context-asset-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.context-asset-chip i {
  font-style: normal;
  color: var(--arc-text-hint);
}

.constraint-mini-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.constraint-mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
}

.constraint-mini-item span {
  color: var(--arc-text-secondary);
  font-size: 11px;
}

.constraint-mini-item button {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  font-size: 11px;
  cursor: pointer;
}

.constraint-mini-item button:hover {
  color: #dc2626;
}

.global-ai-modebar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 0;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.global-ai-mode-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.global-ai-mode-pill:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
}

.global-ai-mode-pill.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 15%, var(--arc-border));
}

.global-ai-messages {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex: 1;
  min-height: 0;
}

.empty {
  margin: auto;
  text-align: center;
  padding: 32px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-icon {
  color: var(--arc-primary);
  opacity: 0.6;
}

.empty-text {
  margin: 0;
  max-width: 260px;
  color: var(--arc-text-hint);
  font-size: 13px;
  line-height: 1.7;
}

.empty-suggestions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  width: 100%;
  max-width: 280px;
}

.suggestion-btn {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}

.suggestion-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: text;
}

.msg.user {
  align-items: flex-end;
}

.msg.assistant {
  align-items: flex-start;
}

.bubble {
  max-width: 92%;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.bubble.user {
  background: var(--arc-primary);
  color: white;
  border-radius: 16px 16px 4px 16px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 20%, transparent);
  white-space: pre-wrap;
}

.bubble.ai {
  max-width: 96%;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-primary);
  border-radius: 4px 16px 16px 16px;
}

.global-tool-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--arc-border);
}

.global-tool-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.global-tool-group__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  padding-left: 2px;
}

.global-tool-log__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
}

.global-tool-log__item.running {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
}

.global-tool-log__item.error {
  border-color: color-mix(in srgb, #dc2626 24%, var(--arc-border));
  background: color-mix(in srgb, #dc2626 4%, var(--arc-bg-surface));
}

.global-tool-log__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.global-tool-log__name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.global-tool-log__status {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.global-tool-log__args,
.global-tool-log__result {
  font-size: 11px;
  line-height: 1.5;
  color: var(--arc-text-secondary);
}

.global-tool-log__args {
  color: var(--arc-text-hint);
}

.global-tool-log__result {
  color: var(--arc-text-hint);
}

.global-markdown-body {
  white-space: normal;
}

.global-markdown-body :deep(p) {
  margin: 0 0 8px;
}

.global-markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.global-markdown-body :deep(h1),
.global-markdown-body :deep(h2),
.global-markdown-body :deep(h3),
.global-markdown-body :deep(h4) {
  margin: 12px 0 6px;
  color: var(--arc-text-primary);
  font-weight: 700;
  line-height: 1.35;
}

.global-markdown-body :deep(h1) { font-size: 1.18em; }
.global-markdown-body :deep(h2) { font-size: 1.12em; }
.global-markdown-body :deep(h3),
.global-markdown-body :deep(h4) { font-size: 1.04em; }

.global-markdown-body :deep(ul),
.global-markdown-body :deep(ol) {
  margin: 6px 0 8px;
  padding-left: 20px;
}

.global-markdown-body :deep(li) {
  margin: 3px 0;
}

.global-markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 7px 10px;
  border-left: 3px solid var(--arc-primary);
  border-radius: 0 8px 8px 0;
  background: var(--arc-primary-soft);
  color: var(--arc-text-secondary);
}

.global-markdown-body :deep(code) {
  padding: 2px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--arc-text-primary) 8%, transparent);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.9em;
}

.global-markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  overflow-x: auto;
  border-radius: 10px;
  background: #111827;
  color: #e5e7eb;
}

.global-markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.global-markdown-body :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 12px;
}

.global-markdown-body :deep(th),
.global-markdown-body :deep(td) {
  padding: 6px 8px;
  border: 1px solid var(--arc-border);
}

.global-markdown-body :deep(th) {
  background: var(--arc-bg-muted);
  font-weight: 700;
}

.global-proposal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.global-proposal__card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-weak));
}

.global-proposal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.global-proposal__header strong {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--arc-text-hint);
  text-transform: uppercase;
}

.global-proposal__header p {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 12px;
  line-height: 1.6;
}

.global-proposal__header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.global-proposal__sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.global-proposal__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.global-proposal__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.global-proposal__section-head span {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.global-proposal__items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.global-proposal__item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.global-proposal__item-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.global-proposal__item-top strong {
  font-size: 12px;
}

.global-proposal__item p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.global-proposal__changes,
.global-proposal__notes {
  margin: 0;
  padding-left: 18px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.global-proposal__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.global-ai-composer {
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  padding: 0 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.global-ai-input-resize-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 12px;
  cursor: row-resize;
  color: var(--arc-text-hint);
  opacity: 0.42;
  transition:
    color 0.15s ease,
    opacity 0.15s ease;
  flex-shrink: 0;
}

.global-ai-input-resize-handle:hover,
.global-ai-input-resize-handle.dragging {
  color: var(--arc-primary);
  opacity: 1;
}

.global-ai-toolbar {
  display: flex;
  gap: 2px;
}

.global-ai-mode-tab {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--arc-text-hint);
  cursor: pointer;
  border-radius: 6px;
  border: none;
  background: transparent;
  transition: all 0.15s;
  font-weight: 500;
}

.global-ai-mode-tab:hover {
  color: var(--arc-text-secondary);
}

.global-ai-mode-tab.active {
  color: var(--arc-text-primary);
  background: var(--arc-bg-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  font-weight: 600;
}

.global-ai-input-wrap {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-weak);
  transition: all 0.2s;
  overflow: hidden;
}

.global-ai-input-wrap:focus-within {
  border-color: var(--arc-primary);
  background: var(--arc-bg-surface);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 8%, transparent);
}

.global-ai-input-wrap.disabled {
  opacity: 0.6;
}

.global-ai-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 10px 12px 8px;
  font-size: 13px;
  line-height: 1.55;
  resize: none;
  font-family: inherit;
  color: var(--arc-text-primary);
  min-height: 64px;
  max-height: 48vh;
}

.global-ai-input-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px 6px;
}

.global-ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.global-ai-quick-btn {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.global-ai-quick-btn:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.global-ai-quick-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.global-ai-submit {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.global-ai-send {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--arc-primary);
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.global-ai-send:hover:not(:disabled) {
  background: var(--arc-primary-hover);
}

.global-ai-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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
  flex-shrink: 0;
}

.agent-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-primary);
  animation: agent-pulse-ring 1.4s ease-in-out infinite;
}

@keyframes agent-pulse-ring {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.5;
    transform: scale(1.4);
  }
}

@media (max-width: 560px) {
  .global-ai-modebar {
    padding-inline: 8px;
  }

  .global-ai-messages {
    padding: 14px;
  }

  .global-ai-composer {
    padding-inline: 10px;
  }

  .global-ai-input-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .global-ai-submit {
    justify-content: flex-end;
  }
}
</style>
