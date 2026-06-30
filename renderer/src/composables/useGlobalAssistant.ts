import { computed, nextTick, onBeforeUnmount, onMounted, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { BookMarked, FileCheck2, Globe2, Network, Users } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AssistantToolCall, ChatMessage, GlobalAssistantProposal, PanelName } from '@/types/app'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

export type AssistantMode = 'ingest' | 'correct' | 'audit'

export type QuickAction = {
  label: string
  prompt: string
}

type ProposalIntent = 'chat' | 'proposal'

export type ToolGroup = {
  key: 'search' | 'read' | 'write'
  label: string
  items: AssistantToolCall[]
}

export type KnowledgeSaveDestination = {
  label: string
  title: string
  documentId: string
  canOpen: boolean
}

export type GlobalAssistantProposalDiffFile = {
  id: string
  title: string
  path: string
  kind: 'constraint' | 'worldview' | 'character' | 'organization' | 'outline' | 'note'
  action: 'create' | 'update' | 'note'
  oldText: string
  newText: string
  reason: string
  canApply: boolean
}

export interface UseGlobalAssistantOptions {
  /** 当前视图标签，用于流式上下文 currentPanelLabel */
  activeViewLabel?: MaybeRefOrGetter<string>
}

marked.setOptions({
  breaks: true,
  gfm: true
})

const MARKDOWN_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'a', 'span', 'del', 'hr'
]
const MARKDOWN_ALLOWED_ATTR = ['class', 'href', 'target', 'rel']

const AI_TASK_KEY = 'global-assistant-chat'
const PROPOSAL_TASK_KEY = 'global-assistant-proposal'

// 全局助手可以同时以整页和悬浮 dock 两种形态挂载。
// 流式任务必须独立于具体组件实例，否则切换页面导致组件卸载时会丢失主进程事件。
const sharedIsRunningAudit = ref(false)
const sharedIsSending = ref(false)
const sharedIsProposalLoading = ref(false)
/** 已被用户忽略「生成提案」提示的助手消息 id；新回复到来后会重新提示。 */
const sharedDismissedProposalSuggestionFor = ref('')
let sharedStreamId: string | null = null
let sharedStreamingMessageId: string | null = null
let sharedRemoveStreamListener: (() => void) | null = null
let sharedResolveStream: ((text: string) => void) | null = null
let sharedRejectStream: ((error: Error) => void) | null = null

const GLOBAL_ASSISTANT_MODE_OPTIONS: Array<{ id: AssistantMode; label: string; description: string }> = [
  { id: 'ingest', label: '录入', description: '整理长设定、粗大纲和项目草稿' },
  { id: 'correct', label: '修正', description: '纠正世界观、人设和大纲跑偏' },
  { id: 'audit', label: '审计', description: '检查 OOC、冲突和伏笔问题' }
]

/** 渲染助手消息 Markdown（纯函数，可模块级共享） */
export function renderMarkdown(content: string): string {
  const html = marked.parse(content || '', { async: false }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR
  })
}

function formatToolArgs(args: Record<string, unknown>): string {
  if (
    Object.prototype.hasOwnProperty.call(args, 'chapter_id')
    && String(args.chapter_id ?? '').trim() === ''
    && args.include_content === true
  ) {
    return '未指定章节，且当前没有激活章节'
  }

  const entries = Object.entries(args)
  if (!entries.length) return '无参数'
  return entries
    .slice(0, 3)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}=${value.join(', ')}`
      if (value && typeof value === 'object') return `${key}=[object]`
      const text = String(value ?? '').trim()
      return `${key}=${text.length > 48 ? `${text.slice(0, 48)}...` : text}`
    })
    .join(' · ')
}

function formatToolResultPreview(content?: string, toolCall?: AssistantToolCall): string {
  const normalized = String(content ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '无返回内容'

  if (toolCall?.toolName === 'knowledge_save_document' && normalized.includes('已落库')) {
    return '已保存到项目知识库，后续生成会自动检索这份知识。'
  }

  if (
    toolCall?.toolName === 'read_chapter'
    && normalized.includes('No chapter_id was provided')
    && normalized.includes('there is no active chapter')
  ) {
    return '当前没有激活章节，所以这次没法直接读取“当前章节”。AI 接下来应先查看章节列表，或改为读取项目中的其他资料。'
  }

  if (
    toolCall?.toolName === 'edit_chapter'
    && (
      normalized.includes('No active chapter is selected')
      || (normalized.includes('No chapter_id was provided') && normalized.includes('there is no active chapter'))
    )
  ) {
    return '当前没有激活章节，所以这次不能生成章节修改提案。请先进入某一章，或先让 AI 找到目标章节。'
  }

  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized
}

function getMessageToolCalls(message: ChatMessage): AssistantToolCall[] {
  if (message.turns?.length) {
    return message.turns.flatMap((turn) => turn.toolCalls)
  }
  return message.toolCalls ?? []
}

function toolScopeLabel(scope: string): string {
  const map: Record<string, string> = {
    worldview: '世界观',
    characters: '角色',
    organizations: '组织',
    organization_memberships: '成员归属',
    relationships: '关系',
    outline: '大纲',
    plot_threads: '剧情线索',
    plotThreads: '剧情线索',
    inspiration: '灵感',
    knowledge: '项目知识',
    available_deconstructions: '公共拆书库',
    deconstruction_library: '拆书知识库',
    reference_works: '参考书',
    chapters: '章节',
    workflow_documents: '工作流文档',
    workflowDocuments: '工作流文档',
    project_constraints: '项目约束',
    projectConstraints: '项目约束'
  }
  return map[scope] ?? scope
}

function describeToolAction(toolCall: AssistantToolCall): string {
  const args = toolCall.args
  const entityType = typeof args.entity_type === 'string' ? args.entity_type : ''
  const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
  const summaryOnly = args.summary_only === true
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const chapterId = typeof args.chapter_id === 'string' ? args.chapter_id.trim() : ''
  const docKey = typeof args.doc_key === 'string' ? args.doc_key.trim() : ''
  const operation = typeof args.operation === 'string' ? args.operation.trim() : ''

  switch (toolCall.toolName) {
    case 'search_project': {
      const scopes = Array.isArray(args.scope)
        ? args.scope.map((item) => toolScopeLabel(String(item))).join('、')
        : ''
      if (query && scopes) return `搜索 ${scopes} 中与“${query}”相关的资料`
      if (query) return `搜索项目中与“${query}”相关的资料`
      return '搜索项目资料'
    }
    case 'read_project_data': {
      if (!entityType) return '查看项目资料目录'
      const label = toolScopeLabel(entityType)
      if (docKey) return `按文档键查看${label}中的 ${docKey}`
      if (entityId) return `精读${label}中的指定条目`
      if (summaryOnly) return `查看${label}的摘要列表`
      return `读取${label}内容`
    }
    case 'read_chapter':
      return chapterId ? '读取指定章节内容' : '读取当前章节内容'
    case 'edit_chapter': {
      const opMap: Record<string, string> = {
        replace: '生成章节替换提案',
        insert: '生成章节插入提案',
        append: '生成章节追加提案'
      }
      return opMap[operation] ?? '生成章节修改提案'
    }
    case 'list_chapters':
      return '查看章节列表'
    case 'knowledge_save_document':
      return '保存知识文档'
    case 'skill_list':
      return '查看 Skills 清单'
    case 'skill_load':
      return '加载相关技能'
    default:
      return toolCall.toolName
  }
}

function toolStatusLabel(toolCall: AssistantToolCall): string {
  if (toolCall.status === 'running') return '执行中'
  if (toolCall.status === 'error') return '失败'
  return '已完成'
}

function toolGroupKey(toolCall: AssistantToolCall): ToolGroup['key'] {
  if (toolCall.toolName === 'search_project' || toolCall.toolName === 'skill_list' || toolCall.toolName === 'skill_load') {
    return 'search'
  }
  if (toolCall.toolName === 'knowledge_save_document' || toolCall.toolName === 'edit_chapter') {
    return 'write'
  }
  return 'read'
}

function groupedToolCalls(message: ChatMessage): ToolGroup[] {
  const groups: ToolGroup[] = []
  const labels: Record<ToolGroup['key'], string> = {
    search: '搜索线索',
    read: '读取资料',
    write: '产出动作'
  }

  for (const toolCall of getMessageToolCalls(message)) {
    const key = toolGroupKey(toolCall)
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup.key === key) {
      lastGroup.items.push(toolCall)
      continue
    }
    groups.push({ key, label: labels[key], items: [toolCall] })
  }

  return groups
}

function normalizeDiffText(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

function escapeDiffPath(value: string): string {
  return value.replace(/\s+/g, '_').replace(/[\\]/g, '/')
}

function createUnifiedPatch(file: GlobalAssistantProposalDiffFile): string {
  const oldLines = file.oldText ? normalizeDiffText(file.oldText).split('\n') : []
  const newLines = file.newText ? normalizeDiffText(file.newText).split('\n') : []
  const oldCount = Math.max(oldLines.length, file.action === 'create' ? 0 : 1)
  const newCount = Math.max(newLines.length, 1)
  const oldPath = file.action === 'create' ? '/dev/null' : `a/${file.path}`
  const newPath = `b/${file.path}`
  const header = [
    `diff --git ${oldPath} ${newPath}`,
    file.action === 'create' ? 'new file mode 100644' : `index ${file.id.slice(0, 7).padEnd(7, '0')}..proposal 100644`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${oldCount} +1,${newCount} @@`
  ]
  const removed = file.action === 'create' ? [] : oldLines.map((line) => `-${line}`)
  const added = newLines.map((line) => `+${line}`)
  return [...header, ...removed, ...added, ''].join('\n')
}

