<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useMessage } from 'naive-ui'
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Copy,
  ClipboardCheck,
  GitFork,
  Layers3,
  Pencil,
  SearchCheck,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  Undo2,
  UserRound
} from 'lucide-vue-next'
import type { AssistantMessageView, AssistantToolCallView } from '@/composables/useAssistant'
import type { StagedChange } from '@shared/assistant-runtime'

const MD_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'a', 'span', 'del', 'hr', 'input'
]
const MD_ALLOWED_ATTR = ['class', 'href', 'target', 'rel', 'type', 'checked', 'disabled']

marked.setOptions({
  breaks: true,
  gfm: true
})

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function normalizeMarkdownTables(content: string): string {
  const lines = content.split('\n')
  let inFence = false

  return lines.map((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence || !isTableSeparator(line) || index === 0) return line

    const headerCells = splitTableCells(lines[index - 1])
    const separatorCells = splitTableCells(line)
    if (headerCells.length <= separatorCells.length) return line

    const normalizedCells = [
      ...separatorCells,
      ...Array.from({ length: headerCells.length - separatorCells.length }, () => '------')
    ]
    return `| ${normalizedCells.join(' | ')} |`
  }).join('\n')
}

const markdownCache = new Map<string, { content: string; html: string }>()

function renderMarkdown(content: string, cacheKey: string): string {
  const cached = markdownCache.get(cacheKey)
  if (cached?.content === content) return cached.html
  const html = marked.parse(normalizeMarkdownTables(content || ''), { async: false }) as string
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR
  })
  markdownCache.set(cacheKey, { content, html: sanitized })
  return sanitized
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
}

const props = withDefaults(defineProps<{
  messages: AssistantMessageView[]
  isStreaming: boolean
  isInitializing?: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  assistantName?: string
  editingTurnId?: string | null
  editingDraft?: string
  isMutating?: boolean
  stagedChanges?: StagedChange[]
}>(), {
  editingTurnId: null,
  editingDraft: '',
  stagedChanges: () => []
})

const emit = defineEmits<{
  (e: 'open-knowledge', documentId?: string): void
  (e: 'continue', prompt: string): void
  (e: 'open-staged'): void
  (e: 'edit-start', turnId: string): void
  (e: 'edit-cancel'): void
  (e: 'edit-draft', value: string): void
  (e: 'resend'): void
  (e: 'undo', turnId: string): void
  (e: 'load-more'): void
}>()

const scrollRef = ref<HTMLDivElement | null>(null)
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)
const copiedTurnId = ref<string | null>(null)
const notification = useMessage()
const shouldFollowOutput = ref(true)
const loadMoreAnchor = ref<{ scrollHeight: number; scrollTop: number } | null>(null)
const BOTTOM_THRESHOLD_PX = 72

watch(
  () => props.messages[0]?.turnId,
  () => markdownCache.clear()
)

watch(
  () => props.editingTurnId,
  async (turnId) => {
    if (!turnId) return
    await nextTick()
    const textarea = editTextareaRef.value
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    autosizeEdit(textarea)
  }
)

function isNearBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX
}

function handleScroll(): void {
  const el = scrollRef.value
  if (el) shouldFollowOutput.value = isNearBottom(el)
}

function requestOlderMessages(): void {
  const el = scrollRef.value
  if (el) loadMoreAnchor.value = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
  emit('load-more')
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function restoreConversationPosition(): void {
  shouldFollowOutput.value = true
  void scrollToBottom()
}

onMounted(restoreConversationPosition)
onActivated(restoreConversationPosition)

watch(
  () => props.messages.length,
  (length, previousLength) => {
    if (length > previousLength && !loadMoreAnchor.value) {
      shouldFollowOutput.value = true
      void scrollToBottom()
    }
  }
)

watch(
  () => props.isLoadingMore,
  async (loading, wasLoading) => {
    if (loading || !wasLoading || !loadMoreAnchor.value) return
    await nextTick()
    const el = scrollRef.value
    const anchor = loadMoreAnchor.value
    if (el) el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight)
    loadMoreAnchor.value = null
  }
)

watch(
  () => {
    const message = props.messages[props.messages.length - 1]
    if (!message) return 'empty'
    return [
      message.turnId,
      message.assistantMessage.length,
      message.reasoning.length,
      message.flowBlocks.length,
      message.toolCalls.map((tool) => `${tool.status}:${tool.resultPreview?.length ?? 0}`).join(','),
      message.status
    ].join(':')
  },
  () => {
    if (shouldFollowOutput.value) void scrollToBottom()
  }
)

