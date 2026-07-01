<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowUp,
  BookMarked,
  Check,
  ChevronDown,
  Eye,
  FileText,
  GitCompare,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Wrench
} from 'lucide-vue-next'
import { NButton, NSelect, NTag } from 'naive-ui'
import { useGlobalAssistant } from '@/composables/useGlobalAssistant'
import type { ToolGroup } from '@/composables/useGlobalAssistant'
import type { AssistantToolCall } from '@/types/app'
import GlobalAssistantDiffReviewDialog from '@/components/GlobalAssistantDiffReviewDialog.vue'
import appLogo from '@/assets/app-logo.png'

const a = useGlobalAssistant({ activeViewLabel: () => '全局AI助手' })

const conversationRef = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const showModeMenu = ref(false)
const railCollapsed = ref(false)
const GA_RAIL_WIDTH_STORAGE_KEY = 'arc-global-assistant-page-rail-width'
const GA_RAIL_DEFAULT_WIDTH = 240
const GA_RAIL_MIN_WIDTH = 180
const GA_RAIL_MAX_WIDTH = 420
const GA_COMPOSER_MAX_HEIGHT = 180
const railWidth = ref(GA_RAIL_DEFAULT_WIDTH)
const isDraggingRail = ref(false)
const collapsedGroups = reactive<Record<string, boolean>>({})
const showDiffReview = ref(false)
let stopRailResize: (() => void) | null = null

const hasThread = computed(() => Boolean(a.messages.value.length || a.isSending.value || a.isRunningAudit.value))
const railStyle = computed(() => ({ width: `${railWidth.value}px` }))

const modeDotClass = (mode: string): string =>
  mode === 'audit' ? 'audit' : mode === 'ingest' ? 'ingest' : 'correct'

