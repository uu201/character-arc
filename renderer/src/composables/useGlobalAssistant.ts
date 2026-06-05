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
    groups.push({ key, label: labels[key], items: [toolCall] })
  }

  return groups
}

export function useGlobalAssistant(options: UseGlobalAssistantOptions = {}) {
  const appStore = useAppStore()
  const message = useMessage()

  const resolveViewLabel = (): string => toValue(options.activeViewLabel) ?? ''

  // 实例级状态（绝不可提升到模块作用域，否则 dock + 整页双挂载会互相串扰）
  const composerValue = ref('')
  const activeMode = ref<AssistantMode>('ingest')
  const worldviewTargetMap = ref<Record<string, string>>({})
  const characterTargetMap = ref<Record<string, string>>({})
  const outlineTargetMap = ref<Record<string, string>>({})
  const isRunningAudit = ref(false)
  const isSending = ref(false)
  const isProposalLoading = ref(false)

  // 实例级流式句柄
  let streamId: string | null = null
  let streamingMessageId: string | null = null
  let removeStreamListener: (() => void) | null = null
  let resolveStream: ((text: string) => void) | null = null
  let rejectStream: ((error: Error) => void) | null = null
  let proposalRequestToken = 0

  const modeOptions = GLOBAL_ASSISTANT_MODE_OPTIONS

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

  const sessions = computed(() =>
    [...appStore.globalAssistantSessions].sort((left, right) =>
      (right.updatedAt || '').localeCompare(left.updatedAt || '')
    )
  )

  function clearStreamState(): void {
    streamId = null
    streamingMessageId = null
    resolveStream = null
    rejectStream = null
  }

  function finalizeStreamingMessage(payload?: { isError?: boolean; isCanceled?: boolean }): void {
    if (!streamingMessageId) return
    appStore.finalizeAssistantStreamingMessage(streamingMessageId, payload)
  }

  // 流式事件处理：按 streamId 门控，仅发起本次发送的实例会通过，store 写入只发生一次。
  // 滚动已解耦——由各壳自行 watch messages 处理。
  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId || !streamingMessageId) {
      return
    }

    if (payload.type === 'chunk') {
      appStore.updateAssistantMessageContent(streamingMessageId, (content) => content + payload.delta)
      return
    }

    if (payload.type === 'tool_use_start') {
      appStore.appendAssistantToolCall(streamingMessageId, {
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        args: payload.args,
        status: 'running'
      })
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
      return
    }

    if (payload.type === 'edit_applied') {
      appStore.appendAssistantEditEvent(streamingMessageId, {
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
    if (removeStreamListener) return
    removeStreamListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  function unregisterStreamListener(): void {
    removeStreamListener?.()
    removeStreamListener = null
  }

  onMounted(() => {
    registerStreamListener()
  })

  onBeforeUnmount(() => {
    unregisterStreamListener()
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
    let focusTargetId = ''

    for (const item of current.worldviewCreates) {
      const createdId = appStore.createWorldviewEntry({ type: item.type, title: item.title, content: item.content })
      appliedCount += 1
      appliedTitles.push(item.title)
      focusTargetId = createdId
    }

    for (const [index, item] of current.worldviewUpdates.entries()) {
      const target = resolveWorldviewTarget(item, index)
      if (!target) continue
      appStore.updateWorldviewEntry(target.id, { type: item.type, title: item.title, content: item.content })
      appliedCount += 1
      appliedTitles.push(item.title || target.title)
      if (!focusTargetId) focusTargetId = target.id
    }

    worldviewTargetMap.value = {}
    setProposal(trimProposal({ ...current, worldviewCreates: [], worldviewUpdates: [] }))

    if (appliedCount > 0) {
      appStore.setPanel('world')
      if (focusTargetId) appStore.setAssistantFocusTarget('world', focusTargetId)
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
      if (!focusTargetId) focusTargetId = target.id
    }

    characterTargetMap.value = {}
    setProposal(trimProposal({ ...current, characterCreates: [], characterUpdates: [] }))

    if (appliedCount > 0) {
      appStore.setPanel('characters')
      if (focusTargetId) appStore.setAssistantFocusTarget('characters', focusTargetId)
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
      if (!focusTargetId) focusTargetId = target.id
    }

    outlineTargetMap.value = {}
    setProposal(trimProposal({ ...current, outlineCreates: [], outlineUpdates: [] }))

    if (appliedCount > 0) {
      appStore.setPanel('outline')
      if (focusTargetId) appStore.setAssistantFocusTarget('outline', focusTargetId)
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
          currentPanelLabel: resolveViewLabel(),
          userPrompt: prompt,
          enabledContextModules: ['worldview', 'characters', 'organizations', 'relationships', 'outline', 'plotThreads', 'inspiration', 'knowledge', 'workflowDocuments', 'projectConstraints'],
          recentMessages: appStore.messages.slice(0, -2).slice(-8).map((item) => ({ role: item.role, content: item.content })),
          worldviewEntries: appStore.worldviewEntries.slice(0, 4),
          characters: appStore.characters.slice(0, 4),
          organizations: appStore.organizations.slice(0, 3),
          characterRelationships: appStore.characterRelationships.slice(0, 6),
          inspirationEntries: appStore.inspirationEntries.slice(0, 4),
          outlineItems: appStore.outlineItems.slice(0, 6),
          plotThreads: appStore.plotThreads.slice(0, 4),
          workflowDocuments: appStore.workflowDocuments.slice(0, 2).map((item) => ({ title: item.title, content: item.content.slice(0, 160) })),
          knowledgeDocuments: appStore.knowledgeDocuments.slice(0, 4).map((item) => ({ title: item.title, summary: item.summary, sourceLabel: item.sourceLabel })),
          projectConstraints: appStore.projectConstraints.slice(0, 4).map((item) => ({ title: item.title, content: item.content, metadata: item.metadata })),
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
    }
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void sendPrompt()
    }
  }

  async function stopStreaming(): Promise<void> {
    if (!streamId) return
    await window.characterArc.stopAiStream(streamId)
  }

  return {
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
    lastProposalPrompt,
    lastAssistantReply,
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
    applyOutlineProposal,
    applyAllProposal,
    clearProposal,
    setProposal,
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
  }
}