const projectDataLabels: Record<string, string> = {
  worldview: '世界观',
  characters: '人物设定',
  organizations: '势力与组织',
  organization_memberships: '组织成员归属',
  relationships: '人物关系',
  outline: '剧情大纲',
  chapters: '章节资料',
  plot_threads: '剧情线索',
  plotThreads: '剧情线索',
  inspiration: '灵感素材',
  knowledge: '项目知识库',
  available_deconstructions: '可用的拆书参考',
  deconstruction_library: '拆书知识库',
  reference_works: '已选参考书',
  workflow_documents: '创作记忆',
  workflowDocuments: '创作记忆',
  project_constraints: '项目约束',
  projectConstraints: '项目约束',
  style: '写作风格'
}

const workflowDocumentLabels: Record<string, string> = {
  task_plan: '创作计划',
  findings: '灵感与发现',
  progress: '写作进度',
  current_status: '项目概况',
  novel_setting: '世界与设定',
  character_relationships: '人物关系',
  pending_hooks: '伏笔悬念',
  resource_ledger: '素材清单'
}

const actionLabels: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  replace: '替换',
  replace_all: '替换全文',
  append: '追加',
  insert: '插入',
  restore: '恢复'
}

function projectDataLabel(value: unknown): string {
  const key = String(value ?? '').trim()
  return projectDataLabels[key] ?? (key || '项目资料')
}

function workflowDocumentLabel(value: unknown): string {
  const key = String(value ?? '').trim()
  return workflowDocumentLabels[key] ?? (key || '创作记忆')
}

function actionLabel(value: unknown, fallback = '修改'): string {
  const key = String(value ?? '').trim()
  return actionLabels[key] ?? (key || fallback)
}

/** 人类可读的工具动作说明。 */
function describeToolAction(t: AssistantToolCallView): string {
  const a = t.args
  switch (t.toolName) {
    case 'read_chapter': return a.chapter_id ? '读取指定章节内容' : '读取当前章节内容'
    case 'list_chapters': return '列出所有章节'
    case 'search_project': return `全项目搜索：“${short(a.query ?? a.q)}”`
    case 'read_project_data': {
      const dataLabel = projectDataLabel(a.entity_type)
      if (a.doc_key) return `读取${dataLabel}：${workflowDocumentLabel(a.doc_key)}`
      if (a.entity_id) return `精读${dataLabel}中的指定条目`
      if (a.summary_only === true) return `读取${dataLabel}摘要`
      return `读取${dataLabel}`
    }
    case 'stage_chapter_edit':
      return `暂存章节${actionLabel(a.operation)}提案`
    case 'stage_chapter_create': return `暂存新章节：${short(a.title ?? '未命名章节')}`
    case 'stage_chapter_delete': return '暂存删除指定章节'
    case 'stage_chapter_update': return '暂存章节资料修改'
    case 'list_chapter_versions': return '查看章节历史版本'
    case 'stage_chapter_restore': return '暂存恢复章节版本'
    case 'stage_relationship': return `暂存人物关系（${actionLabel(a.action)}）`
    case 'stage_organization_membership': return `暂存组织归属（${actionLabel(a.action)}）`
    case 'stage_inspiration': return `暂存灵感（${actionLabel(a.action)}）`
    case 'list_outline_volumes': return '列出所有分卷'
    case 'stage_outline_volume': return `暂存分卷（${actionLabel(a.action)}）`
    case 'stage_knowledge_document': return `暂存知识文档（${actionLabel(a.action)}）`
    case 'stage_project_metadata': return '暂存项目资料修改'
    case 'stage_worldview': return `暂存世界观（${actionLabel(a.action)}）`
    case 'stage_character': return `暂存人物卡（${actionLabel(a.action)}）`
    case 'stage_organization': return `暂存组织（${actionLabel(a.action)}）`
    case 'stage_outline': return `暂存大纲节点（${actionLabel(a.action)}）`
    case 'stage_constraint': return `暂存项目约束（${actionLabel(a.action, '新增')}）`
    case 'stage_plot_thread': return `暂存剧情线索（${actionLabel(a.action)}）`
    case 'stage_workflow_document': return `暂存创作记忆（${workflowDocumentLabel(a.doc_key)}${a.operation ? ' · ' + actionLabel(a.operation) : ''}）`
    case 'skill_list': return '查看可用技能'
    case 'skill_load': return '加载写作技能'
    case 'skill_read_reference': return '读取写作技能参考资料'
    case 'skill_glob': return '浏览写作技能文件'
    case 'skill_run_script': return '执行写作技能分析'
    case 'knowledge_save_document': return `保存知识文档：${short(a.title)}`
    default: return t.toolName
  }
}

