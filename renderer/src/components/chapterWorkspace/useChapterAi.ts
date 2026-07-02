import { computed, reactive, ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterAssistantContext } from '@/features/ai/chapterAssistantContext'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { ChapterEditProposal, ChapterInsertionMode } from '@/types/app'
import type { GlobalAssistantProposalDiffFile } from '@/composables/useGlobalAssistant'
import { getChapterPreviewText } from '@/features/chapters/editorContent'

export type ChapterAiRole = 'user' | 'assistant'

export type ChapterAiToolCall = {
  toolUseId: string
  toolName: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
  isError?: boolean
  durationMs?: number
}

export type ChapterAiEditEvent = {
  chapterId: string
  editType: string
  preview: string
  versionId: string
}

export type ChapterAiTurn = {
  text: string
  toolCalls: ChapterAiToolCall[]
  editEvents: ChapterAiEditEvent[]
}

export interface ChapterAiMessage {
  id: string
  role: ChapterAiRole
  content: string  // 保留用于向后兼容
  createdAt: number
  chapterId?: string
  reasoning?: string
  toolCalls?: ChapterAiToolCall[]  // 保留用于向后兼容
  editEvents?: ChapterAiEditEvent[]  // 保留用于向后兼容
  turns?: ChapterAiTurn[]  // 新增：多轮推理结构
  isError?: boolean  // 新增：标记是否为错误消息
  isCanceled?: boolean  // 新增：标记是否被取消
}

const TASK_KEY = 'chapter-workspace-chat'

let messageSeq = 0
function nextMessageId(): string {
  messageSeq += 1
  return `cwm-${Date.now().toString(36)}-${messageSeq}`
}

const sharedMessages = ref<ChapterAiMessage[]>([])
const sharedAgentStatus = ref('')
const sharedPendingEditProposals = ref<ChapterEditProposal[]>([])
const sharedShowDiffReview = ref(false)
const sharedCurrentSessionId = ref<string | null>(null)
const sharedSessions = ref<SessionSummary[]>([])
const sharedDeletedSessionIds = new Set<string>()
let sharedHydratedProjectId = ''

export type ContextModule = 'chapter' | 'outline' | 'characters' | 'worldview' | 'plotThreads' | 'knowledge' | 'deconstructionLibrary'

const ALL_CONTEXT_MODULES: ContextModule[] = ['chapter', 'outline', 'characters', 'worldview', 'plotThreads', 'knowledge', 'deconstructionLibrary']

type ComposerMode = '问答' | '改写' | '续写'

function resolveComposerMode(prompt: string): ComposerMode {
  const match = prompt.match(/^\[(问答|改写|续写)\]\s*/)
  return (match?.[1] as ComposerMode | undefined) ?? '问答'
}

