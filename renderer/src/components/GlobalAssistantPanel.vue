<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BookMarked,
  ChevronRight,
  FileCheck2,
  Globe2,
  History,
  Info,
  Network,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  X
} from 'lucide-vue-next'
import { NButton, NEmpty, NPopover, NSelect, NTag, NTooltip, useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AssistantToolCall, ChatMessage, GlobalAssistantProposal, PanelName } from '@/types/app'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

type AssistantMode = 'ingest' | 'correct' | 'audit'

type QuickAction = {
  label: string
  prompt: string
}

type ProposalIntent = 'chat' | 'proposal'

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

function renderMarkdown(content: string): string {
  const html = marked.parse(content || '', { async: false }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR
  })
}

const props = defineProps<{
  activeViewLabel?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const AI_TASK_KEY = 'global-assistant-chat'
const PROPOSAL_TASK_KEY = 'global-assistant-proposal'

const appStore = useAppStore()
const message = useMessage()

const composerValue = ref('')
const activeMode = ref<AssistantMode>('ingest')
const conversationRef = ref<HTMLDivElement | null>(null)
const worldviewTargetMap = ref<Record<string, string>>({})
const characterTargetMap = ref<Record<string, string>>({})
const outlineTargetMap = ref<Record<string, string>>({})
const isRunningAudit = ref(false)
const showSessions = ref(false)
let streamId: string | null = null
let streamingMessageId: string | null = null
let removeStreamListener: (() => void) | null = null
let resolveStream: ((text: string) => void) | null = null
let rejectStream: ((error: Error) => void) | null = null
let proposalRequestToken = 0

const modeOptions: Array<{ id: AssistantMode; label: string; description: string }> = [
  { id: 'ingest', label: '录入', description: '整理长设定、粗大纲和项目草稿' },
  { id: 'correct', label: '修正', description: '纠正世界观、人设和大纲跑偏' },
  { id: 'audit', label: '审计', description: '检查 OOC、冲突和伏笔问题' }
]

const quickActions = computed<Record<AssistantMode, QuickAction[]>>(() => ({
  ingest: [
    { label: '录入大纲', prompt: '我有一份粗糙大纲草稿，请帮我整理成结构化章节节点，并标出关键高潮和转折。' },
    { label: '录入角色', prompt: '我有几名主要角色的草稿设定，请帮我整理成角色卡，并保留待确认的部分。' },
    { label: '录入历史', prompt: '我有一份长篇历史时间线，请帮我拆成结构化历史词条和时间线节点。' }
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
const isSending = ref(false)
const isProposalLoading = ref(false)
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
  Array<{
    id: string
    label: string
    panel: PanelName
    count: number
    icon: typeof Globe2
  }>
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
  if (!current) {
    return false
  }

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

const sessions = computed(() => {
  return [...appStore.globalAssistantSessions].sort((left, right) =>
    (right.updatedAt || '').localeCompare(left.updatedAt || '')
  )
})

function scrollToBottom(smooth = true): void {
  if (!conversationRef.value) {
    return
  }

  conversationRef.value.scrollTo({
    top: conversationRef.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  })
}

function clearStreamState(): void {
  streamId = null
  streamingMessageId = null
  resolveStream = null
  rejectStream = null
}

function finalizeStreamingMessage(payload?: { isError?: boolean; isCanceled?: boolean }): void {
  if (!streamingMessageId) {
    return
  }
  appStore.finalizeAssistantStreamingMessage(streamingMessageId, payload)
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

  if (
    toolCall?.toolName === 'read_chapter'
    && normalized.includes('No chapter_id was provided')
    && normalized.includes('there is no active chapter')
  ) {
    return '当前没有激活章节，所以这次没法直接读取“当前章节”。AI 接下来应先查看章节列表，或改为读取项目中的其他资料。'
  }

  if (
    toolCall?.toolName === 'edit_chapter'
    && normalized.includes('No active chapter is selected')
  ) {
    return '当前没有激活章节，所以这次不能直接修改正文。请先进入某一章，或先让 AI 找到目标章节。'
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
    relationships: '关系',
    outline: '大纲',
    plot_threads: '剧情线索',
    plotThreads: '剧情线索',
    inspiration: '灵感',
    knowledge: '项目知识',
    deconstruction_library: '拆书知识库',
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
        replace: '替换章节内容',
        insert: '插入章节内容',
        append: '追加章节内容'
      }
      return opMap[operation] ?? '修改章节内容'
    }
    case 'list_chapters':
      return '查看章节列表'
    case 'knowledge_save_document':
      return '保存知识文档'
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

type ToolGroup = {
  key: 'search' | 'read' | 'write'
  label: string
  items: AssistantToolCall[]
}

function toolGroupKey(toolCall: AssistantToolCall): ToolGroup['key'] {
  if (toolCall.toolName === 'search_project' || toolCall.toolName === 'skill_load') {
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
    groups.push({
      key,
      label: labels[key],
      items: [toolCall]
    })
  }

  return groups
}

function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
  if (payload.streamId !== streamId || !streamingMessageId) {
    return
  }

  if (payload.type === 'chunk') {
    appStore.updateAssistantMessageContent(streamingMessageId, (content) => content + payload.delta)
    nextTick(() => scrollToBottom())
    return
  }

  if (payload.type === 'tool_use_start') {
    appStore.appendAssistantToolCall(streamingMessageId, {
      toolUseId: payload.toolUseId,
      toolName: payload.toolName,
      args: payload.args,
      status: 'running'
    })
    nextTick(() => scrollToBottom())
    return
  }

  if (payload.type === 'tool_result') {
    appStore.updateAssistantToolCall(streamingMessageId, payload.toolUseId, (toolCall) => ({
      ...toolCall,
      status: payload.isError ? 'error' : 'done',
      result: payload.content,
      isError: payload.isError,
      durationMs: payload.durationMs
    }))
    nextTick(() => scrollToBottom())
    return
  }

  if (payload.type === 'edit_applied') {
    appStore.appendAssistantEditEvent(streamingMessageId, {
      chapterId: payload.chapterId,
      editType: payload.editType,
      preview: payload.preview,
      versionId: payload.versionId
    })
    nextTick(() => scrollToBottom())
    return
  }

  if (payload.type === 'done') {
    const finalText = String(payload.content ?? '').trim()
    if (finalText) {
      appStore.updateAssistantMessageContent(streamingMessageId, () => finalText)
    }

    finalizeStreamingMessage()
    const resolve = resolveStream
    clearStreamState()
    resolve?.(finalText)
    return
  }

  if (payload.type === 'canceled') {
    const fallbackText = String(payload.content ?? '').trim() || '已停止生成'
    appStore.updateAssistantMessageContent(streamingMessageId, (content) => content.trim() ? content : fallbackText)

    finalizeStreamingMessage({ isCanceled: true })
    const reject = rejectStream
    clearStreamState()
    reject?.(new Error('canceled'))
    return
  }

  if (payload.type === 'error') {
    const errorMessage = payload.error || '全局助手生成失败'
    appStore.updateAssistantMessageContent(streamingMessageId, (content) => content.trim() ? content : `处理失败：${errorMessage}`)

    finalizeStreamingMessage({ isError: true })
    const reject = rejectStream
    clearStreamState()
    reject?.(new Error(errorMessage))
  }
}

function registerStreamListener(): void {
  if (removeStreamListener) {
    return
  }

  removeStreamListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
}

function unregisterStreamListener(): void {
  removeStreamListener?.()
  removeStreamListener = null
}

onMounted(registerStreamListener)
onBeforeUnmount(unregisterStreamListener)

watch(
  () => messages.value.length,
  () => {
    nextTick(() => scrollToBottom(false))
  },
  { immediate: true }
)

watch(
  () => activeSessionId.value,
  () => {
    clearTargetSelections()
    showSessions.value = false
    nextTick(() => scrollToBottom(false))
  }
)

function setMode(mode: AssistantMode): void {
  activeMode.value = mode
}

function fillQuickAction(action: QuickAction): void {
  composerValue.value = action.prompt
}

function openAsset(panel: PanelName): void {
  appStore.setPanel(panel)
}

function clearTargetSelections(): void {
  worldviewTargetMap.value = {}
  characterTargetMap.value = {}
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
  payload: {
    proposal?: GlobalAssistantProposal | null
    lastProposalPrompt?: string
    lastAssistantReply?: string
  }
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
  showSessions.value = false
  nextTick(() => scrollToBottom(false))
}

function switchConversation(sessionId: string): void {
  if (isSending.value || isRunningAudit.value || isProposalLoading.value) {
    message.warning('请等待当前全局助手请求完成')
    return
  }

  appStore.switchAssistantSession(sessionId)
  resetConversationState()
  showSessions.value = false
  nextTick(() => scrollToBottom(false))
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

function closePanel(): void {
  emit('close')
}

function worldviewUpdateKey(index: number, matchTitle: string): string {
  return `${index}:${matchTitle}`
}

function characterUpdateKey(index: number, matchName: string): string {
  return `${index}:${matchName}`
}

function outlineUpdateKey(index: number, matchTitle: string): string {
  return `${index}:${matchTitle}`
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

function resolveWorldviewTargetId(item: GlobalAssistantProposal['worldviewUpdates'][number], index: number): string {
  return findWorldviewByTitle(item.matchTitle)?.id ?? worldviewTargetMap.value[worldviewUpdateKey(index, item.matchTitle)] ?? ''
}

function resolveCharacterTargetId(item: GlobalAssistantProposal['characterUpdates'][number], index: number): string {
  return findCharacterByName(item.matchName)?.id ?? characterTargetMap.value[characterUpdateKey(index, item.matchName)] ?? ''
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

function trimProposal(current: GlobalAssistantProposal): GlobalAssistantProposal | null {
  const next: GlobalAssistantProposal = {
    summary: current.summary,
    constraintCreates: current.constraintCreates,
    worldviewCreates: current.worldviewCreates,
    worldviewUpdates: current.worldviewUpdates,
    characterCreates: current.characterCreates,
    characterUpdates: current.characterUpdates,
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

async function shouldGenerateProposal(userPrompt: string, assistantReply: string): Promise<boolean> {
  const project = appStore.currentProject
  if (!project) {
    return false
  }

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

  if (!response.success || !response.result) {
    return false
  }

  const intent = (response.result as { intent?: ProposalIntent }).intent
  return intent === 'proposal'
}

async function generateProposal(userPrompt: string, assistantReply: string, sessionId = activeSessionId.value): Promise<void> {
  const project = appStore.currentProject
  const normalizedPrompt = userPrompt.trim()
  if (!project || !normalizedPrompt || !sessionId) {
    return
  }

  if (isProposalLoading.value) {
    return
  }

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
        worldviewEntries: appStore.worldviewEntries.slice(0, 14),
        characters: appStore.characters.slice(0, 14),
        organizations: appStore.organizations.slice(0, 10),
        characterRelationships: appStore.characterRelationships.slice(0, 18),
        inspirationEntries: appStore.inspirationEntries.slice(0, 12),
        outlineItems: appStore.outlineItems.slice(0, 18),
        workflowDocuments: appStore.workflowDocuments,
        knowledgeDocuments: appStore.knowledgeDocuments.slice(0, 12),
        projectConstraints: appStore.projectConstraints.slice(0, 8),
        projectSkills: project.projectSkills.filter((item) => item.enabled)
      }
    }))

    if (!response.success || !response.result) {
      throw new Error(response.error ?? '写回提案生成失败')
    }

    if (requestToken !== proposalRequestToken) {
      return
    }

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
      locked: true
    })
    appliedCount += 1
  }

  setProposal(trimProposal({
    ...current,
    constraintCreates: []
  }))

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
  let focusTargetId = ''

  for (const item of current.worldviewCreates) {
    const createdId = appStore.createWorldviewEntry({
      type: item.type,
      title: item.title,
      content: item.content
    })
    appliedCount += 1
    appliedTitles.push(item.title)
    focusTargetId = createdId
  }

  for (const [index, item] of current.worldviewUpdates.entries()) {
    const target = resolveWorldviewTarget(item, index)
    if (!target) continue
    appStore.updateWorldviewEntry(target.id, {
      type: item.type,
      title: item.title,
      content: item.content
    })
    appliedCount += 1
    appliedTitles.push(item.title || target.title)
    if (!focusTargetId) {
      focusTargetId = target.id
    }
  }

  worldviewTargetMap.value = {}
  setProposal(trimProposal({
    ...current,
    worldviewCreates: [],
    worldviewUpdates: []
  }))

  if (appliedCount > 0) {
    appStore.setPanel('world')
    if (focusTargetId) {
      appStore.setAssistantFocusTarget('world', focusTargetId)
    }
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
  let focusTargetId = ''

  for (const item of current.characterCreates) {
    const createdId = appStore.createCharacter({
      name: item.name,
      role: item.role,
      description: item.description,
      tags: item.tags.map((label) => ({ label }))
    })
    appliedCount += 1
    appliedNames.push(item.name)
    focusTargetId = createdId
  }

  for (const [index, item] of current.characterUpdates.entries()) {
    const target = resolveCharacterTarget(item, index)
    if (!target) continue
    appStore.updateCharacter(target.id, {
      name: item.name,
      role: item.role,
      description: item.description,
      tags: item.tags?.map((label) => ({ label }))
    })
    appliedCount += 1
    appliedNames.push(item.name || target.name)
    if (!focusTargetId) {
      focusTargetId = target.id
    }
  }

  characterTargetMap.value = {}
  setProposal(trimProposal({
    ...current,
    characterCreates: [],
    characterUpdates: []
  }))

  if (appliedCount > 0) {
    appStore.setPanel('characters')
    if (focusTargetId) {
      appStore.setAssistantFocusTarget('characters', focusTargetId)
    }
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
  let focusTargetId = ''

  for (const item of current.outlineCreates) {
    const createdId = appStore.createOutlineItem({
      title: item.title,
      wordTarget: item.wordTarget,
      conflict: item.conflict,
      summary: item.summary,
      status: 'planned'
    })
    appliedCount += 1
    appliedTitles.push(item.title)
    focusTargetId = createdId
  }

  for (const [index, item] of current.outlineUpdates.entries()) {
    const target = resolveOutlineTarget(item, index)
    if (!target) continue
    appStore.updateOutlineItem(target.id, {
      title: item.title,
      wordTarget: item.wordTarget,
      conflict: item.conflict,
      summary: item.summary
    })
    appliedCount += 1
    appliedTitles.push(item.title || target.title)
    if (!focusTargetId) {
      focusTargetId = target.id
    }
  }

  outlineTargetMap.value = {}
  setProposal(trimProposal({
    ...current,
    outlineCreates: [],
    outlineUpdates: []
  }))

  if (appliedCount > 0) {
    appStore.setPanel('outline')
    if (focusTargetId) {
      appStore.setAssistantFocusTarget('outline', focusTargetId)
    }
    const preview = appliedTitles.slice(0, 3).join('、')
    const suffix = appliedTitles.length > 3 ? ` 等 ${appliedTitles.length} 条` : ''
    message.success(`已写回大纲：${preview}${suffix}`)
  } else {
    message.warning('这组大纲提案暂时没有可匹配的写回目标')
  }
}

function applyAllProposal(): void {
  if (!proposal.value) return
  if (proposal.value.constraintCreates.length) applyConstraintProposal()
  if (hasWorldviewApplyTarget()) applyWorldviewProposal()
  if (proposal.value && hasCharacterApplyTarget()) applyCharacterProposal()
  if (proposal.value && hasOutlineApplyTarget()) applyOutlineProposal()
  if (proposal.value?.notes.length) {
    setProposal(trimProposal({
      ...proposal.value,
      notes: []
    }))
  }
}

async function runAuditFromAssistant(promptOverride?: string): Promise<void> {
  const project = appStore.currentProject
  if (!project || isRunningAudit.value) {
    return
  }

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
        projectSkills: project.projectSkills.filter((item) => item.enabled)
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
      metadata: {
        auditTargetChapterIndex: currentChapterIndex,
        generatedAt: now
      },
      createdAt: now,
      updatedAt: now
    }])

    appStore.pushAssistantMessage(reportContent)
    const proposalPrompt = promptOverride || composerValue.value.trim() || '请根据审计报告生成修正提案。'
    appStore.updateAssistantSessionProposal({
      lastProposalPrompt: proposalPrompt,
      lastAssistantReply: reportContent
    })
    await generateProposal(proposalPrompt, reportContent)
    message.success('审计完成，报告已归档并生成修正提案')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '审计失败'
    message.error(errorMessage)
  } finally {
    isRunningAudit.value = false
    nextTick(() => scrollToBottom())
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
  streamingMessageId = assistantMessageId
  isSending.value = true

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
        currentPanelLabel: props.activeViewLabel ?? '',
        userPrompt: prompt,
        enabledContextModules: ['worldview', 'characters', 'organizations', 'relationships', 'outline', 'plotThreads', 'inspiration', 'knowledge', 'workflowDocuments', 'projectConstraints'],
        recentMessages: appStore.messages.slice(0, -2).slice(-8).map((item) => ({
          role: item.role,
          content: item.content
        })),
        worldviewEntries: appStore.worldviewEntries.slice(0, 4),
        characters: appStore.characters.slice(0, 4),
        organizations: appStore.organizations.slice(0, 3),
        characterRelationships: appStore.characterRelationships.slice(0, 6),
        inspirationEntries: appStore.inspirationEntries.slice(0, 4),
        outlineItems: appStore.outlineItems.slice(0, 6),
        plotThreads: appStore.plotThreads.slice(0, 4),
        workflowDocuments: appStore.workflowDocuments.slice(0, 2).map((item) => ({
          title: item.title,
          content: item.content.slice(0, 160)
        })),
        knowledgeDocuments: appStore.knowledgeDocuments.slice(0, 4).map((item) => ({
          title: item.title,
          summary: item.summary,
          sourceLabel: item.sourceLabel
        })),
        projectConstraints: appStore.projectConstraints.slice(0, 4).map((item) => ({
          title: item.title,
          content: item.content,
          metadata: item.metadata
        })),
        projectSkills: project.projectSkills.filter((item) => item.enabled)
      }
    }))

    const sid = (response.result as { streamId?: string } | undefined)?.streamId
    if (!response.success || !sid) {
      throw new Error(response.error ?? '全局助手流式生成启动失败')
    }
    streamId = sid

    const assistantText = await new Promise<string>((resolve, reject) => {
      resolveStream = resolve
      rejectStream = reject
    })
    const normalizedAssistantText = assistantText.trim() || '我暂时没有整理出可靠结论，建议你补充更多上下文后重试。'
    appStore.updateAssistantMessageContent(assistantMessageId, () => normalizedAssistantText)
    if (!isAuditMode.value) {
      const shouldCreateProposal = await shouldGenerateProposal(prompt, normalizedAssistantText)
      if (shouldCreateProposal) {
        void generateProposal(prompt, normalizedAssistantText, sessionId)
      } else if (proposal.value) {
        clearProposal()
      }
    }
  } catch (error) {
    const isCanceled = error instanceof Error && error.message === 'canceled'
    if (isCanceled) {
      return
    }

    const errorMessage = error instanceof Error ? error.message : '全局助手请求失败'
    appStore.updateAssistantMessageContent(assistantMessageId, () => `处理失败：${errorMessage}`)
    message.error(errorMessage)
  } finally {
    isSending.value = false
    if (streamingMessageId === assistantMessageId) {
      clearStreamState()
    }
    nextTick(() => scrollToBottom())
  }
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void sendPrompt()
  }
}

async function stopStreaming(): Promise<void> {
  if (!streamId) {
    return
  }

  await window.characterArc.stopAiStream(streamId)
}

function handleNewSession(): void {
  startNewConversation()
}
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

.global-ai-toolbar {
  display: flex;
  padding-top: 8px;
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
  min-height: 76px;
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