function short(v: unknown, max = 40): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}

function knowledgeDocumentId(t: AssistantToolCallView): string | undefined {
  if (t.toolName !== 'knowledge_save_document' || !t.resultPreview) return undefined
  const match = String(t.resultPreview).match(/ID:\s*([A-Za-z0-9_-]+)/)
  return match?.[1]
}

function canOpenKnowledge(t: AssistantToolCallView): boolean {
  return t.toolName === 'knowledge_save_document' && t.status === 'ok'
}

function isEvidenceTool(name: string): boolean {
  return name === 'search_project' ||
    name === 'read_project_data' ||
    name === 'read_chapter' ||
    name === 'list_chapters'
}

function evidenceLabel(t: AssistantToolCallView): string {
  if (t.toolName === 'search_project') return `搜索：${short(t.args.query ?? t.args.q, 28)}`
  if (t.toolName === 'read_project_data') {
    const dataLabel = projectDataLabel(t.args.entity_type ?? '项目索引')
    if (t.args.doc_key) return `读取资料：${dataLabel} · ${workflowDocumentLabel(t.args.doc_key)}`
    if (t.args.entity_id) return `精读资料：${dataLabel}中的指定条目`
    if (t.args.summary_only === true) return `读取资料：${dataLabel}摘要`
    return `读取资料：${dataLabel}`
  }
  if (t.toolName === 'read_chapter') return t.args.chapter_id ? '读取章节：指定章节' : '读取章节：当前章节'
  if (t.toolName === 'list_chapters') return '章节列表'
  return t.toolName
}

function toolStatusText(t: AssistantToolCallView): string {
  if (t.status === 'running') return '进行中'
  if (t.status === 'error') return '失败'
  return '完成'
}

function skillStateText(state: AssistantMessageView['skillReceipt'][number]['state']): string {
  if (state === 'loaded') return '已加载'
  if (state === 'injected') return '已注入'
  return '候选'
}

function commandLabel(t: AssistantToolCallView): string {
  return isEvidenceTool(t.toolName) ? evidenceLabel(t) : describeToolAction(t)
}

function commandSummary(calls: AssistantToolCallView[]): string {
  const running = calls.filter((c) => c.status === 'running').length
  const failed = calls.filter((c) => c.status === 'error').length
  if (running > 0) return `正在运行 ${running} 条命令`
  if (failed > 0) return `已运行 ${calls.length} 条命令，${failed} 条失败`
  return `已运行 ${calls.length} 条命令`
}

function commandSectionLabel(calls: AssistantToolCallView[]): string {
  if (calls.every((call) => isEvidenceTool(call.toolName))) return '读取上下文'
  if (calls.some((call) => /audit|check|review/i.test(call.toolName))) return '审计检查'
  if (calls.some((call) => call.toolName.startsWith('stage_'))) return '准备变更'
  return '工具执行'
}

function commandSectionIcon(calls: AssistantToolCallView[]) {
  if (calls.every((call) => isEvidenceTool(call.toolName))) return SearchCheck
  if (calls.some((call) => /audit|check|review/i.test(call.toolName))) return ClipboardCheck
  return SquareTerminal
}

function shouldExpandCommands(calls: AssistantToolCallView[]): boolean {
  return calls.some((call) => call.status === 'running' || call.status === 'error')
}

function isActiveReasoningBlock(message: AssistantMessageView, blockId: string): boolean {
  return message.status === 'streaming'
    && message.flowBlocks[message.flowBlocks.length - 1]?.id === blockId
}

const editingIndex = computed(() =>
  props.editingTurnId
    ? props.messages.findIndex((message) => message.turnId === props.editingTurnId)
    : -1
)

function impactAt(index: number): { laterTurns: number; staged: number; committed: number } {
  const turnIds = new Set(props.messages.slice(index).map((message) => message.turnId))
  const changes = props.stagedChanges.filter((change) => turnIds.has(change.turnId))
  return {
    laterTurns: Math.max(0, props.messages.length - index - 1),
    staged: changes.filter((change) => change.status !== 'committed').length,
    committed: changes.filter((change) => change.status === 'committed').length
  }
}