function stripComposerModePrefix(prompt: string): string {
  return prompt.replace(/^\[(问答|改写|续写)\]\s*/, '').trim()
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function collectEditRequirements(normalizedPrompt: string): string[] {
  const requirements: string[] = []
  if (includesAny(normalizedPrompt, ['文章开头', '章节开头', '小说开头', '开篇', '开头部分', '开头'])) {
    requirements.push('优先处理当前章节开头部分')
  }
  if (includesAny(normalizedPrompt, ['疲软', '拖沓', '水分', '冗余'])) {
    requirements.push('删除或压缩疲软、拖沓、冗余的段落')
  }
  if (includesAny(normalizedPrompt, ['长句', '拆句', '断句', '句子太长'])) {
    requirements.push('拆分长句，让句子长短交替')
  }
  if (includesAny(normalizedPrompt, ['段落控', '段落控制', '分段', '段落太长', '段落长度'])) {
    requirements.push('控制段落长度和信息密度')
  }
  if (includesAny(normalizedPrompt, ['节奏', '节奏感', '节拍'])) {
    requirements.push('调整叙事节奏和阅读推进感')
  }
  if (includesAny(normalizedPrompt, ['ai味', 'AI味', '机械', '模板感'])) {
    requirements.push('降低 AI 味和机械句式')
  }
  return requirements
}

function hasConcreteEditDirection(normalizedPrompt: string): boolean {
  const concreteKeywords = [
    '改写',
    '重写',
    '润色',
    '替换',
    '删掉',
    '删除',
    '精简',
    '压缩',
    '拆长句',
    '拆句',
    '断句',
    '分段',
    '段落控',
    '段落控制',
    '调整节奏',
    '优化表达',
    '降低AI感',
    '降低ai感',
    '去AI味',
    '去ai味',
    '疲软',
    '拖沓',
    '冗余',
    '长句',
    '口语',
    '文风',
    '节奏',
    '开头',
    '开篇',
    '文章开头',
    '章节开头',
    '小说开头',
    '开头部分',
    '直接改',
    '按建议改',
    '按你说的改'
  ]
  return includesAny(normalizedPrompt, concreteKeywords)
}

function buildChapterIntentHint(prompt: string, hasSelection: boolean): string {
  const mode = resolveComposerMode(prompt)
  const content = stripComposerModePrefix(prompt)
  const normalized = content.replace(/\s+/g, '')

  const editKeywords = [
    '改写',
    '重写',
    '润色',
    '修改',
    '替换',
    '删掉',
    '删除',
    '精简',
    '压缩',
    '拆长句',
    '拆句',
    '断句',
    '分段',
    '段落控',
    '段落控制',
    '调整段落',
    '调整节奏',
    '优化表达',
    '降低AI感',
    '降低ai感',
    '去AI味',
    '去ai味',
    '直接改',
    '改一下',
    '处理一下'
  ]
  const diagnoseKeywords = ['分析', '诊断', '检查', '建议', '怎么改', '如何改', '哪里有问题', '问题在哪']
  const applyPreviousKeywords = ['按你说的改', '按建议改', '按上面改', '照这个改', '就这样改', '应用修改', '写回正文']

  const hasEditIntent = mode === '改写' || includesAny(normalized, editKeywords)
  const hasApplyPreviousIntent = includesAny(normalized, applyPreviousKeywords)
  const hasDiagnoseIntent = includesAny(normalized, diagnoseKeywords)
  const hasConcreteDirection = hasConcreteEditDirection(normalized)
  const explicitExecution = includesAny(normalized, ['直接', '需要', '帮我', '请', '把', '输出一版', '生成一版', '处理'])
  const target = hasSelection ? '当前选中文本' : '当前章节正文'
  const requirements = collectEditRequirements(normalized)

  if (hasEditIntent && !hasConcreteDirection && !hasSelection) {
    return [
      '意图判读提示（仅供你结合用户原话复核，不替代你的判断）：',
      '- 初步意图：章节修改意向，但缺少具体修改方向',
      `- 输入模式：${mode}`,
      `- 默认目标：${target}`,
      '- 期望工具动作：先读取目标章节并给出简短诊断/可选修改方向，或询问用户想改什么；不要直接调用 edit_chapter 生成 Diff 提案。'
    ].join('\n')
  }

  if (hasApplyPreviousIntent || (hasEditIntent && hasConcreteDirection && (!hasDiagnoseIntent || explicitExecution))) {
    const kind = hasApplyPreviousIntent ? 'apply_previous_suggestion' : 'chapter_edit_proposal'
    return [
      '意图判读提示（仅供你结合用户原话复核，不替代你的判断）：',
      `- 初步意图：${kind === 'apply_previous_suggestion' ? '应用上一轮建议并生成正文修改提案' : '执行型章节正文修改'}`,
      `- 输入模式：${mode}`,
      `- 默认目标：${target}`,
      '- 期望工具动作：先确认正文上下文，再调用 edit_chapter 生成待审查 Diff 提案；不要只罗列修改建议。',
      `- 用户要求：${requirements.length ? requirements.join('；') : '按用户描述改写正文'}`
    ].join('\n')
  }

  if (mode === '续写') {
    return [
      '意图判读提示（仅供你结合用户原话复核，不替代你的判断）：',
      '- 初步意图：续写或补写正文',
      `- 输入模式：${mode}`,
      `- 默认目标：${target}`,
      '- 期望工具动作：先确认当前章节上下文；只有用户明确要求写回正文时，才调用 edit_chapter 生成 Diff 提案。'
    ].join('\n')
  }

  if (hasDiagnoseIntent) {
    return [
      '意图判读提示（仅供你结合用户原话复核，不替代你的判断）：',
      '- 初步意图：诊断或建议型请求',
      `- 输入模式：${mode}`,
      `- 默认目标：${target}`,
      '- 期望工具动作：可以读取正文或项目资料来诊断；不要在用户未要求执行修改时调用 edit_chapter。'
    ].join('\n')
  }

  return [
    '意图判读提示（仅供你结合用户原话复核，不替代你的判断）：',
    '- 初步意图：普通问答或讨论',
    `- 输入模式：${mode}`,
    '- 期望工具动作：根据问题需要读取上下文；不要主动写回正文。'
  ].join('\n')
}

function resolveResponseMode(prompt: string): 'freeform' | 'polish' | 'continue' {
  const mode = resolveComposerMode(prompt)
  const normalized = stripComposerModePrefix(prompt).replace(/\s+/g, '')
  if (mode === '改写') return 'polish'
  if (mode === '续写') return 'continue'
  if (hasConcreteEditDirection(normalized)) return 'polish'
  return 'freeform'
}

function stripHtmlForDiff(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>\s*/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeDiffPath(value: string): string {
  return value.replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'chapter'
}

function resolveEditOperationLabel(editType: string): string {
  if (editType === 'replace') return '替换正文'
  if (editType === 'insert') return '插入正文'
  if (editType === 'append') return '追加正文'
  return editType || '正文修改'
}

export interface SessionSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export function useChapterAi(): {
  messages: Ref<ChapterAiMessage[]>
  isResponding: Ref<boolean>
  agentStatus: Ref<string>
  hasSelection: Ref<boolean>
  selectedText: Ref<string>
  enabledContextModules: Set<ContextModule>
  toggleContextModule: (mod: ContextModule) => void
  currentSessionId: Ref<string | null>
  sessions: Ref<SessionSummary[]>
  send: (prompt: string) => Promise<void>
  stop: () => Promise<void>
  resetMessages: () => void
  newSession: () => void
  hydrateCurrentSession: () => Promise<void>
  saveCurrentSession: () => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  refreshSessions: () => Promise<void>
  applyToChapter: (content: string, mode: ChapterInsertionMode) => boolean
  registerStreamListener: () => void
  unregisterStreamListener: () => void
  showDiffReview: Ref<boolean>
  pendingEditProposals: Ref<ChapterEditProposal[]>
  proposalDiffFiles: Ref<GlobalAssistantProposalDiffFile[]>
  proposalDiffPatch: Ref<string>
  proposalDiffStats: Ref<{ total: number; creatable: number; updatable: number; blocked: number }>
  acceptEditProposal: (proposalId: string) => Promise<boolean>
  acceptAllEditProposals: () => Promise<boolean>
  rejectEditProposal: (proposalId: string) => void
  clearEditProposals: () => void
} {
  const appStore = useAppStore()
  const messages = sharedMessages
  const isResponding = computed(() => appStore.isAiTaskRunning(TASK_KEY))
  const agentStatus = sharedAgentStatus
  const enabledContextModules = reactive(new Set<ContextModule>(ALL_CONTEXT_MODULES))
  const pendingEditProposals = sharedPendingEditProposals
  const showDiffReview = sharedShowDiffReview

  function toggleContextModule(mod: ContextModule): void {
    if (enabledContextModules.has(mod)) {
      enabledContextModules.delete(mod)
    } else {
      enabledContextModules.add(mod)
    }
  }

  const currentSessionId = sharedCurrentSessionId
  const sessions = sharedSessions

  function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function deriveSessionTitle(): string {
    const firstUserMsg = messages.value.find((m) => m.role === 'user')
    if (!firstUserMsg) return '新对话'
    const text = firstUserMsg.content.trim()
    return text.length > 30 ? text.slice(0, 30) + '…' : text
  }

  async function refreshSessions(): Promise<void> {
    const projectId = appStore.currentProject?.id
    if (!projectId) return
    const result = await window.characterArc.listSessions(projectId)
    if (result.success && result.result) {
      sessions.value = result.result.filter((session) => !sharedDeletedSessionIds.has(session.id))
    }
  }

  async function hydrateCurrentSession(): Promise<void> {
    const projectId = appStore.currentProject?.id
    if (!projectId) return

    if (sharedHydratedProjectId !== projectId) {
      currentSessionId.value = null
      messages.value = []
      pendingEditProposals.value = []
      showDiffReview.value = false
      agentStatus.value = ''
    }

    await refreshSessions()
    sharedHydratedProjectId = projectId
    if (messages.value.length > 0 || currentSessionId.value || sessions.value.length === 0) {
      return
    }

    await loadSession(sessions.value[0].id)
  }

  async function saveCurrentSession(): Promise<void> {
    const projectId = appStore.currentProject?.id
    if (!projectId || messages.value.length === 0) return

    const sessionIdAtStart = currentSessionId.value
    const messagesAtStart = messages.value
    if (sessionIdAtStart && sharedDeletedSessionIds.has(sessionIdAtStart)) return

    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      throw new Error(appStore.persistenceError)
    }
    if (messages.value !== messagesAtStart) return
    if (sessionIdAtStart && currentSessionId.value !== sessionIdAtStart) return
    if (sessionIdAtStart && sharedDeletedSessionIds.has(sessionIdAtStart)) return

    if (!currentSessionId.value) {
      currentSessionId.value = generateSessionId()
    }
    const sessionId = currentSessionId.value
    if (!sessionId || sharedDeletedSessionIds.has(sessionId)) return
    const result = await window.characterArc.saveSession(toIpcPayload({
      id: sessionId,
      projectId,
      title: deriveSessionTitle(),
      messages: messages.value
    }))
    if (!result.success) {
      throw new Error(result.error ?? '保存历史会话失败')
    }
    if (sharedDeletedSessionIds.has(sessionId)) {
      void window.characterArc.deleteSession(sessionId)
      return
    }
    await refreshSessions()
  }

  async function loadSession(sessionId: string): Promise<void> {
    if (sharedDeletedSessionIds.has(sessionId)) {
      throw new Error('该历史会话已删除')
    }
    const result = await window.characterArc.loadSession(sessionId)
    if (!result.success || !result.result) {
      throw new Error(result.error ?? '加载历史会话失败')
    }
    currentSessionId.value = result.result.id
    messages.value = result.result.messages as ChapterAiMessage[]
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const wasCurrent = currentSessionId.value === sessionId
    const previousMessages = messages.value
    const previousPendingEditProposals = pendingEditProposals.value
    const previousShowDiffReview = showDiffReview.value
    const previousAgentStatus = agentStatus.value
    sharedDeletedSessionIds.add(sessionId)
    if (wasCurrent) {
      currentSessionId.value = null
      messages.value = []
      pendingEditProposals.value = []
      showDiffReview.value = false
      agentStatus.value = ''
    }
    const result = await window.characterArc.deleteSession(sessionId)
    if (!result.success) {
      sharedDeletedSessionIds.delete(sessionId)
      if (wasCurrent) {
        currentSessionId.value = sessionId
        messages.value = previousMessages
        pendingEditProposals.value = previousPendingEditProposals
        showDiffReview.value = previousShowDiffReview
        agentStatus.value = previousAgentStatus
      }
      throw new Error(result.error ?? '删除历史会话失败')
    }
    await refreshSessions()
  }

  function newSession(): void {
    currentSessionId.value = null
    messages.value = []
    pendingEditProposals.value = []
    showDiffReview.value = false
    agentStatus.value = ''
  }

  const selectedText = computed(() => appStore.currentChapterSelection?.text.trim() ?? '')
  const hasSelection = computed(() =>
    Boolean(
      appStore.currentChapterSelection?.chapterId === appStore.selectedChapter?.id
      && selectedText.value
    )
  )

  let streamId: string | null = null
  let resolveStream: ((text: string) => void) | null = null
  let rejectStream: ((err: Error) => void) | null = null
  let removeListener: (() => void) | null = null
  let streamingMsgId: string | null = null

  function finalizeStreamingMsg(): void {
    const msg = messages.value.find((m) => m.id === streamingMsgId)
    if (!msg) return

    // 处理旧结构的 toolCalls
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.status === 'running') {
          tc.status = 'error'
          tc.result = '（连接中断）'
          tc.isError = true
        }
      }
    }

    // 处理新结构的 turns
    if (msg.turns) {
      for (const turn of msg.turns) {
        for (const tc of turn.toolCalls) {
          if (tc.status === 'running') {
            tc.status = 'error'
            tc.result = '（连接中断）'
            tc.isError = true
          }
        }
      }
    }
  }

  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId) return

    if (payload.type === 'reasoning') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (!msg) return
      msg.reasoning = `${msg.reasoning ?? ''}${payload.delta}`
      return
    }

    if (payload.type === 'chunk') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (!msg) return

      // 向后兼容：更新 content
      msg.content += payload.delta

      // 新结构：更新 turns
      if (!msg.turns) msg.turns = []
      if (msg.turns.length === 0) {
        msg.turns.push({ text: '', toolCalls: [], editEvents: [] })
      }

      const currentTurn = msg.turns[msg.turns.length - 1]

      // 如果当前 turn 有工具调用但还没有文本，说明工具调用完成后开始输出文本，创建新 turn
      if (currentTurn.toolCalls.length > 0 && currentTurn.text === '') {
        msg.turns.push({ text: payload.delta, toolCalls: [], editEvents: [] })
      } else {
        currentTurn.text += payload.delta
      }

      return
    }

    if (payload.type === 'tool_use_start') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (!msg) return

      // 向后兼容：更新 toolCalls
      if (!msg.toolCalls) msg.toolCalls = []
      msg.toolCalls.push({
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        args: payload.args,
        status: 'running'
      })

      // 新结构：更新 turns
      if (!msg.turns) msg.turns = []
      if (msg.turns.length === 0) {
        msg.turns.push({ text: '', toolCalls: [], editEvents: [] })
      }

      const currentTurn = msg.turns[msg.turns.length - 1]

      // 如果当前 turn 已有文本内容，创建新 turn 用于工具调用
      if (currentTurn.text.trim()) {
        msg.turns.push({ text: '', toolCalls: [], editEvents: [] })
      }

      const targetTurn = msg.turns[msg.turns.length - 1]
      targetTurn.toolCalls.push({
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        args: payload.args,
        status: 'running'
      })

      return
    }

    if (payload.type === 'tool_result') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (!msg) return

      // 向后兼容：更新 toolCalls
      const tc = msg.toolCalls?.find((t) => t.toolUseId === payload.toolUseId)
      if (tc) {
        tc.status = payload.isError ? 'error' : 'done'
        tc.result = payload.content
        tc.isError = payload.isError
        tc.durationMs = payload.durationMs
      }

      // 新结构：更新 turns 中的 toolCall
      if (msg.turns) {
        for (const turn of msg.turns) {
          const turnTc = turn.toolCalls.find((t) => t.toolUseId === payload.toolUseId)
          if (turnTc) {
            turnTc.status = payload.isError ? 'error' : 'done'
            turnTc.result = payload.content
            turnTc.isError = payload.isError
            turnTc.durationMs = payload.durationMs
            break
          }
        }
      }

      return
    }

    if (payload.type === 'edit_applied') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (!msg) return

      const editEvent = {
        chapterId: payload.chapterId,
        editType: payload.editType,
        preview: payload.preview,
        versionId: payload.versionId
      }

      // 向后兼容：更新 editEvents
      if (!msg.editEvents) msg.editEvents = []
      msg.editEvents.push(editEvent)

      // 新结构：添加到当前 turn
      if (!msg.turns) msg.turns = []
      if (msg.turns.length === 0) {
        msg.turns.push({ text: '', toolCalls: [], editEvents: [] })
      }
      const currentTurn = msg.turns[msg.turns.length - 1]
      currentTurn.editEvents.push(editEvent)

      void appStore.reloadChapterFromDb(payload.chapterId)
      return
    }

    if (payload.type === 'edit_proposed') {
      pendingEditProposals.value.push({
        proposalId: payload.proposalId,
        chapterId: payload.chapterId,
        editType: payload.editType,
        preview: payload.preview,
        oldContent: payload.oldContent,
        newContent: payload.newContent
      })
      return
    }

    if (payload.type === 'agent_status') {
      agentStatus.value = payload.message
      return
    }

    if (payload.type === 'done') {
      finalizeStreamingMsg()
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg && payload.content && !msg.content) msg.content = payload.content
      const resolve = resolveStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      agentStatus.value = ''
      resolve?.(msg?.content ?? '')

      if (pendingEditProposals.value.length > 0) {
        showDiffReview.value = true
      }
      return
    }

    if (payload.type === 'canceled') {
      console.log('[useChapterAi] canceled event received, streamingMsgId:', streamingMsgId)
      finalizeStreamingMsg()
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      console.log('[useChapterAi] found message:', msg ? { id: msg.id, content: msg.content, turns: msg.turns } : null)

      // 添加取消提示到消息中
      if (msg) {
        // 向后兼容：更新 content
        if (!msg.content.trim()) {
          msg.content = '已停止生成'
        }

        // 新结构：确保 turns 存在并添加取消消息
        if (!msg.turns) {
          msg.turns = []
          console.log('[useChapterAi] created empty turns array')
        }

        if (msg.turns.length === 0) {
          // 没有任何 turn，创建一个显示取消消息
          msg.turns.push({ text: '已停止生成', toolCalls: [], editEvents: [] })
          console.log('[useChapterAi] added cancel message to new turn')
        } else {
          const lastTurn = msg.turns[msg.turns.length - 1]
          console.log('[useChapterAi] last turn:', { text: lastTurn.text, toolCallsCount: lastTurn.toolCalls.length })

          // 如果最后一个 turn 有工具调用但没有文本，创建新 turn 显示取消消息
          if (lastTurn.toolCalls.length > 0 && !lastTurn.text.trim()) {
            msg.turns.push({ text: '已停止生成', toolCalls: [], editEvents: [] })
            console.log('[useChapterAi] added cancel message to new turn after tool calls')
          } else if (!lastTurn.text.trim()) {
            // 如果最后一个 turn 没有内容，直接设置文本
            lastTurn.text = '已停止生成'
            console.log('[useChapterAi] set cancel message to last turn')
          } else {
            console.log('[useChapterAi] last turn already has text, not adding cancel message')
          }
        }

        // 标记为取消状态
        msg.isCanceled = true
        console.log('[useChapterAi] marked message as canceled, final turns:', msg.turns)
      } else {
        console.log('[useChapterAi] ERROR: message not found!')
      }

      const reject = rejectStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      agentStatus.value = ''
      reject?.(new Error('canceled'))
      return
    }
    if (payload.type === 'error') {
      finalizeStreamingMsg()
      const msg = messages.value.find((m) => m.id === streamingMsgId)

      // 添加错误提示到消息中
      if (msg) {
        const errorMsg = payload.error || 'AI 对话生成失败'

        // 向后兼容：更新 content
        if (!msg.content.trim()) {
          msg.content = `生成失败：${errorMsg}`
        }

        // 新结构：确保 turns 存在并添加错误消息
        if (!msg.turns) {
          msg.turns = []
        }

        if (msg.turns.length === 0) {
          // 没有任何 turn，创建一个显示错误消息
          msg.turns.push({ text: `生成失败：${errorMsg}`, toolCalls: [], editEvents: [] })
        } else {
          const lastTurn = msg.turns[msg.turns.length - 1]

          // 如果最后一个 turn 有工具调用但没有文本，创建新 turn 显示错误消息
          if (lastTurn.toolCalls.length > 0 && !lastTurn.text.trim()) {
            msg.turns.push({ text: `生成失败：${errorMsg}`, toolCalls: [], editEvents: [] })
          } else if (!lastTurn.text.trim()) {
            // 如果最后一个 turn 没有内容，直接设置文本
            lastTurn.text = `生成失败：${errorMsg}`
          }
          // 如果最后一个 turn 已经有文本，不添加新的错误消息
        }

        // 标记为错误状态
        msg.isError = true
      }

      const reject = rejectStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      agentStatus.value = ''
      reject?.(new Error(payload.error || 'AI 对话生成失败'))
    }
  }

  function registerStreamListener(): void {
    if (removeListener) return
    removeListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  function unregisterStreamListener(): void {
    removeListener?.()
    removeListener = null
  }

  function pushMessage(role: ChapterAiRole, content: string): ChapterAiMessage {
    const item: ChapterAiMessage = {
      id: nextMessageId(),
      role,
      content,
      createdAt: Date.now(),
      chapterId: appStore.selectedChapter?.id
    }
    messages.value.push(item)
    return item
  }

  async function send(prompt: string): Promise<void> {
    const trimmed = prompt.trim()
    if (!trimmed) return
    if (isResponding.value) return

    const chapter = appStore.selectedChapter
    if (!chapter) {
      pushMessage('assistant', '请先在左侧选择或新建一个章节，再使用 AI 助手。')
      return
    }

    pushMessage('user', trimmed)
    const assistantMsg = pushMessage('assistant', '')
    streamingMsgId = assistantMsg.id

    const useAgentMode = true

    try {
      await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'chapter-assistant',
          label: 'AI 章节助手',
          description: '与创作助理对话',
          panel: 'chapters',
          timeoutMs: 0
        },
        async () => {
          const currentChapterIndex = appStore.chapters.findIndex((item) => item.id === chapter.id)
          const precedingChapters = appStore.chapters.slice(0, currentChapterIndex)
          const relatedChapters = precedingChapters
            .slice(-4)
            .map((item) => ({
              title: item.title,
              summary: item.summary,
              preview: getChapterPreviewText(item.content ?? '').slice(0, 800)
            }))
          const relatedTitles = new Set(relatedChapters.map((r) => r.title))
          const volumeChapterSummaries = precedingChapters
            .filter((c) => c.volumeId === chapter.volumeId && !relatedTitles.has(c.title))
            .map((c) => ({ title: c.title, summary: c.summary }))
          const firstChapter = appStore.chapters[0]
          const novelOpenerSummary =
            firstChapter && firstChapter.id !== chapter.id && !relatedTitles.has(firstChapter.title)
              ? { title: firstChapter.title, summary: firstChapter.summary }
              : undefined
          const intentHint = buildChapterIntentHint(trimmed, hasSelection.value)
          const userPromptForAi = `${intentHint}\n\n原始用户请求：\n${trimmed}`

          const context = buildChapterAssistantContext({
            project: appStore.currentProject,
            chapter: chapter,
            chapterVolume: appStore.selectedChapterVolume,
            relatedChapters,
            volumeChapterSummaries,
            novelOpenerSummary,
            recentMessages: messages.value
              .slice(-8, -2)
              .map((item) => ({ role: item.role, content: item.content })),
            worldviewEntries: appStore.worldviewEntries,
            characters: appStore.characters,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            inspirationEntries: appStore.inspirationEntries,
            outlineItems: appStore.outlineItems.filter((item) => item.volumeId === chapter.volumeId).slice(0, 6),
            plotThreads: appStore.plotThreads,
            workflowDocuments: [],
            knowledgeDocuments: appStore.projectConstraints,
            selectedText: selectedText.value,
            responseMode: resolveResponseMode(trimmed),
            responseLength: 'medium',
            quickAction: resolveComposerMode(trimmed),
            diffReviewMode: true,
            userPrompt: userPromptForAi,
            chapterContent: ''
          })

          const startFn = useAgentMode
            ? window.characterArc.startAiAgentStream
            : window.characterArc.startAiStream

          const result = await startFn(toIpcPayload({
            task: 'chapter-assistant',
            settings: appStore.appSettings,
            context: { ...context, chapterId: chapter.id, enabledContextModules: Array.from(enabledContextModules) }
          }))

          const sid = (result.result as { streamId?: string } | undefined)?.streamId
          if (!result.success || !sid) {
            throw new Error(result.error ?? 'AI 对话启动失败')
          }
          streamId = sid

          return new Promise<string>((resolve, reject) => {
            resolveStream = resolve
            rejectStream = reject
          })
        }
      )

      if (!assistantMsg.content.trim() && !assistantMsg.toolCalls?.length && !assistantMsg.editEvents?.length) {
        assistantMsg.content = '（AI 未返回内容）'
      }
    } catch (error) {
      const isCanceled = error instanceof Error && error.message === 'canceled'

      // 向后兼容：更新 content
      if (isCanceled) {
        if (!assistantMsg.content.trim()) {
          assistantMsg.content = '已停止生成'
        }
      } else {
        const errorMsg = error instanceof Error ? error.message : '未知错误'
        assistantMsg.content = `生成失败：${errorMsg}`
      }

      // 新结构：添加到 turns
      if (assistantMsg.turns) {
        if (assistantMsg.turns.length === 0) {
          assistantMsg.turns.push({ text: '', toolCalls: [], editEvents: [] })
        }
        const lastTurn = assistantMsg.turns[assistantMsg.turns.length - 1]

        // 如果最后一个 turn 有工具调用但没有文本，创建新 turn 显示错误
        if (lastTurn.toolCalls.length > 0 && !lastTurn.text.trim()) {
          assistantMsg.turns.push({
            text: isCanceled ? '已停止生成' : `生成失败：${error instanceof Error ? error.message : '未知错误'}`,
            toolCalls: [],
            editEvents: []
          })
        } else if (!lastTurn.text.trim()) {
          // 如果最后一个 turn 没有内容，直接设置文本
          lastTurn.text = isCanceled ? '已停止生成' : `生成失败：${error instanceof Error ? error.message : '未知错误'}`
        }
      }

      // 标记消息为错误状态
      assistantMsg.isError = !isCanceled
      assistantMsg.isCanceled = isCanceled
    }

    void saveCurrentSession().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : '保存历史会话失败'
      const existing = messages.value.find((item) => item.role === 'assistant' && item.content === `会话保存失败：${errorMessage}`)
      if (!existing) {
        pushMessage('assistant', `会话保存失败：${errorMessage}`)
      }
    })
  }

  async function stop(): Promise<void> {
    if (!streamId) return
    await window.characterArc.stopAiStream(streamId)
  }

  function resetMessages(): void {
    messages.value = []
  }

  function applyToChapter(content: string, mode: ChapterInsertionMode): boolean {
    return appStore.insertIntoChapter(content, mode)
  }

  const proposalDiffFiles = computed<GlobalAssistantProposalDiffFile[]>(() =>
    pendingEditProposals.value.map((p, index) => {
      const chapterTitle = appStore.chapters.find((chapter) => chapter.id === p.chapterId)?.title ?? '当前章节'
      return {
        id: p.proposalId,
        title: `${chapterTitle} · 修改 ${index + 1}`,
        path: `chapters/${escapeDiffPath(chapterTitle)}-${index + 1}.body`,
        kind: 'chapter' as const,
        action: 'update' as const,
        oldText: stripHtmlForDiff(p.oldContent),
        newText: stripHtmlForDiff(p.newContent),
        reason: p.preview
          ? `${resolveEditOperationLabel(p.editType)} · ${p.preview}`
          : resolveEditOperationLabel(p.editType),
        canApply: true
      }
    })
  )

  const proposalDiffPatch = computed(() => {
    return proposalDiffFiles.value.map((file) => {
      const oldLines = file.oldText ? file.oldText.split('\n') : []
      const newLines = file.newText ? file.newText.split('\n') : []
      const header = [
        `diff --git a/${file.path} b/${file.path}`,
        `index ${file.id.slice(0, 7).padEnd(7, '0')}..proposal 100644`,
        `--- a/${file.path}`,
        `+++ b/${file.path}`,
        `@@ -1,${oldLines.length} +1,${newLines.length} @@`
      ]
      const removed = oldLines.map((line) => `-${line}`)
      const added = newLines.map((line) => `+${line}`)
      return [...header, ...removed, ...added, ''].join('\n')
    }).join('\n')
  })

  const proposalDiffStats = computed(() => ({
    total: pendingEditProposals.value.length,
    creatable: 0,
    updatable: pendingEditProposals.value.length,
    blocked: 0
  }))

  async function acceptEditProposal(proposalId: string): Promise<boolean> {
    const proposal = pendingEditProposals.value.find((p) => p.proposalId === proposalId)
    if (!proposal) return false
    const projectId = appStore.currentProject?.id
    if (!projectId) return false

    const response = await window.characterArc.commitChapterEdit(projectId, proposal.chapterId, proposal.oldContent, proposal.newContent)
    if (!response.success) {
      throw new Error(response.error ?? '章节正文写回失败')
    }
    pendingEditProposals.value = pendingEditProposals.value.filter((p) => p.proposalId !== proposalId)
    void appStore.reloadChapterFromDb(proposal.chapterId)
    return true
  }

  async function acceptAllEditProposals(): Promise<boolean> {
    const projectId = appStore.currentProject?.id
    if (!projectId) return false

    for (const proposal of [...pendingEditProposals.value]) {
      const response = await window.characterArc.commitChapterEdit(projectId, proposal.chapterId, proposal.oldContent, proposal.newContent)
      if (!response.success) {
        throw new Error(response.error ?? `章节正文写回失败：${proposal.preview}`)
      }
      pendingEditProposals.value = pendingEditProposals.value.filter((p) => p.proposalId !== proposal.proposalId)
      void appStore.reloadChapterFromDb(proposal.chapterId)
    }
    return true
  }

  function rejectEditProposal(proposalId: string): void {
    pendingEditProposals.value = pendingEditProposals.value.filter((p) => p.proposalId !== proposalId)
  }

  function clearEditProposals(): void {
    pendingEditProposals.value = []
    showDiffReview.value = false
  }

  return {
    messages,
    isResponding,
    agentStatus,
    hasSelection,
    selectedText,
    enabledContextModules,
    toggleContextModule,
    currentSessionId,
    sessions,
    send,
    stop,
    resetMessages,
    newSession,
    hydrateCurrentSession,
    saveCurrentSession,
    loadSession,
    deleteSession,
    refreshSessions,
    applyToChapter,
    registerStreamListener,
    unregisterStreamListener,
    showDiffReview,
    pendingEditProposals,
    proposalDiffFiles,
    proposalDiffPatch,
    proposalDiffStats,
    acceptEditProposal,
    acceptAllEditProposals,
    rejectEditProposal,
    clearEditProposals
  }
}