function scrollToBottom(smooth = true): void {
  if (!conversationRef.value) return
  conversationRef.value.scrollTo({ top: conversationRef.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

function groupKey(messageId: string, group: ToolGroup): string {
  return `${messageId}:${group.key}:${group.items[0]?.toolUseId ?? 'empty'}`
}

function toggleGroup(key: string): void {
  collapsedGroups[key] = !collapsedGroups[key]
}

function toolRowIcon(toolCall: AssistantToolCall) {
  switch (toolCall.toolName) {
    case 'search_project':
    case 'skill_list':
    case 'skill_load':
      return Search
    case 'edit_chapter':
    case 'knowledge_save_document':
      return Pencil
    case 'read_chapter':
    case 'list_chapters':
      return FileText
    default:
      return Eye
  }
}

function pickMode(mode: 'ingest' | 'correct' | 'audit'): void {
  a.setMode(mode)
  showModeMenu.value = false
}

function onSend(): void {
  if (a.isSending.value) {
    void a.stopStreaming()
  } else {
    void a.sendPrompt()
  }
}

function onSuggest(action: { label: string; prompt: string }): void {
  a.fillQuickAction(action)
  nextTick(() => composerRef.value?.focus())
}

async function applyAllFromReview(): Promise<void> {
  await a.applyAllProposal()
  showDiffReview.value = false
}

async function applyFileFromReview(fileId: string): Promise<void> {
  if (await a.applyProposalDiffFile(fileId) && a.proposalDiffStats.value.total === 0) {
    showDiffReview.value = false
  }
}

function clearFromReview(): void {
  a.clearProposal()
  showDiffReview.value = false
}

function clampRailWidth(width: number): number {
  return Math.max(GA_RAIL_MIN_WIDTH, Math.min(GA_RAIL_MAX_WIDTH, width))
}

function startRailResize(event: MouseEvent): void {
  if (railCollapsed.value) return
  event.preventDefault()
  isDraggingRail.value = true
  const startX = event.clientX
  const startWidth = railWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  function onMove(moveEvent: MouseEvent): void {
    railWidth.value = clampRailWidth(startWidth + moveEvent.clientX - startX)
  }

  function onEnd(): void {
    isDraggingRail.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem(GA_RAIL_WIDTH_STORAGE_KEY, String(railWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    stopRailResize = null
  }

  stopRailResize = onEnd
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
}

function resetRailWidth(): void {
  railWidth.value = GA_RAIL_DEFAULT_WIDTH
  localStorage.setItem(GA_RAIL_WIDTH_STORAGE_KEY, String(railWidth.value))
}

function autoResize(): void {
  const el = composerRef.value
  if (!el) return
  el.style.height = 'auto'
  const nextHeight = Math.min(el.scrollHeight, GA_COMPOSER_MAX_HEIGHT)
  el.style.height = `${nextHeight}px`
  el.style.overflowY = el.scrollHeight > GA_COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
}

onMounted(() => {
  const savedWidth = Number(localStorage.getItem(GA_RAIL_WIDTH_STORAGE_KEY))
  if (Number.isFinite(savedWidth)) {
    railWidth.value = clampRailWidth(savedWidth)
  }
  nextTick(() => autoResize())
})

onBeforeUnmount(() => {
  stopRailResize?.()
})

watch(
  () => [a.messages.value.length, a.messages.value.at(-1)?.content],
  () => {
    nextTick(() => scrollToBottom())
  }
)

watch(
  () => a.composerValue.value,
  () => {
    nextTick(() => autoResize())
  }
)
</script>

<template>
  <section class="ga-page">
    <!-- 会话（任务）历史栏 -->
    <aside class="ga-rail" :class="{ 'ga-rail--collapsed': railCollapsed, 'ga-rail--dragging': isDraggingRail }" :style="railCollapsed ? undefined : railStyle">
      <template v-if="!railCollapsed">
        <div class="ga-rail__head">
          <strong>会话</strong>
          <div class="ga-rail__head-actions">
            <button class="ga-rail__new" type="button" :disabled="a.isSending.value || a.isRunningAudit.value || a.isProposalLoading.value" @click="a.handleNewSession()">
              <Plus :size="13" />新建
            </button>
            <button class="ga-rail__toggle" type="button" title="收起会话栏" @click="railCollapsed = true">
              <PanelLeftClose :size="16" />
            </button>
          </div>
        </div>
        <div class="ga-rail__list arc-scrollbar">
          <p v-if="!a.sessions.value.length" class="ga-rail__empty">暂无历史会话</p>
          <button
            v-for="session in a.sessions.value"
            :key="session.id"
            type="button"
            class="ga-session"
            :class="{ active: a.activeSessionId.value === session.id }"
            @click="a.switchConversation(session.id)"
          >
            <span class="ga-session__title">
              <span class="ga-dot correct" />
              <span class="ga-session__text">{{ session.title || '未命名会话' }}</span>
              <span class="ga-session__del" title="删除" @click.stop="a.deleteConversation(session.id)"><Trash2 :size="12" /></span>
            </span>
            <span class="ga-session__meta">{{ session.messages.length }} 条消息</span>
          </button>
        </div>
      </template>
      <div
        v-if="!railCollapsed"
        class="ga-rail__resize"
        title="拖拽调整会话栏宽度，双击恢复默认"
        @mousedown="startRailResize"
        @dblclick="resetRailWidth"
      />
      <div v-else class="ga-rail__collapsed">
        <button class="ga-rail__toggle" type="button" title="展开会话栏" @click="railCollapsed = false">
          <PanelLeftOpen :size="16" />
        </button>
        <button
          class="ga-rail__toggle"
          type="button"
          title="新建会话"
          :disabled="a.isSending.value || a.isRunningAudit.value || a.isProposalLoading.value"
          @click="a.handleNewSession()"
        >
          <Plus :size="16" />
        </button>
      </div>
    </aside>

    <!-- 对话主列 -->
    <div class="ga-main">
      <!-- 空状态：Gemini 风欢迎 -->
      <div v-if="!hasThread" class="ga-empty">
        <div class="ga-empty__center">
          <div class="ga-empty__badge"><img :src="appLogo" alt="CharacterArc" /></div>
          <h1 class="ga-hero">需要我做点什么？</h1>
          <span class="ga-empty__context">
            <Wrench :size="13" />
            {{ a.assetLinks.value.map(item => `${item.count} ${item.label}`).join(' · ') }}
          </span>

          <div class="ga-prompt">
            <div class="ga-prompt__bar">
              <textarea
                ref="composerRef"
                v-model="a.composerValue.value"
                class="ga-prompt__input"
                rows="1"
                :placeholder="`当前模式：${a.currentModeMeta.value.label}。询问全局助理，或交给它执行一项任务…`"
                :disabled="a.isRunningAudit.value"
                @input="autoResize"
                @keydown="a.handleComposerKeydown"
              />
              <div class="ga-prompt__actions">
                <div class="ga-mode">
                  <button class="ga-mode__btn" type="button" @click="showModeMenu = !showModeMenu">
                    <span class="ga-dot" :class="modeDotClass(a.activeMode.value)" />{{ a.currentModeMeta.value.label }}
                    <ChevronDown :size="13" />
                  </button>
                  <div v-if="showModeMenu" class="ga-mode__menu">
                    <button
                      v-for="item in a.modeOptions"
                      :key="item.id"
                      type="button"
                      class="ga-mode__item"
                      :class="{ active: a.activeMode.value === item.id }"
                      @click="pickMode(item.id)"
                    >
                      <span class="ga-dot" :class="modeDotClass(item.id)" />
                      <span class="ga-mode__copy"><strong>{{ item.label }}</strong><span>{{ item.description }}</span></span>
                    </button>
                  </div>
                </div>
                <button class="ga-send" type="button" :disabled="!a.composerValue.value.trim()" title="发送" @click="onSend">
                  <ArrowUp :size="16" />
                </button>
              </div>
            </div>
          </div>

          <div class="ga-suggest">
            <button
              v-for="action in a.quickActions.value[a.activeMode.value]"
              :key="`${a.activeMode.value}-${action.label}`"
              type="button"
              class="ga-suggest__card"
              @click="onSuggest(action)"
            >
              <strong><Sparkles :size="15" />{{ action.label }}</strong>
            </button>
          </div>
        </div>
      </div>

      <!-- 对话线程：Codex 风执行流 -->
      <div v-else class="ga-thread">
        <div ref="conversationRef" class="ga-thread__scroll arc-scrollbar">
          <div class="ga-thread__inner">
            <div v-for="item in a.messages.value" :key="item.id" class="ga-msg" :class="item.role">
              <!-- 用户气泡 -->
              <div v-if="item.role === 'user'" class="ga-msg__user">{{ item.content }}</div>

              <!-- 助手执行流 -->
              <template v-else>
                <span class="ga-msg__role"><span class="ga-msg__dot"><Sparkles :size="12" /></span>全局助理 · {{ a.currentModeMeta.value.label }}模式</span>

                <div v-if="a.getMessageToolCalls(item).length" class="ga-toollog">
                  <div
                    v-for="group in a.groupedToolCalls(item)"
                    :key="groupKey(item.id, group)"
                    class="ga-toolgroup"
                    :class="{ collapsed: collapsedGroups[groupKey(item.id, group)] }"
                  >
                    <button type="button" class="ga-toolgroup__head" @click="toggleGroup(groupKey(item.id, group))">
                      <Wrench :size="14" />
                      {{ group.label }}
                      <span class="ga-toolgroup__badge">{{ group.items.length }}</span>
                      <ChevronDown :size="15" class="ga-toolgroup__chev" />
                    </button>
                    <div class="ga-toolgroup__list">
                      <div v-for="toolCall in group.items" :key="toolCall.toolUseId" class="ga-toolrow" :class="toolCall.status">
                        <span class="ga-toolrow__icon"><component :is="toolRowIcon(toolCall)" :size="13" /></span>
                        <span class="ga-toolrow__name">{{ a.describeToolAction(toolCall) }}</span>
                        <button
                          v-if="a.resolveKnowledgeSaveDestination(toolCall)"
                          type="button"
                          class="ga-toolrow__destination"
                          :disabled="!a.resolveKnowledgeSaveDestination(toolCall)?.canOpen"
                          @click="a.openKnowledgeSaveDestination(toolCall)"
                        >
                          <span>已保存到 {{ a.resolveKnowledgeSaveDestination(toolCall)?.label }}</span>
                          <strong>{{ a.resolveKnowledgeSaveDestination(toolCall)?.title }}</strong>
                        </button>
                        <span v-else class="ga-toolrow__detail">{{ a.formatToolArgs(toolCall.args) }}</span>
                        <span class="ga-toolrow__status" :class="toolCall.status">
                          <Loader2 v-if="toolCall.status === 'running'" :size="13" class="ga-spin" />
                          <Check v-else :size="13" />
                          {{ a.toolStatusLabel(toolCall) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="ga-msg__body" v-html="a.renderMarkdown(item.content)" />
              </template>
            </div>

            <!-- 生成提案提示：回答完成后，由用户决定是否把讨论整理成可写回提案 -->
            <div v-if="a.canSuggestProposal.value" class="ga-suggest">
              <div class="ga-suggest__text">
                <Sparkles :size="15" />
                <span>需要把这次讨论整理成世界观 / 角色 / 大纲的写回提案吗？</span>
              </div>
              <div class="ga-suggest__actions">
                <NButton size="small" tertiary @click="a.dismissProposalSuggestion()">暂不</NButton>
                <NButton size="small" type="primary" :loading="a.isProposalLoading.value" @click="a.generateProposalFromSuggestion()">生成提案</NButton>
              </div>
            </div>

            <!-- 写回提案卡 -->
            <div v-if="a.isProposalLoading.value || a.hasActionableProposal.value" class="ga-proposal">
              <div class="ga-proposal__head">
                <div class="ga-proposal__head-left">
                  <GitCompare :size="17" />
                  <strong>写回提案</strong>
                </div>
                <div class="ga-proposal__head-actions">
                  <NButton size="small" tertiary :loading="a.isProposalLoading.value" :disabled="a.isSending.value || a.isRunningAudit.value || a.isProposalLoading.value" @click="a.isAuditMode.value ? a.runAuditFromAssistant() : a.regenerateProposal()">
                    {{ a.isAuditMode.value ? '重新审计' : '生成提案' }}
                  </NButton>
                  <NButton
                    v-if="a.hasChapterEditProposals.value || (a.proposal.value && (a.proposal.value.constraintCreates.length || a.hasWorldviewApplyTarget() || a.hasCharacterApplyTarget() || a.hasOutlineApplyTarget()))"
                    size="small"
                    type="primary"
                    @click="showDiffReview = true"
                  >
                    全部写回
                  </NButton>
                  <NButton size="small" quaternary @click="a.clearProposal()">忽略</NButton>
                </div>
              </div>
              <p class="ga-proposal__summary">{{ a.proposal.value?.summary || (a.hasChapterEditProposals.value ? '已生成章节正文修改提案，请审查 Diff 后写回。' : '正在整理世界观、人物卡和大纲提案…') }}</p>

              <div v-if="a.proposal.value || a.hasChapterEditProposals.value" class="ga-proposal__sections">
                <section v-if="a.hasChapterEditProposals.value" class="ga-section">
                  <div class="ga-section__head"><span>章节正文</span><NButton size="tiny" secondary @click="showDiffReview = true">审查 Diff</NButton></div>
                  <div v-for="item in a.pendingChapterEditProposals.value" :key="item.proposalId" class="ga-item">
                    <div class="ga-item__top">
                      <strong>修改 · {{ a.resolveChapterEditTitle(item.chapterId) }}</strong>
                      <NTag size="small" round :bordered="false" type="info">{{ item.editType }}</NTag>
                    </div>
                    <p>{{ item.preview }}</p>
                  </div>
                </section>

                <!-- 项目约束 -->
                <section v-if="a.proposal.value && a.proposal.value.constraintCreates.length" class="ga-section">
                  <div class="ga-section__head"><span>项目约束</span><NButton size="tiny" secondary @click="showDiffReview = true">审查 Diff</NButton></div>
                  <div v-for="item in a.proposal.value.constraintCreates" :key="`gc-${item.title}`" class="ga-item">
                    <div class="ga-item__top"><strong>新增 · {{ item.title }}</strong><NTag size="small" round :bordered="false" type="warning">{{ item.scope }}</NTag></div>
                    <p>{{ item.reason }}</p>
                    <ul class="ga-changes"><li>约束内容：{{ item.content }}</li><li v-if="item.keywords.length">关键词：{{ item.keywords.join('、') }}</li></ul>
                  </div>
                </section>

                <!-- 世界观 -->
                <section v-if="a.proposal.value && (a.proposal.value.worldviewCreates.length || a.proposal.value.worldviewUpdates.length)" class="ga-section">
                  <div class="ga-section__head"><span>世界观</span><NButton size="tiny" secondary :disabled="!a.hasWorldviewApplyTarget()" @click="showDiffReview = true">审查 Diff</NButton></div>
                  <div v-for="item in a.proposal.value.worldviewCreates" :key="`wc-${item.title}`" class="ga-item">
                    <div class="ga-item__top"><strong>新增 · {{ item.title }}</strong><NTag size="small" round :bordered="false" type="info">{{ item.type }}</NTag></div>
                    <p>{{ item.content }}</p>
                  </div>
                  <div v-for="(item, index) in a.proposal.value.worldviewUpdates" :key="`wu-${index}-${item.matchTitle}`" class="ga-item">
                    <div class="ga-item__top">
                      <strong>更新 · {{ item.matchTitle }}</strong>
                      <NTag size="small" round :bordered="false" :type="a.resolveWorldviewTarget(item, index) ? 'success' : 'warning'">
                        {{ a.findWorldviewByTitle(item.matchTitle) ? '自动匹配' : a.resolveWorldviewTarget(item, index) ? '手动绑定' : '未匹配' }}
                      </NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <NSelect
                      v-if="!a.findWorldviewByTitle(item.matchTitle)"
                      :value="a.worldviewTargetMap.value[a.worldviewUpdateKey(index, item.matchTitle)] || null"
                      :options="a.worldviewTargetOptions.value"
                      size="small"
                      placeholder="选择要更新的世界观条目"
                      @update:value="(value) => { a.worldviewTargetMap.value[a.worldviewUpdateKey(index, item.matchTitle)] = String(value ?? '') }"
                    />
                    <ul class="ga-changes"><li v-if="item.title">新标题：{{ item.title }}</li><li v-if="item.type">新分类：{{ item.type }}</li><li v-if="item.content">新内容：{{ item.content }}</li></ul>
                  </div>
                </section>

                <!-- 人物卡 -->
                <section v-if="a.proposal.value && (a.proposal.value.characterCreates.length || a.proposal.value.characterUpdates.length)" class="ga-section">
                  <div class="ga-section__head"><span>人物卡</span><NButton size="tiny" secondary :disabled="!a.hasCharacterApplyTarget()" @click="showDiffReview = true">审查 Diff</NButton></div>
                  <div v-for="item in a.proposal.value.characterCreates" :key="`cc-${item.name}`" class="ga-item">
                    <div class="ga-item__top"><strong>新增 · {{ item.name }}</strong><NTag v-if="item.role" size="small" round :bordered="false" type="info">{{ item.role }}</NTag></div>
                    <p>{{ item.description }}</p>
                    <div class="ga-tags"><NTag v-for="tag in item.tags" :key="`${item.name}-${tag}`" size="small" round :bordered="false" type="info">{{ tag }}</NTag></div>
                  </div>
                  <div v-for="(item, index) in a.proposal.value.characterUpdates" :key="`cu-${index}-${item.matchName}`" class="ga-item">
                    <div class="ga-item__top">
                      <strong>更新 · {{ item.matchName }}</strong>
                      <NTag size="small" round :bordered="false" :type="a.resolveCharacterTarget(item, index) ? 'success' : 'warning'">
                        {{ a.findCharacterByName(item.matchName) ? '自动匹配' : a.resolveCharacterTarget(item, index) ? '手动绑定' : '未匹配' }}
                      </NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <NSelect
                      v-if="!a.findCharacterByName(item.matchName)"
                      :value="a.characterTargetMap.value[a.characterUpdateKey(index, item.matchName)] || null"
                      :options="a.characterTargetOptions.value"
                      size="small"
                      placeholder="选择要更新的人物卡"
                      @update:value="(value) => { a.characterTargetMap.value[a.characterUpdateKey(index, item.matchName)] = String(value ?? '') }"
                    />
                    <ul class="ga-changes"><li v-if="item.name">新名称：{{ item.name }}</li><li v-if="item.role">新定位：{{ item.role }}</li><li v-if="item.description">新简介：{{ item.description }}</li><li v-if="item.tags?.length">新标签：{{ item.tags.join('、') }}</li></ul>
                  </div>
                </section>

                <!-- 大纲 -->
                <section v-if="a.proposal.value && (a.proposal.value.outlineCreates.length || a.proposal.value.outlineUpdates.length)" class="ga-section">
                  <div class="ga-section__head"><span>大纲</span><NButton size="tiny" secondary :disabled="!a.hasOutlineApplyTarget()" @click="showDiffReview = true">审查 Diff</NButton></div>
                  <div v-for="item in a.proposal.value.outlineCreates" :key="`oc-${item.title}`" class="ga-item">
                    <div class="ga-item__top"><strong>新增 · {{ item.title }}</strong><NTag v-if="item.wordTarget" size="small" round :bordered="false" type="info">{{ item.wordTarget }}</NTag></div>
                    <p>{{ item.summary }}</p>
                    <ul class="ga-changes"><li v-if="item.conflict">冲突：{{ item.conflict }}</li></ul>
                  </div>
                  <div v-for="(item, index) in a.proposal.value.outlineUpdates" :key="`ou-${index}-${item.matchTitle}`" class="ga-item">
                    <div class="ga-item__top">
                      <strong>更新 · {{ item.matchTitle }}</strong>
                      <NTag size="small" round :bordered="false" :type="a.resolveOutlineTarget(item, index) ? 'success' : 'warning'">
                        {{ a.findOutlineByTitle(item.matchTitle) ? '自动匹配' : a.resolveOutlineTarget(item, index) ? '手动绑定' : '未匹配' }}
                      </NTag>
                    </div>
                    <p>{{ item.reason }}</p>
                    <NSelect
                      v-if="!a.findOutlineByTitle(item.matchTitle)"
                      :value="a.outlineTargetMap.value[a.outlineUpdateKey(index, item.matchTitle)] || null"
                      :options="a.outlineTargetOptions.value"
                      size="small"
                      placeholder="选择要更新的大纲节点"
                      @update:value="(value) => { a.outlineTargetMap.value[a.outlineUpdateKey(index, item.matchTitle)] = String(value ?? '') }"
                    />
                    <ul class="ga-changes"><li v-if="item.title">新标题：{{ item.title }}</li><li v-if="item.wordTarget">目标字数：{{ item.wordTarget }}</li><li v-if="item.conflict">冲突：{{ item.conflict }}</li><li v-if="item.summary">摘要：{{ item.summary }}</li></ul>
                  </div>
                </section>

                <section v-if="a.proposal.value && a.proposal.value.notes.length" class="ga-section">
                  <div class="ga-section__head"><span>提醒</span></div>
                  <ul class="ga-notes"><li v-for="note in a.proposal.value.notes" :key="note">{{ note }}</li></ul>
                </section>
              </div>
            </div>

            <div v-if="a.assistantStatus.value" class="ga-status"><span class="ga-status__pulse" />{{ a.assistantStatus.value }}</div>
          </div>
        </div>

        <!-- 停靠输入栏 -->
        <div class="ga-composer">
          <div class="ga-composer__inner">
            <div class="ga-composer__wrap" :class="{ disabled: a.isRunningAudit.value }">
              <textarea
                ref="composerRef"
                v-model="a.composerValue.value"
                class="ga-composer__input"
                rows="1"
                :disabled="a.isSending.value || a.isRunningAudit.value || a.isProposalLoading.value"
                :placeholder="a.isRunningAudit.value ? '正在执行项目审计…' : '继续追问，或交给助理执行下一步…'"
                @input="autoResize"
                @keydown="a.handleComposerKeydown"
              />
              <button
                class="ga-send"
                type="button"
                :class="{ stop: a.isSending.value }"
                :disabled="a.isRunningAudit.value || a.isProposalLoading.value || (!a.isSending.value && !a.composerValue.value.trim())"
                @click="onSend"
              >
                <Square v-if="a.isSending.value" :size="14" />
                <ArrowUp v-else :size="16" />
              </button>
            </div>
          </div>
          <div class="ga-composer__bar">
            <div class="ga-composer__left">
              <div class="ga-mode ga-mode--up">
                <button class="ga-pill" type="button" @click="showModeMenu = !showModeMenu">
                  <span class="ga-dot" :class="modeDotClass(a.activeMode.value)" />{{ a.currentModeMeta.value.label }}模式
                  <ChevronDown :size="14" />
                </button>
                <div v-if="showModeMenu" class="ga-mode__menu ga-mode__menu--up">
                  <button
                    v-for="item in a.modeOptions"
                    :key="item.id"
                    type="button"
                    class="ga-mode__item"
                    :class="{ active: a.activeMode.value === item.id }"
                    @click="pickMode(item.id)"
                  >
                    <span class="ga-dot" :class="modeDotClass(item.id)" />
                    <span class="ga-mode__copy"><strong>{{ item.label }}</strong><span>{{ item.description }}</span></span>
                  </button>
                </div>
              </div>
              <NButton
                v-if="a.messages.value.length > 0"
                tertiary
                size="small"
                :loading="a.isProposalLoading.value"
                :disabled="a.isSending.value || a.isRunningAudit.value || a.isProposalLoading.value"
                @click="a.isAuditMode.value ? a.runAuditFromAssistant() : a.regenerateProposal()"
              >
                {{ a.isAuditMode.value ? '重新审计' : '生成提案' }}
              </NButton>
            </div>
            <span class="ga-composer__hint">Enter 发送 · Shift+Enter 换行</span>
          </div>
        </div>
      </div>

      <!-- TEMPLATE_THREAD -->
    </div>
    <GlobalAssistantDiffReviewDialog
      v-model:show="showDiffReview"
      :summary="a.proposal.value?.summary || ''"
      :patch="a.proposalDiffPatch.value"
      :files="a.proposalDiffFiles.value"
      :stats="a.proposalDiffStats.value"
      @apply-file="applyFileFromReview"
      @apply-all="applyAllFromReview"
      @regenerate="a.regenerateProposal()"
      @clear="clearFromReview"
    />
  </section>
</template>

<style scoped>
/* 统一样式变量降级与过渡曲线 */
.ga-page {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--arc-bg-surface, #ffffff);
  color: var(--arc-text-primary, #1f2937);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

/* 自定义滚动条风格 */
.arc-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.arc-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.arc-scrollbar::-webkit-scrollbar-thumb {
  background: var(--arc-border, #e5e7eb);
  border-radius: 999px;
}
.arc-scrollbar::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--arc-border, #e5e7eb) 80%, #000);
}

/* 会话栏 */
.ga-rail {
  position: relative;
  display: flex;
  width: 240px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--arc-border, #e5e7eb);
  background: var(--arc-bg-weak, #f9fafb);
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-rail--dragging {
  transition: none;
}
.ga-rail--collapsed {
  width: 48px;
}
.ga-rail__resize {
  position: absolute;
  top: 0;
  right: -4px;
  z-index: 8;
  width: 8px;
  height: 100%;
  cursor: col-resize;
}
.ga-rail__resize::after {
  content: "";
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 3px;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background 0.18s;
}
.ga-rail__resize:hover::after,
.ga-rail--dragging .ga-rail__resize::after {
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 45%, var(--arc-border, #e5e7eb));
}
.ga-rail__collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 0;
}
.ga-rail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 16px 10px;
}
.ga-rail__head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ga-rail__toggle {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md, 6px);
  background: transparent;
  color: var(--arc-text-secondary, #4b5563);
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s, background 0.18s;
}
.ga-rail__toggle:hover:not(:disabled) {
  border-color: var(--arc-primary, #2563eb);
  color: var(--arc-primary, #2563eb);
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 4%, var(--arc-bg-surface, #ffffff));
}
.ga-rail__toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ga-rail__head strong {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--arc-text-secondary, #4b5563);
}
.ga-rail__new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: var(--arc-radius-md, 6px);
  background: var(--arc-bg-surface, #ffffff);
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s cubic-bezier(0.4, 0, 0.2, 1), color 0.18s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-rail__new:hover:not(:disabled) {
  border-color: var(--arc-primary, #2563eb);
  color: var(--arc-primary, #2563eb);
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 4%, var(--arc-bg-surface, #ffffff));
}
.ga-rail__new:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ga-rail__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding: 4px 10px 16px;
}
.ga-rail__empty {
  color: var(--arc-text-hint, #9ca3af);
  font-size: 12px;
  padding: 12px;
  text-align: center;
}
.ga-session {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md, 8px);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.18s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-session:hover {
  background: var(--arc-bg-surface-hover, #f3f4f6);
}
.ga-session.active {
  border-color: var(--arc-border, #e5e7eb);
  background: var(--arc-bg-surface, #ffffff);
  box-shadow: var(--arc-shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05));
}
.ga-session__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary, #1f2937);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
}
.ga-session__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.ga-session__del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--arc-text-hint, #9ca3af);
  opacity: 0;
  transition: opacity 0.18s cubic-bezier(0.4, 0, 0.2, 1), color 0.18s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-session:hover .ga-session__del {
  opacity: 1;
}
.ga-session__del:hover {
  color: var(--arc-danger, #ef4444);
  background: color-mix(in srgb, var(--arc-danger, #ef4444) 10%, transparent);
}
.ga-session__meta {
  color: var(--arc-text-hint, #9ca3af);
  font-size: 11px;
  padding-left: 14px;
}
.ga-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
}
.ga-dot.audit { background: var(--arc-warning, #f59e0b); }
.ga-dot.ingest { background: var(--arc-success, #10b981); }
.ga-dot.correct { background: var(--arc-primary, #2563eb); }

.ga-main {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

/* 空状态 */
.ga-empty {
  flex: 1;
  display: grid;
  grid-template-rows: minmax(60px, 1fr) auto minmax(80px, 1.2fr);
  justify-items: center;
  padding: 32px 24px;
  overflow-y: auto;
  background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--arc-primary, #2563eb) 6%, transparent) 0, transparent 55%), var(--arc-bg-surface, #ffffff);
}
.ga-empty__center {
  grid-row: 2;
  display: flex;
  width: min(680px, 100%);
  flex-direction: column;
  align-items: center;
  gap: 24px;
}
.ga-empty__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  overflow: hidden;
  background: var(--arc-bg-surface, #ffffff);
  box-shadow: 0 10px 25px color-mix(in srgb, var(--arc-primary, #2563eb) 22%, transparent);
}
.ga-empty__badge img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ga-empty__context {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary, #2563eb) 12%, var(--arc-border, #e5e7eb));
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-bg-surface, #ffffff) 80%, var(--arc-primary-soft, #eff6ff));
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12px;
  font-weight: 600;
}
.ga-hero {
  margin: 0;
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-align: center;
  color: var(--arc-text-primary, #1f2937);
}

/* 输入框（Gemini pill） */
.ga-prompt {
  width: 100%;
  border-radius: 24px;
  background: var(--arc-bg-surface, #ffffff);
  box-shadow: 0 16px 36px color-mix(in srgb, var(--arc-primary, #2563eb) 8%, transparent), 0 2px 8px rgba(0, 0, 0, 0.04);
}
.ga-prompt__bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  min-height: 56px;
  padding: 8px 10px 8px 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary, #2563eb) 8%, var(--arc-border, #e5e7eb));
  border-radius: inherit;
  transition: border-color 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-prompt__bar:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary, #2563eb) 35%, var(--arc-border, #e5e7eb));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary, #2563eb) 10%, transparent);
}
.ga-prompt__input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--arc-text-primary, #1f2937);
  font-size: 14.5px;
  line-height: 1.5;
  resize: none;
  min-height: 24px;
  max-height: 180px;
  overflow-y: hidden;
  padding: 6px 0;
}
.ga-prompt__input::placeholder {
  color: var(--arc-text-hint, #9ca3af);
}
.ga-prompt__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ga-send {
  display: inline-grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  border: none;
  background: var(--arc-primary, #2563eb);
  color: #ffffff;
  cursor: pointer;
  transition: opacity 0.18s, transform 0.18s, background 0.18s;
}
.ga-send:hover:not(:disabled) {
  opacity: 0.92;
}
.ga-send:active:not(:disabled) {
  transform: scale(0.95);
}
.ga-send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.ga-send.stop {
  background: var(--arc-danger, #ef4444);
}

/* 模式选择 */
.ga-mode {
  position: relative;
}
.ga-mode__btn, .ga-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 999px;
  background: var(--arc-bg-surface, #ffffff);
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s, background 0.18s;
}
.ga-pill {
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
}
.ga-mode__btn:hover, .ga-pill:hover {
  border-color: var(--arc-primary, #2563eb);
  color: var(--arc-primary, #2563eb);
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 4%, var(--arc-bg-surface, #ffffff));
}
.ga-mode__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 250px;
  padding: 6px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 12px;
  background: var(--arc-bg-surface, #ffffff);
  box-shadow: 0 10px 25px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
}
.ga-mode__menu--up {
  top: auto;
  bottom: calc(100% + 6px);
}
.ga-mode__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}
.ga-mode__item:hover {
  background: var(--arc-bg-surface-hover, #f3f4f6);
}
.ga-mode__item.active {
  background: var(--arc-primary-soft, #eff6ff);
}
.ga-mode__item .ga-dot {
  margin-top: 6px;
}
.ga-mode__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ga-mode__copy strong {
  font-size: 12.5px;
  color: var(--arc-text-primary, #1f2937);
}
.ga-mode__copy span {
  font-size: 11px;
  color: var(--arc-text-hint, #9ca3af);
  line-height: 1.4;
}

/* 建议卡 */
.ga-suggest {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.ga-suggest__card {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 999px;
  background: var(--arc-bg-surface, #ffffff);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05));
  transition: border-color 0.18s cubic-bezier(0.4, 0, 0.2, 1), transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-suggest__card:hover {
  border-color: color-mix(in srgb, var(--arc-primary, #2563eb) 30%, var(--arc-border, #e5e7eb));
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
.ga-suggest__card strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--arc-text-primary, #1f2937);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.ga-suggest__card strong svg {
  color: var(--arc-primary, #2563eb);
}

/* 对话线程 */
.ga-thread {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
.ga-thread__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 0 12px;
}
.ga-thread__inner {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 0 24px;
}

.ga-msg {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ga-msg.user {
  align-items: flex-end;
}
.ga-msg__user {
  max-width: min(85%, 580px);
  padding: 10px 16px;
  border: 1px solid color-mix(in srgb, var(--arc-primary, #2563eb) 12%, var(--arc-border, #e5e7eb));
  border-radius: 16px 16px 4px 16px;
  background: color-mix(in srgb, var(--arc-primary, #2563eb) 6%, var(--arc-bg-surface, #ffffff));
  color: var(--arc-text-primary, #1f2937);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.ga-msg__role {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ga-msg__dot {
  width: 20px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--arc-primary, #2563eb), color-mix(in srgb, var(--arc-primary, #2563eb) 55%, #6366f1));
  color: #ffffff;
}
.ga-msg__body {
  color: var(--arc-text-primary, #1f2937);
  font-size: 14px;
  line-height: 1.75;
  word-break: break-word;
}
.ga-msg__body :deep(p) {
  margin: 0 0 10px;
}
.ga-msg__body :deep(p:last-child) {
  margin-bottom: 0;
}
.ga-msg__body :deep(ul), .ga-msg__body :deep(ol) {
  margin: 8px 0 10px;
  padding-left: 22px;
}
.ga-msg__body :deep(li) {
  margin: 4px 0;
}
.ga-msg__body :deep(h1), .ga-msg__body :deep(h2), .ga-msg__body :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--arc-text-primary, #1f2937);
}
.ga-msg__body :deep(h1) { font-size: 1.25em; }
.ga-msg__body :deep(h2) { font-size: 1.15em; }
.ga-msg__body :deep(h3) { font-size: 1.05em; }
.ga-msg__body :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--arc-bg-surface-hover, #f3f4f6);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.88em;
}
.ga-msg__body :deep(pre) {
  margin: 12px 0;
  padding: 12px 16px;
  overflow-x: auto;
  border-radius: 8px;
  background: #1e293b;
  color: #f1f5f9;
}
.ga-msg__body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}
.ga-msg__body :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 12px;
  border-left: 4px solid var(--arc-primary, #2563eb);
  border-radius: 0 8px 8px 0;
  background: var(--arc-primary-soft, #eff6ff);
  color: var(--arc-text-secondary, #4b5563);
}

/* 工具调用日志 (微缩控制台风格) */
.ga-toollog {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ga-toolgroup {
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 8px;
  background: var(--arc-bg-weak, #f9fafb);
  overflow: hidden;
}
.ga-toolgroup__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ga-toolgroup__head:hover {
  background: var(--arc-bg-surface-hover, #f3f4f6);
}
.ga-toolgroup__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--arc-primary-soft, #eff6ff);
  color: var(--arc-primary, #2563eb);
  font-size: 10px;
  font-weight: 700;
}
.ga-toolgroup__chev {
  margin-left: auto;
  color: var(--arc-text-hint, #9ca3af);
  transition: transform 0.2s;
}
.ga-toolgroup.collapsed .ga-toolgroup__chev {
  transform: rotate(-90deg);
}
.ga-toolgroup.collapsed .ga-toolgroup__list {
  display: none;
}
.ga-toolgroup__list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--arc-border, #e5e7eb);
  background: var(--arc-bg-surface, #ffffff);
}
.ga-toolrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  font-size: 12px;
}
.ga-toolrow + .ga-toolrow {
  border-top: 1px solid color-mix(in srgb, var(--arc-border, #e5e7eb) 40%, transparent);
}
.ga-toolrow__icon {
  display: inline-grid;
  width: 22px;
  height: 22px;
  place-items: center;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--arc-bg-surface, #ffffff);
  border: 1px solid var(--arc-border, #e5e7eb);
  color: var(--arc-text-secondary, #4b5563);
}
.ga-toolrow__name {
  color: var(--arc-text-primary, #1f2937);
  font-weight: 500;
  flex-shrink: 0;
}
.ga-toolrow__detail {
  color: var(--arc-text-hint, #9ca3af);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.ga-toolrow__destination {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--arc-success, #10b981) 24%, var(--arc-border, #e5e7eb));
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-success, #10b981) 5%, var(--arc-bg-surface, #ffffff));
  color: var(--arc-text-secondary, #4b5563);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.ga-toolrow__destination:hover:not(:disabled) {
  border-color: var(--arc-success, #10b981);
  color: var(--arc-success, #10b981);
}
.ga-toolrow__destination:disabled {
  cursor: default;
  opacity: 0.72;
}
.ga-toolrow__destination span,
.ga-toolrow__destination strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-toolrow__destination span {
  flex-shrink: 0;
  color: var(--arc-text-hint, #9ca3af);
}
.ga-toolrow__destination strong {
  min-width: 0;
  font-weight: 600;
  color: inherit;
}
.ga-toolrow__status {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-hint, #9ca3af);
}
.ga-toolrow__status.done { color: var(--arc-success, #10b981); }
.ga-toolrow__status.running { color: var(--arc-primary, #2563eb); }
.ga-toolrow__status.error { color: var(--arc-danger, #ef4444); }
.ga-spin { animation: ga-spin 1s linear infinite; }
@keyframes ga-spin { to { transform: rotate(360deg); } }

/* 生成提案提示条 */
.ga-suggest {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border: 1px dashed color-mix(in srgb, var(--arc-primary, #2563eb) 32%, var(--arc-border, #e5e7eb));
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-bg-surface, #ffffff) 94%, var(--arc-primary-soft, #eff6ff));
  padding: 12px 16px;
}
.ga-suggest__text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--arc-text-secondary, #475569);
}
.ga-suggest__text svg {
  flex-shrink: 0;
  color: var(--arc-primary, #2563eb);
}
.ga-suggest__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 写回提案卡 (IDE 变更风格) */
.ga-proposal {
  margin-top: 4px;
  border: 1px solid color-mix(in srgb, var(--arc-primary, #2563eb) 18%, var(--arc-border, #e5e7eb));
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-bg-surface, #ffffff) 90%, var(--arc-primary-soft, #eff6ff));
  padding: 16px;
  box-shadow: var(--arc-shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05));
}
.ga-proposal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--arc-primary, #2563eb) 10%, var(--arc-border, #e5e7eb));
}
.ga-proposal__head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ga-proposal__head svg {
  color: var(--arc-primary, #2563eb);
}
.ga-proposal__head strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary, #1f2937);
}
.ga-proposal__head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ga-proposal__summary {
  margin: 12px 0 0;
  color: var(--arc-text-primary, #1f2937);
  font-size: 12.5px;
  line-height: 1.6;
}
.ga-proposal__sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}
.ga-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ga-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--arc-border, #e5e7eb) 60%, transparent);
}
.ga-section__head span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--arc-text-hint, #9ca3af);
}
.ga-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 8px;
  background: var(--arc-bg-surface, #ffffff);
}
.ga-item__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ga-item__top strong {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--arc-text-primary, #1f2937);
}
.ga-item p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--arc-text-secondary, #4b5563);
}
.ga-changes {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-left: 2px solid var(--arc-border, #e5e7eb);
}
.ga-changes li {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--arc-text-secondary, #4b5563);
}
.ga-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ga-notes {
  margin: 0;
  padding-left: 18px;
}
.ga-notes li {
  font-size: 12px;
  line-height: 1.6;
  color: var(--arc-text-secondary, #4b5563);
}

/* 状态条 */
.ga-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 12px;
}
.ga-status__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--arc-primary, #2563eb);
  animation: ga-pulse 1.4s ease-in-out infinite;
}
@keyframes ga-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.9); }
}

/* 停靠输入栏 */
.ga-composer {
  flex-shrink: 0;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--arc-border, #e5e7eb);
  background: var(--arc-bg-surface, #ffffff);
}
.ga-composer__inner {
  max-width: 760px;
  margin: 0 auto;
}
.ga-composer__wrap {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 10px 8px 16px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 18px;
  background: var(--arc-bg-surface, #ffffff);
  transition: border-color 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ga-composer__wrap:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary, #2563eb) 35%, var(--arc-border, #e5e7eb));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary, #2563eb) 8%, transparent);
}
.ga-composer__wrap.disabled {
  opacity: 0.65;
  background: var(--arc-bg-weak, #f9fafb);
}
.ga-composer__input {
  flex: 1;
  min-height: 22px;
  max-height: 180px;
  border: none;
  outline: none;
  resize: none;
  overflow-y: hidden;
  background: transparent;
  color: var(--arc-text-primary, #1f2937);
  font-size: 14px;
  line-height: 1.5;
  padding: 5px 0;
}
.ga-composer__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-width: 760px;
  margin: 8px auto 0;
}
.ga-composer__left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ga-composer__hint {
  color: var(--arc-text-hint, #9ca3af);
  font-size: 11px;
}

@media (max-width: 1080px) {
  .ga-rail {
    display: none;
  }
}
</style>