async function copyUserMessage(message: AssistantMessageView): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.userMessage)
    copiedTurnId.value = message.turnId
    window.setTimeout(() => {
      if (copiedTurnId.value === message.turnId) copiedTurnId.value = null
    }, 1200)
    notification.success('已复制到剪贴板')
  } catch {
    copiedTurnId.value = null
    notification.error('复制失败，请重试')
  }
}

function autosizeEdit(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(240, textarea.scrollHeight)}px`
}

function handleEditInput(event: Event): void {
  const textarea = event.target as HTMLTextAreaElement
  emit('edit-draft', textarea.value)
  autosizeEdit(textarea)
}

function handleEditKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('edit-cancel')
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (props.editingDraft.trim() && !props.isMutating) emit('resend')
  }
}

const hasContent = computed(() => props.messages.length > 0)
</script>

<template>
  <div ref="scrollRef" class="messages arc-scrollbar" @scroll.passive="handleScroll">
    <!-- 骨架屏：初始加载中 -->
    <div v-if="props.isInitializing && !hasContent" class="skeleton">
      <div class="skeleton-item user">
        <div class="skeleton-avatar" />
        <div class="skeleton-bubble" />
      </div>
      <div class="skeleton-item assistant">
        <div class="skeleton-avatar" />
        <div class="skeleton-content">
          <div class="skeleton-line" />
          <div class="skeleton-line" />
          <div class="skeleton-line short" />
        </div>
      </div>
    </div>

    <div v-else-if="!hasContent" class="empty">
      <div class="title">开始一段对话</div>
      <div class="hint">
        {{ props.isStreaming ? '正在处理请求…' : '试试问："介绍项目里的第一个人物" 或"帮我优化第一章的开头"' }}
      </div>
    </div>

    <button
      v-if="hasContent && props.hasMore"
      type="button"
      class="load-more"
      :disabled="props.isLoadingMore"
      @click="requestOlderMessages"
    >
      {{ props.isLoadingMore ? '正在加载...' : '加载更早对话' }}
    </button>

    <article
      v-for="(msg, index) in props.messages"
      :key="msg.turnId"
      class="turn-entry"
      :class="{
        'is-first': index === 0,
        'is-doomed': editingIndex >= 0 && index > editingIndex
      }"
    >
      <div v-if="props.editingTurnId === msg.turnId" class="turn-editor">
        <header class="turn-editor-head">
          <GitFork :size="14" />
          <span>从这里重新分叉</span>
          <em>第 {{ index + 1 }} 轮及之后重写</em>
        </header>
        <textarea
          ref="editTextareaRef"
          :value="props.editingDraft"
          rows="3"
          @input="handleEditInput"
          @keydown="handleEditKeydown"
        />
        <div class="edit-impact">
          <div class="edit-impact-head">
            <TriangleAlert :size="14" />
            <span>重新发送会</span>
          </div>
          <ul>
            <li v-if="impactAt(index).laterTurns > 0">
              丢弃这一轮之后的 <strong>{{ impactAt(index).laterTurns }}</strong> 轮对话
            </li>
            <li v-if="impactAt(index).staged > 0">
              连带丢弃 <strong>{{ impactAt(index).staged }}</strong> 项暂存变更
            </li>
            <li v-if="impactAt(index).committed > 0" class="hard-warning">
              <strong>{{ impactAt(index).committed }}</strong> 项已写回项目的改动不会回滚
            </li>
            <li v-if="impactAt(index).laterTurns === 0 && impactAt(index).staged === 0 && impactAt(index).committed === 0">
              替换这一轮提问与回答
            </li>
          </ul>
        </div>
        <footer class="turn-editor-foot">
          <span>Enter 重发 · Shift+Enter 换行 · Esc 取消</span>
          <button type="button" class="edit-cancel" :disabled="props.isMutating" @click="emit('edit-cancel')">取消</button>
          <button
            type="button"
            class="edit-resend"
            :disabled="!props.editingDraft.trim() || props.isMutating"
            @click="emit('resend')"
          >
            {{ props.isMutating ? '处理中' : '重新发送' }}
          </button>
        </footer>
      </div>

      <template v-else>
      <div class="user-entry">
        <div class="user-avatar">
          <UserRound :size="14" :stroke-width="1.9" />
        </div>
        <div class="user-content">{{ msg.userMessage }}</div>
        <time class="message-time user-time" :datetime="msg.createdAt">{{ formatMessageTime(msg.createdAt) }}</time>
        <div v-if="!props.isStreaming && msg.status !== 'streaming'" class="user-actions">
          <button
            type="button"
            :title="copiedTurnId === msg.turnId ? '已复制' : '复制提问'"
            :aria-label="copiedTurnId === msg.turnId ? '已复制' : '复制提问'"
            :disabled="props.isMutating"
            @click="copyUserMessage(msg)"
          >
            <Copy :size="13" />
          </button>
          <button
            type="button"
            title="编辑并重新发送"
            aria-label="编辑并重新发送"
            :disabled="props.isMutating"
            @click="emit('edit-start', msg.turnId)"
          >
            <Pencil :size="13" />
          </button>
          <button
            v-if="index === props.messages.length - 1"
            type="button"
            class="danger-action"
            title="撤回本轮"
            aria-label="撤回本轮"
            :disabled="props.isMutating"
            @click="emit('undo', msg.turnId)"
          >
            <Undo2 :size="13" />
          </button>
        </div>
      </div>

      <div class="assistant-block">
        <div class="assistant-head">
          <span class="assistant-mark">
            <Sparkles :size="12" :stroke-width="2" />
          </span>
          <span class="assistant-name">{{ props.assistantName ?? '全局助手' }}</span>
          <time class="message-time" :datetime="msg.createdAt">{{ formatMessageTime(msg.createdAt) }}</time>
          <span v-if="msg.status === 'streaming'" class="assistant-state">{{ msg.activityText || '处理中' }}</span>
        </div>

      <template v-if="msg.flowBlocks.length > 0">
        <template v-for="block in msg.flowBlocks" :key="block.id">
          <details
            v-if="block.kind === 'reasoning'"
            class="message-section reasoning-section"
            :open="isActiveReasoningBlock(msg, block.id)"
          >
            <summary class="section-summary">
              <Brain :size="14" />
              <span>分析过程</span>
              <em>{{ isActiveReasoningBlock(msg, block.id) ? '进行中' : '已完成' }}</em>
            </summary>
            <div class="section-body assistant-copy reasoning-copy markdown-body" v-html="renderMarkdown(block.content, `${msg.turnId}:${block.id}`)" />
          </details>

          <details
            v-else-if="block.kind === 'commands'"
            class="message-section command-block"
            :open="shouldExpandCommands(block.commands)"
          >
            <summary class="section-summary command-summary">
              <component :is="commandSectionIcon(block.commands)" class="summary-icon" :size="15" :stroke-width="1.75" />
              <span>{{ commandSectionLabel(block.commands) }}</span>
              <em>{{ commandSummary(block.commands) }}</em>
            </summary>

            <div class="command-details">
              <div
                v-for="item in block.commands"
                :key="item.toolUseId"
                class="command-item"
                :class="item.status"
              >
                <div class="command-item-head">
                  <span class="command-state" />
                  <span class="command-title">{{ commandLabel(item) }}</span>
                  <span class="command-meta">
                    {{ toolStatusText(item) }}
                  </span>
                  <button
                    v-if="canOpenKnowledge(item)"
                    type="button"
                    class="tool-open"
                    @click.stop="emit('open-knowledge', knowledgeDocumentId(item))"
                  >
                    打开
                  </button>
                </div>
                <details
                  v-if="item.resultPreview"
                  class="command-preview"
                >
                  <summary>查看返回内容</summary>
                  <pre>{{ item.resultPreview }}</pre>
                </details>
              </div>
            </div>
          </details>

          <button
            v-else-if="block.kind === 'staged'"
            type="button"
            class="staged-block"
            @click="emit('open-staged')"
          >
            <span class="staged-icon"><Layers3 :size="15" /></span>
            <span class="staged-copy">
              <strong>已生成 {{ block.changeIds.length }} 项暂存变更</strong>
              <small>正文或项目数据尚未写回，等待你的确认</small>
            </span>
            <ChevronRight :size="15" />
          </button>

          <section
            v-else
            class="message-section result-section"
          >
            <header class="result-head">
              <CheckCircle2 :size="14" />
              <span>{{ msg.toolCalls.some((call) => /audit|check|review/i.test(call.toolName)) ? '审计结果' : '助手回复' }}</span>
            </header>
            <div class="section-body assistant-copy markdown-body">
              <div v-html="renderMarkdown(block.content, `${msg.turnId}:${block.id}`)" />
              <span v-if="msg.status === 'streaming' && block.id === msg.flowBlocks[msg.flowBlocks.length - 1]?.id" class="cursor">▍</span>
            </div>
          </section>
        </template>
      </template>
      <div v-else-if="msg.status === 'streaming'" class="assistant-copy thinking-copy">
        <span class="thinking-dots"><i /><i /><i /></span>
        正在分析你的问题，并按需读取项目上下文。
      </div>
      </div>

      <div v-if="msg.error" class="error-block">
        <CircleAlert :size="15" />
        <div>
          <div class="error-title">失败原因</div>
          <div class="error-body">{{ msg.error }}</div>
        </div>
      </div>

      <div v-if="msg.status === 'canceled'" class="status-tag">已取消</div>

      <div v-if="msg.skillMode === 'off' || msg.skillReceipt.length > 0" class="skill-receipt">
        <Sparkles :size="13" />
        <span>{{ msg.skillMode === 'off' ? '本轮未使用 Skill' : '本轮技能' }}</span>
        <em v-for="skill in msg.skillReceipt" :key="skill.id">
          {{ skill.name }}（{{ skillStateText(skill.state) }}）
        </em>
      </div>

      <div v-if="msg.resumable && msg.status === 'done'" class="continue-line">
        <SquareTerminal class="summary-icon" :size="15" :stroke-width="1.75" />
        <div class="continue-copy">
          <span>{{ msg.resumable.reason || '可以基于现有证据继续下一批读取与分析。' }}</span>
          <button type="button" class="resume-btn" @click="emit('continue', msg.resumable.prompt)">
            {{ msg.resumable.label || '继续' }}
          </button>
        </div>
      </div>
      </template>
    </article>
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  overflow-anchor: none;
  padding: 24px 28px 18px;
  display: flex;
  flex-direction: column;
  gap: 26px;
  min-width: 0;
  min-height: 0;
}
/* ── Skeleton 加载占位 ── */
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px 0;
  pointer-events: none;
}
.skeleton-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.skeleton-item.user {
  flex-direction: row-reverse;
}
.skeleton-avatar {
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--arc-border-strong);
  animation: shimmer 1.6s ease-in-out infinite;
}
.skeleton-bubble {
  width: 200px;
  height: 36px;
  border-radius: 12px;
  background: var(--arc-border-strong);
  animation: shimmer 1.6s ease-in-out infinite;
}
.skeleton-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}
.skeleton-line {
  height: 13px;
  border-radius: 6px;
  background: var(--arc-border-strong);
  animation: shimmer 1.6s ease-in-out infinite;
}
.skeleton-line.short {
  width: 55%;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.45; }
  50%       { opacity: 0.2;  }
}

.empty {
  margin: auto;
  text-align: center;
  padding: 40px 20px;
}
.empty .title {
  font-size: 15px;
  font-weight: 500;
  color: var(--arc-text-primary);
  margin-bottom: 6px;
}
.empty .hint {
  font-size: 13px;
  color: var(--arc-text-hint);
}
.turn-entry {
  width: min(100%, 900px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding-top: 30px;
  border-top: 1px solid var(--arc-border);
}
.turn-entry.is-first {
  padding-top: 0;
  border-top: none;
}
.turn-entry.is-doomed {
  opacity: 0.38;
}
.turn-entry.is-doomed .user-content {
  text-decoration: line-through;
  text-decoration-color: var(--arc-text-hint);
}
.user-entry {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.load-more {
  display: block;
  margin: 0 auto 18px;
  padding: 5px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.load-more:hover:not(:disabled) { color: var(--arc-primary); border-color: var(--arc-primary); }
.load-more:disabled { opacity: 0.6; cursor: wait; }
.message-time {
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
  font-size: 10px;
  font-weight: 400;
  white-space: nowrap;
}
.user-time {
  align-self: flex-end;
  margin-bottom: 2px;
}
.user-actions {
  position: absolute;
  top: -13px;
  right: 0;
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-md);
  opacity: 0;
  pointer-events: none;
  transform: translateY(3px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.user-entry:hover .user-actions,
.user-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.user-actions button {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
}
.user-actions button:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.user-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.user-actions button.danger-action:hover {
  background: var(--v2-danger-soft);
  color: var(--v2-danger);
}
.turn-editor {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  border-radius: 8px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-md);
  animation: editor-in 0.22s ease-out;
}
@keyframes editor-in {
  from { opacity: 0; transform: translateY(-4px); }
}
.turn-editor-head {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border-bottom: 1px solid var(--arc-border);
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 11px;
}
.turn-editor-head em {
  margin-left: auto;
  color: var(--arc-text-hint);
  font-style: normal;
}
.turn-editor textarea {
  display: block;
  width: 100%;
  min-height: 76px;
  max-height: 240px;
  resize: none;
  border: 0;
  outline: 0;
  padding: 12px;
  background: transparent;
  color: var(--arc-text-primary);
  font: inherit;
  font-size: 14px;
  line-height: 1.7;
}
.edit-impact {
  padding: 9px 12px;
  border-top: 1px solid var(--arc-border);
  background: var(--v2-warn-soft);
}
.edit-impact-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--v2-warn);
  font-family: var(--v2-mono);
  font-size: 11px;
}
.edit-impact ul {
  margin: 5px 0 0 18px;
  padding: 0;
}
.edit-impact li {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}
.edit-impact strong {
  color: var(--arc-text-primary);
  font-weight: 600;
}
.edit-impact .hard-warning,
.edit-impact .hard-warning strong {
  color: var(--v2-danger);
}
.turn-editor-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px 8px 12px;
  border-top: 1px solid var(--arc-border);
}
.turn-editor-foot > span {
  margin-right: auto;
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
  font-size: 10px;
}
.turn-editor-foot button {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12px;
}
.turn-editor-foot button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.edit-cancel {
  border: 1px solid transparent;
  background: transparent;
  color: var(--arc-text-secondary);
}
.edit-cancel:hover {
  background: var(--arc-bg-weak);
}
.edit-resend {
  border: 1px solid var(--arc-primary);
  background: var(--arc-primary);
  color: #fff;
}
.user-avatar {
  display: inline-flex;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  color: var(--arc-text-secondary);
  transform: translateY(1px);
}
.user-content,
.assistant-copy {
  color: var(--arc-text-primary);
  font-size: 15px;
  line-height: 1.8;
  word-break: break-word;
}
.user-content {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  font-weight: 500;
}
.assistant-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.message-section {
  min-width: 0;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  overflow: hidden;
}
.section-summary {
  min-height: 36px;
  padding: 0 11px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  list-style: none;
  font-size: 12px;
  font-weight: 600;
}
.section-summary::-webkit-details-marker { display: none; }
.section-summary::marker { content: ''; }
.section-summary em {
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
  font-size: 10.5px;
  font-style: normal;
  font-weight: 400;
}
.section-body {
  padding: 11px 12px 13px;
  border-top: 1px solid var(--arc-border);
}
.result-section {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
}
.result-head {
  min-height: 34px;
  padding: 0 11px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 600;
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
}
.assistant-head {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.assistant-mark {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}
.assistant-name {
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.assistant-state {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 10.5px;
}
.thinking-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-secondary);
}
.thinking-dots {
  display: inline-flex;
  gap: 3px;
}
.thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  animation: thinking-bounce 1.3s ease-in-out infinite;
}
.thinking-dots i:nth-child(2) { animation-delay: 0.18s; }
.thinking-dots i:nth-child(3) { animation-delay: 0.36s; }
@keyframes thinking-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}
.reasoning-copy {
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}
.markdown-body :deep(p) { margin: 0 0 10px; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-weight: 600;
  margin: 14px 0 7px;
  color: var(--arc-text-primary);
}
.markdown-body :deep(h1) { font-size: 18px; }
.markdown-body :deep(h2) { font-size: 16.5px; }
.markdown-body :deep(h3) { font-size: 15px; }
.markdown-body :deep(h4) { font-size: 14px; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 4px 0 10px;
  padding-left: 22px;
}
.markdown-body :deep(li) {
  margin: 3px 0;
}
.markdown-body :deep(input[type='checkbox']) {
  margin: 0 6px 0 0;
  transform: translateY(1px);
}
.markdown-body :deep(code) {
  font-family: var(--v2-mono);
  font-size: 12.5px;
  background: var(--arc-bg-weak);
  padding: 1px 5px;
  border-radius: 4px;
}
.markdown-body :deep(pre) {
  background: var(--arc-bg-weak);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--arc-border-strong);
  padding: 2px 0 2px 10px;
  color: var(--arc-text-secondary);
  margin: 8px 0;
}
.markdown-body :deep(a) {
  color: var(--arc-primary);
  text-decoration: none;
}
.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--arc-border);
  padding: 4px 8px;
  font-size: 12.5px;
}
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--arc-border);
  margin: 12px 0;
}
.cursor {
  display: inline-block;
  animation: blink 1s steps(2) infinite;
  color: var(--arc-primary);
  margin-left: 2px;
}
@keyframes blink {
  50% { opacity: 0; }
}
@keyframes pulse {
  50% { opacity: 0.35; }
}
.command-block {
  display: block;
}
.command-summary {
  width: 100%;
  user-select: none;
}
.command-summary::-webkit-details-marker,
.command-preview summary::-webkit-details-marker {
  display: none;
}
.command-summary::marker,
.command-preview summary::marker {
  content: '';
}
.command-block[open] > .command-summary {
  color: var(--arc-text-secondary);
}
.summary-icon {
  flex: 0 0 auto;
  color: currentColor;
}
.command-details {
  margin: 0;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--arc-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.staged-block {
  width: 100%;
  min-height: 54px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border: 1px solid color-mix(in srgb, var(--arc-warning) 32%, var(--arc-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-warning) 5%, var(--arc-bg-surface));
  color: var(--arc-text-secondary);
  text-align: left;
  cursor: pointer;
}
.staged-block:hover {
  border-color: var(--arc-warning);
  background: color-mix(in srgb, var(--arc-warning) 8%, var(--arc-bg-surface));
}
.staged-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: color-mix(in srgb, var(--arc-warning) 13%, var(--arc-bg-surface));
  color: var(--arc-warning);
}
.staged-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.staged-copy strong {
  color: var(--arc-text-primary);
  font-size: 12.5px;
}
.staged-copy small {
  color: var(--arc-text-hint);
  font-size: 11px;
}
.command-item {
  min-width: 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}
.command-item-head {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.command-state {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  transform: translateY(-1px);
}
.command-item.ok .command-state {
  background: var(--arc-primary);
}
.command-item.error .command-state {
  background: var(--v2-danger);
}
.command-item.running .command-state {
  background: var(--v2-warn);
  animation: pulse 1.4s ease-in-out infinite;
}
.command-title {
  min-width: 0;
  overflow: hidden;
  color: var(--arc-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-meta {
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
  font-size: 11px;
  white-space: nowrap;
}
.tool-open {
  border: 0;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.tool-open:hover,
.resume-btn:hover {
  text-decoration: underline;
}
.command-preview {
  margin: 6px 0 0 16px;
}
.command-preview summary {
  width: fit-content;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}
.command-preview pre {
  margin: 7px 0 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  border-left: 2px solid var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-family: var(--v2-mono);
  font-size: 11.5px;
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-word;
}
.error-block {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--v2-danger) 30%, var(--arc-border));
  border-radius: 6px;
  background: var(--v2-danger-soft);
  color: var(--v2-danger);
  font-size: 13px;
}
.error-title {
  color: var(--v2-danger);
  font-weight: 600;
  margin-bottom: 3px;
}
.error-body {
  color: var(--arc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.continue-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--arc-text-hint);
  font-size: 13px;
  line-height: 1.5;
}
.continue-copy {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.resume-btn {
  border: 0;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 0;
}
.status-tag {
  color: var(--arc-text-hint);
  font-size: 12px;
}
.skill-receipt {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--arc-text-hint);
  font-size: 11px;
}
.skill-receipt > span {
  color: var(--arc-text-secondary);
  font-weight: 600;
}
.skill-receipt em {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-style: normal;
}

@media (max-width: 720px) {
  .messages {
    padding: 18px 16px 14px;
    gap: 22px;
  }
  .turn-entry {
    gap: 14px;
    padding-top: 22px;
  }
  .user-content,
  .assistant-copy {
    font-size: 14px;
    line-height: 1.72;
  }
  .command-details {
    margin-left: 22px;
  }
  .command-item-head {
    grid-template-columns: 8px minmax(0, 1fr);
  }
  .command-title {
    white-space: normal;
  }
  .command-meta,
  .tool-open {
    grid-column: 2;
    justify-self: start;
  }
  .user-entry {
    flex-wrap: wrap;
  }
  .user-actions {
    position: static;
    flex-basis: calc(100% - 36px);
    margin-left: 36px;
    padding: 0;
    border: 0;
    box-shadow: none;
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
  .user-actions button {
    border: 1px solid var(--arc-border);
  }
  .turn-editor-head em,
  .turn-editor-foot > span {
    display: none;
  }
}
</style>