function parseProposalDiffIndex(fileId: string, prefix: string): number {
  const match = fileId.match(new RegExp(`^${prefix}-(\\d+)-`))
  return match ? Number(match[1]) : -1
}

function removeProposalItemAt<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index)
}

export function useGlobalAssistant(options: UseGlobalAssistantOptions = {}) {
  const appStore = useAppStore()
  const message = useMessage()

  const resolveViewLabel = (): string => toValue(options.activeViewLabel) ?? ''

  // 纯展示/输入状态仍按实例隔离，避免 dock + 整页双挂载时互相串扰。
  const composerValue = ref('')
  const activeMode = ref<AssistantMode>('ingest')
  const worldviewTargetMap = ref<Record<string, string>>({})
  const characterTargetMap = ref<Record<string, string>>({})
  const organizationTargetMap = ref<Record<string, string>>({})
  const outlineTargetMap = ref<Record<string, string>>({})
  const isRunningAudit = sharedIsRunningAudit
  const isSending = sharedIsSending
  const isProposalLoading = sharedIsProposalLoading
  let proposalRequestToken = 0

  const modeOptions = GLOBAL_ASSISTANT_MODE_OPTIONS

  const quickActions = computed<Record<AssistantMode, QuickAction[]>>(() => ({
    ingest: [
      { label: '录入大纲', prompt: '我有一份粗糙大纲草稿，请帮我整理成结构化章节节点，并标出关键高潮和转折。\n\n草稿内容：\n' },
      { label: '录入角色', prompt: '我有几名主要角色的草稿设定，请帮我整理成角色卡，并保留待确认的部分。\n\n角色草稿：\n' },
      { label: '录入历史', prompt: '我有一份长篇历史时间线，请帮我拆成结构化历史词条和时间线节点。\n\n历史草稿：\n' }
    ],
    correct: [
      { label: '修正人设', prompt: '纠正：请先复述你理解到的修正点，再指出需要更新的人物卡、世界观或大纲内容。' },
      { label: '调整伏笔', prompt: '请根据现有大纲，把埋得过早的伏笔延后，并说明会影响哪些章节节点。' },
      { label: '补充约束', prompt: '请把我接下来的修正沉淀成后续生成必须遵守的项目级约束。' }
    ],
    audit: [
      { label: '检查 OOC', prompt: '请基于当前人物卡检查最近几章是否有 OOC，并按“问题 -> 证据 -> 最小修法”输出。' },
      { label: '设定冲突', prompt: '请检查当前世界观和大纲中是否存在设定冲突、时间线冲突或规则冲突。' },
      { label: '伏笔回收', prompt: '请检查当前大纲和剧情线索里有哪些伏笔埋设过早、过晚或仍未回收。' }
    ]
  }))

  const currentModeMeta = computed(() => modeOptions.find((item) => item.id === activeMode.value) ?? modeOptions[0])
  const isAuditMode = computed(() => activeMode.value === 'audit')
  const activeSessionId = computed(() => appStore.activeGlobalAssistantSessionId ?? '')
  const assistantStatus = computed(() => {
    if (isRunningAudit.value) return '正在执行项目审计并整理修正提案…'
    if (isSending.value) return '正在思考项目设定…'
    if (isProposalLoading.value) return '正在整理可写回提案…'
    return ''
  })
  const messages = computed(() => appStore.messages)
  const proposal = computed(() => appStore.activeGlobalAssistantSession?.proposal ?? null)
  const lastProposalPrompt = computed(() => appStore.activeGlobalAssistantSession?.lastProposalPrompt ?? '')
  const lastAssistantReply = computed(() => appStore.activeGlobalAssistantSession?.lastAssistantReply ?? '')
  const projectTitle = computed(() => appStore.currentProject?.title ?? '未命名项目')
  const projectGenre = computed(() => appStore.currentProject?.genre ?? '未分类')
  const projectConstraintSummary = computed(() => appStore.projectConstraints.slice(0, 4))

  const assetLinks = computed<
    Array<{ id: string; label: string; panel: PanelName; count: number; icon: typeof Globe2 }>
  >(() => [
    { id: 'world', label: '世界观', panel: 'world', count: appStore.worldviewEntries.length, icon: Globe2 },
    { id: 'characters', label: '角色卡', panel: 'characters', count: appStore.characters.length, icon: Users },
    { id: 'relations', label: '关系', panel: 'relations', count: appStore.characterRelationships.length, icon: Network },
    { id: 'threads', label: '线索', panel: 'threads', count: appStore.plotThreads.length, icon: BookMarked },
    { id: 'project-knowledge', label: '知识', panel: 'project-knowledge', count: appStore.knowledgeDocuments.length, icon: FileCheck2 }
  ])

  const worldviewTargetOptions = computed<SelectOption[]>(() =>
    appStore.worldviewEntries.map((item) => ({ label: item.title, value: item.id }))
  )
  const characterTargetOptions = computed<SelectOption[]>(() =>
    appStore.characters.map((item) => ({ label: item.name, value: item.id }))
  )
  const outlineTargetOptions = computed<SelectOption[]>(() =>
    appStore.outlineItems.map((item) => ({ label: item.title, value: item.id }))
  )

  const hasActionableProposal = computed(() => {
    const current = proposal.value
    if (!current) return false
    return Boolean(
      current.constraintCreates.length ||
      current.worldviewCreates.length ||
      current.worldviewUpdates.length ||
      current.characterCreates.length ||
      current.characterUpdates.length ||
      current.outlineCreates.length ||
      current.outlineUpdates.length ||
      current.notes.length
    )
  })

  /** 最近一条已完成的助手回复（用于「生成提案」提示的锚点）。 */
  const lastAssistantMessage = computed(() => {
    const list = messages.value
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i]
      if (item.role === 'assistant' && item.content.trim() && !item.isError && !item.isCanceled) {
        return item
      }
    }
    return null
  })

  /**
   * 是否在回答下方提示用户「生成提案」：仅当有已完成的助手回复、当前空闲、非审计模式、
   * 尚无可写回提案、且该条回复未被忽略时显示。提案改由用户按需触发，不再每轮自动生成。
   */
  const canSuggestProposal = computed(() => {
    if (isSending.value || isRunningAudit.value || isProposalLoading.value) return false
    if (isAuditMode.value) return false
    if (hasActionableProposal.value) return false
    const last = lastAssistantMessage.value
    if (!last) return false
    return sharedDismissedProposalSuggestionFor.value !== last.id
  })

  function dismissProposalSuggestion(): void {
    const last = lastAssistantMessage.value
    sharedDismissedProposalSuggestionFor.value = last?.id ?? ''
  }

  const sessions = computed(() =>
    [...appStore.globalAssistantSessions].sort((left, right) =>
      (right.updatedAt || '').localeCompare(left.updatedAt || '')
    )
  )

  function clearStreamState(): void {
    sharedStreamId = null
    sharedStreamingMessageId = null
    sharedResolveStream = null
    sharedRejectStream = null
  }

  function finalizeStreamingMessage(payload?: { isError?: boolean; isCanceled?: boolean }): void {
    if (!sharedStreamingMessageId) return
    appStore.finalizeAssistantStreamingMessage(sharedStreamingMessageId, payload)
  }

  function unregisterStreamListener(): void {
    sharedRemoveStreamListener?.()
    sharedRemoveStreamListener = null
  }

  function unregisterStreamListenerIfIdle(): void {
    if (!sharedStreamId && !isSending.value) {
      unregisterStreamListener()
    }
  }

  // 流式事件处理：按 streamId 门控，仅发起本次发送的实例会通过，store 写入只发生一次。
  // 滚动已解耦——由各壳自行 watch messages 处理。
  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== sharedStreamId || !sharedStreamingMessageId) {
      return
    }

    if (payload.type === 'chunk') {
      appStore.updateAssistantMessageContent(sharedStreamingMessageId, (content) => content + payload.delta)
      return
    }

    if (payload.type === 'tool_use_start') {
      appStore.appendAssistantToolCall(sharedStreamingMessageId, {
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        args: payload.args,
        status: 'running'
      })
      return
    }

    if (payload.type === 'tool_result') {
      appStore.updateAssistantToolCall(sharedStreamingMessageId, payload.toolUseId, (toolCall) => ({
        ...toolCall,
        status: payload.isError ? 'error' : 'done',
        result: payload.content,
        isError: payload.isError,
        durationMs: payload.durationMs
      }))
      return
    }

    if (payload.type === 'edit_applied') {
      appStore.appendAssistantEditEvent(sharedStreamingMessageId, {
        chapterId: payload.chapterId,
        editType: payload.editType,
        preview: payload.preview,
        versionId: payload.versionId
      })
      return
    }

    if (payload.type === 'done') {
      const finalText = String(payload.content ?? '').trim()
      if (finalText) {
        appStore.updateAssistantMessageContent(sharedStreamingMessageId, () => finalText, { persistMode: 'final' })
      }
      finalizeStreamingMessage()
      const resolve = sharedResolveStream
      clearStreamState()
      resolve?.(finalText)
      unregisterStreamListenerIfIdle()
      return
    }

    if (payload.type === 'canceled') {
      const fallbackText = String(payload.content ?? '').trim() || '已停止生成'
      appStore.updateAssistantMessageContent(sharedStreamingMessageId, (content) => content.trim() ? content : fallbackText, { persistMode: 'final' })
      finalizeStreamingMessage({ isCanceled: true })
      const reject = sharedRejectStream
      clearStreamState()
      reject?.(new Error('canceled'))
      unregisterStreamListenerIfIdle()
      return
    }

    if (payload.type === 'error') {
      const errorMessage = payload.error || '全局助手生成失败'
      appStore.updateAssistantMessageContent(sharedStreamingMessageId, (content) => content.trim() ? content : `处理失败：${errorMessage}`, { persistMode: 'final' })
      finalizeStreamingMessage({ isError: true })
      const reject = sharedRejectStream
      clearStreamState()
      reject?.(new Error(errorMessage))
      unregisterStreamListenerIfIdle()
    }
  }

  function registerStreamListener(): void {
    if (sharedRemoveStreamListener) return
    sharedRemoveStreamListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  onMounted(() => {
    registerStreamListener()
  })

  onBeforeUnmount(() => {
    unregisterStreamListenerIfIdle()
  })

  function setMode(mode: AssistantMode): void {
    activeMode.value = mode
  }

  function fillQuickAction(action: QuickAction): void {
    composerValue.value = action.prompt
  }

  function openAsset(panel: PanelName): void {
    appStore.setPanel(panel)
  }

  function resolveKnowledgeSaveDestination(toolCall: AssistantToolCall): KnowledgeSaveDestination | null {
    if (toolCall.toolName !== 'knowledge_save_document') return null

    const titleFromArgs = typeof toolCall.args.title === 'string' ? toolCall.args.title.trim() : ''
    const resultText = String(toolCall.result ?? '')
    const titleFromResult = resultText.match(/知识文档：(.+?)（/)?.[1]?.trim() ?? ''
    const title = titleFromArgs || titleFromResult || '新保存的知识文档'
    const document = appStore.knowledgeDocuments.find((item) => item.title === title)

    return {
      label: '项目知识库',
      title,
      documentId: document?.id ?? '',
      canOpen: toolCall.status === 'done'
    }
  }

  function openKnowledgeSaveDestination(toolCall: AssistantToolCall): void {
    const destination = resolveKnowledgeSaveDestination(toolCall)
    if (!destination?.canOpen) return

    appStore.setPanel('project-knowledge')
    if (destination.documentId) {
      appStore.setAssistantFocusTarget('project-knowledge', destination.documentId)
    }
  }

  function clearTargetSelections(): void {
    worldviewTargetMap.value = {}
    characterTargetMap.value = {}
    organizationTargetMap.value = {}
    outlineTargetMap.value = {}
  }

  function clearProposal(): void {
    appStore.updateAssistantSessionProposal({ proposal: null })
    clearTargetSelections()
  }

  function setProposal(nextProposal: GlobalAssistantProposal | null): void {
    appStore.updateAssistantSessionProposal({ proposal: nextProposal })
  }

  function updateSessionProposalState(
    sessionId: string,
    payload: { proposal?: GlobalAssistantProposal | null; lastProposalPrompt?: string; lastAssistantReply?: string }
  ): boolean {
    if (!sessionId || activeSessionId.value !== sessionId) {
      return false
    }
    appStore.updateAssistantSessionProposal(payload)
    return true
  }

  function resetConversationState(): void {
    clearTargetSelections()
  }

  function startNewConversation(): void {
    if (isSending.value || isRunningAudit.value || isProposalLoading.value) {
      message.warning('请等待当前全局助手请求完成')
      return
    }
    appStore.createAssistantSession()
    resetConversationState()
  }

  function switchConversation(sessionId: string): void {
    if (isSending.value || isRunningAudit.value || isProposalLoading.value) {
      message.warning('请等待当前全局助手请求完成')
      return
    }
    appStore.switchAssistantSession(sessionId)
    resetConversationState()
  }

  function deleteConversation(sessionId: string): void {
    if (isSending.value || isRunningAudit.value || isProposalLoading.value) {
      message.warning('请等待当前全局助手请求完成')
      return
    }
    appStore.deleteAssistantSession(sessionId)
    resetConversationState()
    message.success('已删除历史会话')
  }

  function handleNewSession(): void {
    startNewConversation()
  }

  watch(
    () => activeSessionId.value,
    () => {
      clearTargetSelections()
    }
  )

  function worldviewUpdateKey(index: number, matchTitle: string): string {
    return `${index}:${matchTitle}`
  }

  function characterUpdateKey(index: number, matchName: string): string {
    return `${index}:${matchName}`
  }

  function outlineUpdateKey(index: number, matchTitle: string): string {
    return `${index}:${matchTitle}`
  }

  function organizationUpdateKey(index: number, matchName: string): string {
    return `${index}:${matchName}`
  }

  function findWorldviewByTitle(title: string) {
    const normalized = title.trim()
    return appStore.worldviewEntries.find((item) => item.title.trim() === normalized) ?? null
  }

  function findCharacterByName(name: string) {
    const normalized = name.trim()
    return appStore.characters.find((item) => item.name.trim() === normalized) ?? null
  }

  function findOutlineByTitle(title: string) {
    const normalized = title.trim()
    return appStore.outlineItems.find((item) => item.title.trim() === normalized) ?? null
  }

  function findOrganizationByName(name: string) {
    const normalized = name.trim()
    return appStore.organizations.find((item) => item.name.trim() === normalized) ?? null
  }

  function resolveWorldviewTargetId(item: GlobalAssistantProposal['worldviewUpdates'][number], index: number): string {
    return findWorldviewByTitle(item.matchTitle)?.id ?? worldviewTargetMap.value[worldviewUpdateKey(index, item.matchTitle)] ?? ''
  }

  function resolveCharacterTargetId(item: GlobalAssistantProposal['characterUpdates'][number], index: number): string {
    return findCharacterByName(item.matchName)?.id ?? characterTargetMap.value[characterUpdateKey(index, item.matchName)] ?? ''
  }

  function resolveOrganizationTargetId(item: GlobalAssistantProposal['organizationUpdates'][number], index: number): string {
    return findOrganizationByName(item.matchName)?.id ?? organizationTargetMap.value[organizationUpdateKey(index, item.matchName)] ?? ''
  }

  function resolveOutlineTargetId(item: GlobalAssistantProposal['outlineUpdates'][number], index: number): string {
    return findOutlineByTitle(item.matchTitle)?.id ?? outlineTargetMap.value[outlineUpdateKey(index, item.matchTitle)] ?? ''
  }

  function resolveWorldviewTarget(item: GlobalAssistantProposal['worldviewUpdates'][number], index: number) {
    const targetId = resolveWorldviewTargetId(item, index)
    return appStore.worldviewEntries.find((entry) => entry.id === targetId) ?? null
  }

  function resolveCharacterTarget(item: GlobalAssistantProposal['characterUpdates'][number], index: number) {
    const targetId = resolveCharacterTargetId(item, index)
    return appStore.characters.find((entry) => entry.id === targetId) ?? null
  }

  function resolveOutlineTarget(item: GlobalAssistantProposal['outlineUpdates'][number], index: number) {
    const targetId = resolveOutlineTargetId(item, index)
    return appStore.outlineItems.find((entry) => entry.id === targetId) ?? null
  }

  function resolveOrganizationTarget(item: GlobalAssistantProposal['organizationUpdates'][number], index: number) {
    const targetId = resolveOrganizationTargetId(item, index)
    return appStore.organizations.find((entry) => entry.id === targetId) ?? null
  }

  function mergeLongTextForIngest(currentValue: string | undefined, incomingValue: string | undefined): string {
    const currentText = String(currentValue ?? '').trim()
    const incomingText = String(incomingValue ?? '').trim()
    if (!incomingText) return currentText
    if (!currentText) return incomingText
    if (currentText.includes(incomingText)) return currentText
    if (incomingText.includes(currentText)) return incomingText
    return `${currentText}\n\n${incomingText}`
  }

  function trimProposal(current: GlobalAssistantProposal): GlobalAssistantProposal | null {
    const next: GlobalAssistantProposal = {
      summary: current.summary,
      constraintCreates: current.constraintCreates,
      worldviewCreates: current.worldviewCreates,
      worldviewUpdates: current.worldviewUpdates,
      characterCreates: current.characterCreates,
      characterUpdates: current.characterUpdates,
      organizationCreates: current.organizationCreates,
      organizationUpdates: current.organizationUpdates,
      outlineCreates: current.outlineCreates,
      outlineUpdates: current.outlineUpdates,
      notes: current.notes
    }

    return (
      next.constraintCreates.length ||
      next.worldviewCreates.length ||
      next.worldviewUpdates.length ||
      next.characterCreates.length ||
      next.characterUpdates.length ||
      next.organizationCreates.length ||
      next.organizationUpdates.length ||
      next.outlineCreates.length ||
      next.outlineUpdates.length ||
      next.notes.length
    ) ? next : null
  }

  function hasWorldviewApplyTarget(): boolean {
    const current = proposal.value
    if (!current) return false
    return current.worldviewCreates.length > 0 || current.worldviewUpdates.some((item, index) => Boolean(resolveWorldviewTarget(item, index)))
  }

  function hasCharacterApplyTarget(): boolean {
    const current = proposal.value
    if (!current) return false
    return current.characterCreates.length > 0 || current.characterUpdates.some((item, index) => Boolean(resolveCharacterTarget(item, index)))
  }

  function hasOutlineApplyTarget(): boolean {
    const current = proposal.value
    if (!current) return false
    return current.outlineCreates.length > 0 || current.outlineUpdates.some((item, index) => Boolean(resolveOutlineTarget(item, index)))
  }

  function hasOrganizationApplyTarget(): boolean {
    const current = proposal.value
    if (!current) return false
    return current.organizationCreates.length > 0 || current.organizationUpdates.some((item, index) => Boolean(resolveOrganizationTarget(item, index)))
  }

  const proposalDiffFiles = computed<GlobalAssistantProposalDiffFile[]>(() => {
    const current = proposal.value
    if (!current) return []

    const files: GlobalAssistantProposalDiffFile[] = []

    for (const [index, item] of current.constraintCreates.entries()) {
      const alreadyExists = appStore.projectConstraints.some(
        (c) => c.title.trim() === item.title.trim()
      )
      files.push({
        id: `constraint-create-${index}-${item.title}`,
        title: item.title,
        path: `constraints/${escapeDiffPath(item.title)}.rule`,
        kind: 'constraint',
        action: 'create',
        oldText: '',
        newText: [
          `标题：${item.title}`,
          `范围：${item.scope || 'project'}`,
          `权重：${item.weight ?? 'core'}`,
          `锁定：${item.locked ?? true}`,
          `内容：${item.content}`,
          item.keywords.length ? `关键词：${item.keywords.join('、')}` : ''
        ].filter(Boolean).join('\n'),
        reason: alreadyExists ? `同名约束「${item.title}」已存在，请忽略或手动更新` : item.reason,
        canApply: !alreadyExists
      })
    }

    for (const [index, item] of current.worldviewCreates.entries()) {
      const alreadyExists = appStore.worldviewEntries.some(
        (w) => w.title.trim() === item.title.trim()
      )
      files.push({
        id: `worldview-create-${index}-${item.title}`,
        title: item.title,
        path: `worldview/${escapeDiffPath(item.title)}.entry`,
        kind: 'worldview',
        action: 'create',
        oldText: '',
        newText: [`分类：${item.type}`, `标题：${item.title}`, `内容：${item.content}`].join('\n'),
        reason: alreadyExists ? `同名世界观条目「${item.title}」已存在，请忽略或手动更新` : '新增世界观条目',
        canApply: !alreadyExists
      })
    }

    for (const [index, item] of current.worldviewUpdates.entries()) {
      const target = resolveWorldviewTarget(item, index)
      const mergedContent = mergeLongTextForIngest(target?.content, item.content)
      files.push({
        id: `worldview-update-${index}-${item.matchTitle}`,
        title: item.title || item.matchTitle,
        path: `worldview/${escapeDiffPath(item.matchTitle)}.entry`,
        kind: 'worldview',
        action: 'update',
        oldText: target
          ? [`分类：${target.type}`, `标题：${target.title}`, `内容：${target.content}`].join('\n')
          : `未匹配到目标：${item.matchTitle}`,
        newText: [
          `分类：${item.type || target?.type || ''}`,
          `标题：${item.title || target?.title || item.matchTitle}`,
          `内容：${mergedContent}`
        ].join('\n'),
        reason: item.reason,
        canApply: Boolean(target)
      })
    }

    for (const [index, item] of current.characterCreates.entries()) {
      const alreadyExists = appStore.characters.some(
        (c) => c.name.trim() === item.name.trim()
      )
      files.push({
        id: `character-create-${index}-${item.name}`,
        title: item.name,
        path: `characters/${escapeDiffPath(item.name)}.card`,
        kind: 'character',
        action: 'create',
        oldText: '',
        newText: [
          `姓名：${item.name}`,
          `定位：${item.role}`,
          `简介：${item.description}`,
          item.tags.length ? `标签：${item.tags.join('、')}` : ''
        ].filter(Boolean).join('\n'),
        reason: alreadyExists ? `同名角色「${item.name}」已存在，请忽略或手动更新` : '新增人物卡',
        canApply: !alreadyExists
      })
    }

    for (const [index, item] of current.characterUpdates.entries()) {
      const target = resolveCharacterTarget(item, index)
      const mergedDescription = mergeLongTextForIngest(target?.description, item.description)
      files.push({
        id: `character-update-${index}-${item.matchName}`,
        title: item.name || item.matchName,
        path: `characters/${escapeDiffPath(item.matchName)}.card`,
        kind: 'character',
        action: 'update',
        oldText: target
          ? [
              `姓名：${target.name}`,
              `定位：${target.role}`,
              `简介：${target.description}`,
              target.tags.length ? `标签：${target.tags.map((tag) => tag.label).join('、')}` : ''
            ].filter(Boolean).join('\n')
          : `未匹配到目标：${item.matchName}`,
        newText: [
          `姓名：${item.name || target?.name || item.matchName}`,
          `定位：${item.role || target?.role || ''}`,
          `简介：${mergedDescription}`,
          item.tags?.length ? `标签：${item.tags.join('、')}` : (target?.tags.length ? `标签：${target.tags.map((tag) => tag.label).join('、')}` : '')
        ].filter(Boolean).join('\n'),
        reason: item.reason,
        canApply: Boolean(target)
      })
    }

    for (const [index, item] of current.outlineCreates.entries()) {
      const alreadyExists = appStore.outlineItems.some(
        (o) => o.title.trim() === item.title.trim()
      )
      files.push({
        id: `outline-create-${index}-${item.title}`,
        title: item.title,
        path: `outline/${escapeDiffPath(item.title)}.node`,
        kind: 'outline',
        action: 'create',
        oldText: '',
        newText: [
          `标题：${item.title}`,
          `目标字数：${item.wordTarget}`,
          `冲突：${item.conflict}`,
          `摘要：${item.summary}`
        ].filter(Boolean).join('\n'),
        reason: alreadyExists ? `同名大纲节点「${item.title}」已存在，请忽略或手动更新` : '新增大纲节点',
        canApply: !alreadyExists
      })
    }

    for (const [index, item] of current.outlineUpdates.entries()) {
      const target = resolveOutlineTarget(item, index)
      const mergedSummary = mergeLongTextForIngest(target?.summary, item.summary)
      files.push({
        id: `outline-update-${index}-${item.matchTitle}`,
        title: item.title || item.matchTitle,
        path: `outline/${escapeDiffPath(item.matchTitle)}.node`,
        kind: 'outline',
        action: 'update',
        oldText: target
          ? [
              `标题：${target.title}`,
              `目标字数：${target.wordTarget}`,
              `冲突：${target.conflict}`,
              `摘要：${target.summary}`
            ].filter(Boolean).join('\n')
          : `未匹配到目标：${item.matchTitle}`,
        newText: [
          `标题：${item.title || target?.title || item.matchTitle}`,
          `目标字数：${item.wordTarget || target?.wordTarget || ''}`,
          `冲突：${item.conflict || target?.conflict || ''}`,
          `摘要：${mergedSummary}`
        ].filter(Boolean).join('\n'),
        reason: item.reason,
        canApply: Boolean(target)
      })
    }

    for (const [index, item] of current.organizationCreates.entries()) {
      const alreadyExists = appStore.organizations.some(
        (o) => o.name.trim() === item.name.trim()
      )
      files.push({
        id: `organization-create-${index}-${item.name}`,
        title: item.name,
        path: `organizations/${escapeDiffPath(item.name)}.org`,
        kind: 'organization',
        action: 'create',
        oldText: '',
        newText: [
          `名称：${item.name}`,
          `类型：${item.type}`,
          `描述：${item.description}`,
          item.motto ? `信条：${item.motto}` : ''
        ].filter(Boolean).join('\n'),
        reason: alreadyExists ? `同名组织「${item.name}」已存在，请忽略或手动更新` : '新增组织',
        canApply: !alreadyExists
      })
    }

    for (const [index, item] of current.organizationUpdates.entries()) {
      const target = resolveOrganizationTarget(item, index)
      const mergedDescription = mergeLongTextForIngest(target?.description, item.description)
      files.push({
        id: `organization-update-${index}-${item.matchName}`,
        title: item.name || item.matchName,
        path: `organizations/${escapeDiffPath(item.matchName)}.org`,
        kind: 'organization',
        action: 'update',
        oldText: target
          ? [
              `名称：${target.name}`,
              `类型：${target.type}`,
              `描述：${target.description}`,
              target.motto ? `信条：${target.motto}` : ''
            ].filter(Boolean).join('\n')
          : `未匹配到目标：${item.matchName}`,
        newText: [
          `名称：${item.name || target?.name || item.matchName}`,
          `类型：${item.type || target?.type || ''}`,
          `描述：${mergedDescription}`,
          (item.motto || target?.motto) ? `信条：${item.motto || target?.motto || ''}` : ''
        ].filter(Boolean).join('\n'),
        reason: item.reason,
        canApply: Boolean(target)
      })
    }

    for (const [index, note] of current.notes.entries()) {
      files.push({
        id: `note-${index}`,
        title: `提醒 ${index + 1}`,
        path: `notes/proposal-${index + 1}.md`,
        kind: 'note',
        action: 'note',
        oldText: '',
        newText: note,
        reason: '需要人工确认',
        canApply: false
      })
    }

    return files
  })

  const proposalDiffPatch = computed(() =>
    proposalDiffFiles.value.map((file) => createUnifiedPatch(file)).join('\n')
  )

  const proposalDiffStats = computed(() => {
    const files = proposalDiffFiles.value
    return {
      total: files.length,
      creatable: files.filter((file) => file.action === 'create').length,
      updatable: files.filter((file) => file.action === 'update').length,
      blocked: files.filter((file) => !file.canApply).length
    }
  })

  async function shouldGenerateProposal(userPrompt: string, assistantReply: string): Promise<boolean> {
    const project = appStore.currentProject
    if (!project) return false

    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'assistant-intent',
      settings: appStore.appSettings,
      context: {
        projectTitle: project.title,
        projectGenre: project.genre,
        chapterTitle: '',
        chapterSummary: '',
        selectedText: '',
        quickAction: `global-assistant:${activeMode.value}`,
        userPrompt: `${userPrompt}\n\n助手回复：${assistantReply}`
      }
    }))

    if (!response.success || !response.result) return false
    const intent = (response.result as { intent?: ProposalIntent }).intent
    return intent === 'proposal'
  }

  async function generateProposal(userPrompt: string, assistantReply: string, sessionId = activeSessionId.value): Promise<void> {
    const project = appStore.currentProject
    const normalizedPrompt = userPrompt.trim()
    if (!project || !normalizedPrompt || !sessionId) return
    if (isProposalLoading.value) return

    const requestToken = ++proposalRequestToken
    isProposalLoading.value = true

    try {
      if (!updateSessionProposalState(sessionId, {
        lastProposalPrompt: normalizedPrompt,
        lastAssistantReply: assistantReply
      })) {
        return
      }

      const response = await window.characterArc.generateAi(toIpcPayload({
        task: 'global-assistant-proposal',
        clientKey: PROPOSAL_TASK_KEY,
        clientTaskId: appStore.getClientTaskId(),
        settings: appStore.appSettings,
        context: {
          projectId: project.id,
          projectTitle: project.title,
          projectGenre: project.genre,
          writingStyleLabel: project.writingStylePresetId,
          writingStylePrompt: project.writingStylePrompt,
          assistantMode: activeMode.value,
          userPrompt: normalizedPrompt,
          assistantReply,
          worldviewEntries: appStore.worldviewEntries.slice(0, 40),
          characters: appStore.characters.slice(0, 40),
          organizations: appStore.organizations.slice(0, 24),
          characterRelationships: appStore.characterRelationships.slice(0, 60),
          inspirationEntries: appStore.inspirationEntries.slice(0, 30),
          outlineItems: appStore.outlineItems.slice(0, 80),
          workflowDocuments: appStore.workflowDocuments,
          knowledgeDocuments: appStore.knowledgeDocuments.slice(0, 30),
          projectConstraints: appStore.projectConstraints.slice(0, 24),
          projectSkills: project.projectSkills
        }
      }))

      if (!response.success || !response.result) {
        throw new Error(response.error ?? '写回提案生成失败')
      }

      if (requestToken !== proposalRequestToken) return

      clearTargetSelections()
      updateSessionProposalState(sessionId, {
        proposal: trimProposal(response.result as GlobalAssistantProposal)
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '写回提案生成失败'
      message.error(errorMessage)
    } finally {
      if (requestToken === proposalRequestToken) {
        isProposalLoading.value = false
      }
    }
  }

  async function regenerateProposal(): Promise<void> {
    const fallbackUser = [...appStore.messages].reverse().find((item) => item.role === 'user')?.content ?? ''
    const fallbackAssistant = [...appStore.messages].reverse().find((item) => item.role === 'assistant')?.content ?? ''
    await generateProposal(lastProposalPrompt.value || fallbackUser, lastAssistantReply.value || fallbackAssistant, activeSessionId.value)
  }

  /** 用户点击回答下方的「生成提案」提示：先收起提示，再按当前对话生成提案。 */
  async function generateProposalFromSuggestion(): Promise<void> {
    dismissProposalSuggestion()
    await regenerateProposal()
  }

  function applyConstraintProposal(): void {
    const current = proposal.value
    if (!current) return

    let appliedCount = 0
    for (const item of current.constraintCreates) {
      appStore.upsertProjectConstraint({
        title: item.title,
        content: item.content,
        summary: item.reason || item.content,
        keywords: item.keywords,
        scope: item.scope,
        weight: item.weight ?? 'core',
        locked: item.locked ?? true
      })
      appliedCount += 1
    }

    setProposal(trimProposal({ ...current, constraintCreates: [] }))

    if (appliedCount > 0) {
      message.success(`已写回 ${appliedCount} 条项目约束`)
    } else {
      message.warning('这组约束提案暂时没有可写回内容')
    }
  }

  function applyWorldviewProposal(): void {
    const current = proposal.value
    if (!current) return

    let appliedCount = 0
    const appliedTitles: string[] = []

    for (const item of current.worldviewCreates) {
      appStore.createWorldviewEntry({ type: item.type, title: item.title, content: item.content })
      appliedCount += 1
      appliedTitles.push(item.title)
    }

    for (const [index, item] of current.worldviewUpdates.entries()) {
      const target = resolveWorldviewTarget(item, index)
      if (!target) continue
      appStore.updateWorldviewEntry(target.id, {
        type: item.type,
        title: item.title,
        content: mergeLongTextForIngest(target.content, item.content)
      })
      appliedCount += 1
      appliedTitles.push(item.title || target.title)
    }

    worldviewTargetMap.value = {}
    setProposal(trimProposal({ ...current, worldviewCreates: [], worldviewUpdates: [] }))

    if (appliedCount > 0) {
      const preview = appliedTitles.slice(0, 3).join('、')
      const suffix = appliedTitles.length > 3 ? ` 等 ${appliedTitles.length} 条` : ''
      message.success(`已写回世界观：${preview}${suffix}`)
    } else {
      message.warning('这组世界观提案暂时没有可匹配的写回目标')
    }
  }

  function applyCharacterProposal(): void {
    const current = proposal.value
    if (!current) return

    let appliedCount = 0
    const appliedNames: string[] = []

    for (const item of current.characterCreates) {
      appStore.createCharacter({
        name: item.name,
        role: item.role,
        description: item.description,
        tags: item.tags.map((label) => ({ label }))
      })
      appliedCount += 1
      appliedNames.push(item.name)
    }

    for (const [index, item] of current.characterUpdates.entries()) {
      const target = resolveCharacterTarget(item, index)
      if (!target) continue
      appStore.updateCharacter(target.id, {
        name: item.name,
        role: item.role,
        description: mergeLongTextForIngest(target.description, item.description),
        tags: item.tags?.map((label) => ({ label }))
      })
      appliedCount += 1
      appliedNames.push(item.name || target.name)
    }

    characterTargetMap.value = {}
    setProposal(trimProposal({ ...current, characterCreates: [], characterUpdates: [] }))

    if (appliedCount > 0) {
      const preview = appliedNames.slice(0, 3).join('、')
      const suffix = appliedNames.length > 3 ? ` 等 ${appliedNames.length} 条` : ''
      message.success(`已写回人物：${preview}${suffix}`)
    } else {
      message.warning('这组人物提案暂时没有可匹配的写回目标')
    }
  }

  function applyOutlineProposal(): void {
    const current = proposal.value
    if (!current) return

    let appliedCount = 0
    const appliedTitles: string[] = []

    for (const item of current.outlineCreates) {
      appStore.createOutlineItem({
        title: item.title,
        wordTarget: item.wordTarget,
        conflict: item.conflict,
        summary: item.summary,
        status: 'planned'
      })
      appliedCount += 1
      appliedTitles.push(item.title)
    }

    for (const [index, item] of current.outlineUpdates.entries()) {
      const target = resolveOutlineTarget(item, index)
      if (!target) continue
      appStore.updateOutlineItem(target.id, {
        title: item.title,
        wordTarget: item.wordTarget,
        conflict: item.conflict,
        summary: mergeLongTextForIngest(target.summary, item.summary)
      })
      appliedCount += 1
      appliedTitles.push(item.title || target.title)
    }

    outlineTargetMap.value = {}
    setProposal(trimProposal({ ...current, outlineCreates: [], outlineUpdates: [] }))

    if (appliedCount > 0) {
      const preview = appliedTitles.slice(0, 3).join('、')
      const suffix = appliedTitles.length > 3 ? ` 等 ${appliedTitles.length} 条` : ''
      message.success(`已写回大纲：${preview}${suffix}`)
    } else {
      message.warning('这组大纲提案暂时没有可匹配的写回目标')
    }
  }

  function applyOrganizationProposal(): void {
    const current = proposal.value
    if (!current) return

    let appliedCount = 0
    const appliedNames: string[] = []

    for (const item of current.organizationCreates) {
      appStore.createOrganization({
        name: item.name,
        type: item.type,
        description: item.description,
        motto: item.motto ?? ''
      })
      appliedCount += 1
      appliedNames.push(item.name)
    }

    for (const [index, item] of current.organizationUpdates.entries()) {
      const target = resolveOrganizationTarget(item, index)
      if (!target) continue
      appStore.updateOrganization(target.id, {
        name: item.name,
        type: item.type,
        description: mergeLongTextForIngest(target.description, item.description),
        motto: item.motto
      })
      appliedCount += 1
      appliedNames.push(item.name || target.name)
    }

    organizationTargetMap.value = {}
    setProposal(trimProposal({ ...current, organizationCreates: [], organizationUpdates: [] }))

    if (appliedCount > 0) {
      const preview = appliedNames.slice(0, 3).join('、')
      const suffix = appliedNames.length > 3 ? ` 等 ${appliedNames.length} 条` : ''
      message.success(`已写回组织：${preview}${suffix}`)
    } else {
      message.warning('这组组织提案暂时没有可匹配的写回目标')
    }
  }

  function applyProposalDiffFile(fileId: string): boolean {
    const current = proposal.value
    const file = proposalDiffFiles.value.find((item) => item.id === fileId)
    if (!current || !file) return false

    if (!file.canApply) {
      message.warning('这条提案还不能写回，请先匹配目标或人工处理')
      return false
    }

    if (file.kind === 'constraint' && file.action === 'create') {
      const index = parseProposalDiffIndex(file.id, 'constraint-create')
      const item = current.constraintCreates[index]
      if (!item) return false
      appStore.upsertProjectConstraint({
        title: item.title,
        content: item.content,
        summary: item.reason || item.content,
        keywords: item.keywords,
        scope: item.scope,
        weight: item.weight ?? 'core',
        locked: item.locked ?? true
      })
      setProposal(trimProposal({
        ...current,
        constraintCreates: removeProposalItemAt(current.constraintCreates, index)
      }))
      message.success(`已写回：${item.title}`)
      return true
    }

    if (file.kind === 'worldview' && file.action === 'create') {
      const index = parseProposalDiffIndex(file.id, 'worldview-create')
      const item = current.worldviewCreates[index]
      if (!item) return false
      appStore.createWorldviewEntry({ type: item.type, title: item.title, content: item.content })
      setProposal(trimProposal({
        ...current,
        worldviewCreates: removeProposalItemAt(current.worldviewCreates, index)
      }))
      message.success(`已写回：${item.title}`)
      return true
    }

    if (file.kind === 'worldview' && file.action === 'update') {
      const index = parseProposalDiffIndex(file.id, 'worldview-update')
      const item = current.worldviewUpdates[index]
      const target = item ? resolveWorldviewTarget(item, index) : null
      if (!item || !target) return false
      appStore.updateWorldviewEntry(target.id, {
        type: item.type,
        title: item.title,
        content: mergeLongTextForIngest(target.content, item.content)
      })
      const { [worldviewUpdateKey(index, item.matchTitle)]: _removed, ...remainingTargets } = worldviewTargetMap.value
      worldviewTargetMap.value = remainingTargets
      setProposal(trimProposal({
        ...current,
        worldviewUpdates: removeProposalItemAt(current.worldviewUpdates, index)
      }))
      message.success(`已写回：${item.title || target.title}`)
      return true
    }

    if (file.kind === 'character' && file.action === 'create') {
      const index = parseProposalDiffIndex(file.id, 'character-create')
      const item = current.characterCreates[index]
      if (!item) return false
      appStore.createCharacter({
        name: item.name,
        role: item.role,
        description: item.description,
        tags: item.tags.map((label) => ({ label }))
      })
      setProposal(trimProposal({
        ...current,
        characterCreates: removeProposalItemAt(current.characterCreates, index)
      }))
      message.success(`已写回：${item.name}`)
      return true
    }

    if (file.kind === 'character' && file.action === 'update') {
      const index = parseProposalDiffIndex(file.id, 'character-update')
      const item = current.characterUpdates[index]
      const target = item ? resolveCharacterTarget(item, index) : null
      if (!item || !target) return false
      appStore.updateCharacter(target.id, {
        name: item.name,
        role: item.role,
        description: mergeLongTextForIngest(target.description, item.description),
        tags: item.tags?.map((label) => ({ label }))
      })
      const { [characterUpdateKey(index, item.matchName)]: _removed, ...remainingTargets } = characterTargetMap.value
      characterTargetMap.value = remainingTargets
      setProposal(trimProposal({
        ...current,
        characterUpdates: removeProposalItemAt(current.characterUpdates, index)
      }))
      message.success(`已写回：${item.name || target.name}`)
      return true
    }

    if (file.kind === 'outline' && file.action === 'create') {
      const index = parseProposalDiffIndex(file.id, 'outline-create')
      const item = current.outlineCreates[index]
      if (!item) return false
      appStore.createOutlineItem({
        title: item.title,
        wordTarget: item.wordTarget,
        conflict: item.conflict,
        summary: item.summary,
        status: 'planned'
      })
      setProposal(trimProposal({
        ...current,
        outlineCreates: removeProposalItemAt(current.outlineCreates, index)
      }))
      message.success(`已写回：${item.title}`)
      return true
    }

    if (file.kind === 'outline' && file.action === 'update') {
      const index = parseProposalDiffIndex(file.id, 'outline-update')
      const item = current.outlineUpdates[index]
      const target = item ? resolveOutlineTarget(item, index) : null
      if (!item || !target) return false
      appStore.updateOutlineItem(target.id, {
        title: item.title,
        wordTarget: item.wordTarget,
        conflict: item.conflict,
        summary: mergeLongTextForIngest(target.summary, item.summary)
      })
      const { [outlineUpdateKey(index, item.matchTitle)]: _removed, ...remainingTargets } = outlineTargetMap.value
      outlineTargetMap.value = remainingTargets
      setProposal(trimProposal({
        ...current,
        outlineUpdates: removeProposalItemAt(current.outlineUpdates, index)
      }))
      message.success(`已写回：${item.title || target.title}`)
      return true
    }

    if (file.kind === 'organization' && file.action === 'create') {
      const index = parseProposalDiffIndex(file.id, 'organization-create')
      const item = current.organizationCreates[index]
      if (!item) return false
      appStore.createOrganization({
        name: item.name,
        type: item.type,
        description: item.description,
        motto: item.motto ?? ''
      })
      setProposal(trimProposal({
        ...current,
        organizationCreates: removeProposalItemAt(current.organizationCreates, index)
      }))
      message.success(`已写回：${item.name}`)
      return true
    }

    if (file.kind === 'organization' && file.action === 'update') {
      const index = parseProposalDiffIndex(file.id, 'organization-update')
      const item = current.organizationUpdates[index]
      const target = item ? resolveOrganizationTarget(item, index) : null
      if (!item || !target) return false
      appStore.updateOrganization(target.id, {
        name: item.name,
        type: item.type,
        description: mergeLongTextForIngest(target.description, item.description),
        motto: item.motto
      })
      const { [organizationUpdateKey(index, item.matchName)]: _removed, ...remainingTargets } = organizationTargetMap.value
      organizationTargetMap.value = remainingTargets
      setProposal(trimProposal({
        ...current,
        organizationUpdates: removeProposalItemAt(current.organizationUpdates, index)
      }))
      message.success(`已写回：${item.name || target.name}`)
      return true
    }

    return false
  }

  function applyAllProposal(): void {
    if (!proposal.value) return
    if (proposal.value.constraintCreates.length) applyConstraintProposal()
    if (hasWorldviewApplyTarget()) applyWorldviewProposal()
    if (proposal.value && hasCharacterApplyTarget()) applyCharacterProposal()
    if (proposal.value && hasOrganizationApplyTarget()) applyOrganizationProposal()
    if (proposal.value && hasOutlineApplyTarget()) applyOutlineProposal()
    if (proposal.value?.notes.length) {
      setProposal(trimProposal({ ...proposal.value, notes: [] }))
    }
  }

  async function runAuditFromAssistant(promptOverride?: string): Promise<void> {
    const project = appStore.currentProject
    if (!project || isRunningAudit.value) return

    isRunningAudit.value = true
    const currentChapterIndex = appStore.chapters.length

    try {
      const response = await window.characterArc.generateAi(toIpcPayload({
        task: 'story-deep-audit',
        settings: appStore.appSettings,
        context: {
          projectId: project.id,
          projectTitle: project.title,
          projectGenre: project.genre,
          currentChapterIndex,
          userPrompt: promptOverride || composerValue.value.trim() || '请基于当前项目设定与章节状态执行一次一致性审计。',
          projectSkills: project.projectSkills
        }
      }))

      if (!response.success) {
        throw new Error(response.error ?? '审计失败')
      }

      const reportContent = String((response.result as { content?: string })?.content ?? '').trim()
      if (!reportContent) {
        throw new Error('审计结果为空')
      }

      const now = new Date().toISOString()
      const title = `一致性审计报告 · 第 ${currentChapterIndex} 章节点`
      appStore.mergeKnowledgeDocuments([{
        id: `knowledge-story-audit-${Date.now()}`,
        title,
        sourceType: 'canon-fact',
        sourceLabel: 'story-deep-audit',
        content: reportContent,
        summary: reportContent.slice(0, 220),
        keywords: ['一致性审计', '设定冲突', '角色审计', project.genre].map((item) => String(item).trim()).filter(Boolean),
        metadata: { auditTargetChapterIndex: currentChapterIndex, generatedAt: now },
        createdAt: now,
        updatedAt: now
      }])

      appStore.pushAssistantMessage(reportContent)
      const proposalPrompt = promptOverride || composerValue.value.trim() || '请根据审计报告生成修正提案。'
      appStore.updateAssistantSessionProposal({ lastProposalPrompt: proposalPrompt, lastAssistantReply: reportContent })
      await generateProposal(proposalPrompt, reportContent)
      message.success('审计完成，报告已归档并生成修正提案')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '审计失败'
      message.error(errorMessage)
    } finally {
      isRunningAudit.value = false
    }
  }

  async function sendPrompt(): Promise<void> {
    const prompt = composerValue.value.trim()
    const project = appStore.currentProject
    const sessionId = activeSessionId.value

    if (!project) {
      message.warning('请先打开一个项目再使用全局助手')
      return
    }

    if (!prompt || !sessionId || isSending.value || isRunningAudit.value || isProposalLoading.value) {
      return
    }

    if (isAuditMode.value) {
      composerValue.value = ''
      appStore.pushUserMessage(prompt)
      await runAuditFromAssistant(prompt)
      return
    }

    composerValue.value = ''
    appStore.pushUserMessage(prompt)
    const assistantMessageId = appStore.pushStreamingAssistantMessage()
    sharedStreamingMessageId = assistantMessageId
    isSending.value = true
    registerStreamListener()

    try {
      const response = await window.characterArc.startAiAgentStream(toIpcPayload({
        task: 'global-assistant',
        clientKey: AI_TASK_KEY,
        clientTaskId: appStore.getClientTaskId(),
        settings: appStore.appSettings,
        context: {
          projectId: project.id,
          projectTitle: project.title,
          projectGenre: project.genre,
          projectWordCount: project.wordCount,
          writingStyleLabel: project.writingStylePresetId,
          writingStylePrompt: project.writingStylePrompt,
          assistantMode: activeMode.value,
          currentPanelLabel: resolveViewLabel(),
          userPrompt: prompt,
          enabledContextModules: ['worldview', 'characters', 'organizations', 'relationships', 'outline', 'plotThreads', 'inspiration', 'knowledge', 'deconstructionLibrary', 'workflowDocuments', 'projectConstraints'],
          recentMessages: appStore.messages.slice(0, -2).slice(-8).map((item) => ({ role: item.role, content: item.content })),
          worldviewEntries: appStore.worldviewEntries.slice(0, 24),
          characters: appStore.characters.slice(0, 24),
          organizations: appStore.organizations.slice(0, 16),
          characterRelationships: appStore.characterRelationships.slice(0, 36),
          inspirationEntries: appStore.inspirationEntries.slice(0, 16),
          outlineItems: appStore.outlineItems.slice(0, 48),
          plotThreads: appStore.plotThreads.slice(0, 20),
          workflowDocuments: appStore.workflowDocuments.slice(0, 6).map((item) => ({ title: item.title, content: item.content.slice(0, 1200) })),
          knowledgeDocuments: appStore.knowledgeDocuments.slice(0, 24).map((item) => ({ title: item.title, summary: item.summary, content: item.content.slice(0, 800), sourceLabel: item.sourceLabel, metadata: item.metadata })),
          projectConstraints: appStore.projectConstraints.slice(0, 24).map((item) => ({ title: item.title, content: item.content, summary: item.summary, keywords: item.keywords, metadata: item.metadata })),
          projectSkills: project.projectSkills
        }
      }))

      const sid = (response.result as { streamId?: string } | undefined)?.streamId
      if (!response.success || !sid) {
        throw new Error(response.error ?? '全局助手流式生成启动失败')
      }
      sharedStreamId = sid

      const assistantText = await new Promise<string>((resolve, reject) => {
        sharedResolveStream = resolve
        sharedRejectStream = reject
      })
      const normalizedAssistantText = assistantText.trim() || '我暂时没有整理出可靠结论，建议你补充更多上下文后重试。'
      appStore.updateAssistantMessageContent(assistantMessageId, () => normalizedAssistantText, { persistMode: 'final' })
      // 写回提案现在由 agent loop 内的 propose_* 工具直接产出（经 ai-run-event 合并进 session.proposal），
      // 不再在此处另起一次意图猜测 + 提案生成调用。手动「重新生成提案」按钮(regenerateProposal)与审计流仍可用。
    } catch (error) {
      const isCanceled = error instanceof Error && error.message === 'canceled'
      if (isCanceled) {
        return
      }
      const errorMessage = error instanceof Error ? error.message : '全局助手请求失败'
      appStore.updateAssistantMessageContent(assistantMessageId, () => `处理失败：${errorMessage}`, { persistMode: 'final' })
      message.error(errorMessage)
    } finally {
      isSending.value = false
      if (sharedStreamingMessageId === assistantMessageId) {
        clearStreamState()
      }
      unregisterStreamListenerIfIdle()
    }
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    // Enter 发送，Shift+Enter（及 Ctrl/Cmd+Enter）换行；输入法组字时的 Enter 不触发发送。
    if (event.key !== 'Enter') return
    if (event.isComposing || (event as KeyboardEvent & { keyCode?: number }).keyCode === 229) return
    if (event.shiftKey || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    void sendPrompt()
  }

  async function stopStreaming(): Promise<void> {
    if (!sharedStreamId) return
    await window.characterArc.stopAiStream(sharedStreamId)
  }

  return {
    composerValue,
    activeMode,
    isSending,
    isProposalLoading,
    isRunningAudit,
    worldviewTargetMap,
    characterTargetMap,
    organizationTargetMap,
    outlineTargetMap,
    messages,
    proposal,
    proposalDiffFiles,
    proposalDiffPatch,
    proposalDiffStats,
    lastProposalPrompt,
    lastAssistantReply,
    sessions,
    activeSessionId,
    currentModeMeta,
    isAuditMode,
    assistantStatus,
    canSuggestProposal,
    dismissProposalSuggestion,
    generateProposalFromSuggestion,
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
    resolveKnowledgeSaveDestination,
    openKnowledgeSaveDestination,
    startNewConversation,
    switchConversation,
    deleteConversation,
    handleNewSession,
    clearTargetSelections,
    resetConversationState,
    sendPrompt,
    stopStreaming,
    handleComposerKeydown,
    generateProposal,
    regenerateProposal,
    runAuditFromAssistant,
    applyConstraintProposal,
    applyWorldviewProposal,
    applyCharacterProposal,
    applyOrganizationProposal,
    applyOutlineProposal,
    applyProposalDiffFile,
    applyAllProposal,
    clearProposal,
    setProposal,
    worldviewUpdateKey,
    characterUpdateKey,
    organizationUpdateKey,
    outlineUpdateKey,
    findWorldviewByTitle,
    findCharacterByName,
    findOrganizationByName,
    findOutlineByTitle,
    resolveWorldviewTarget,
    resolveCharacterTarget,
    resolveOrganizationTarget,
    resolveOutlineTarget,
    hasWorldviewApplyTarget,
    hasCharacterApplyTarget,
    hasOrganizationApplyTarget,
    hasOutlineApplyTarget,
    renderMarkdown,
    formatToolArgs,
    formatToolResultPreview,
    getMessageToolCalls,
    describeToolAction,
    toolStatusLabel,
    groupedToolCalls
  }
}

