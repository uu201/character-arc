import { computed, reactive, ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterAssistantContext } from '@/features/ai/chapterAssistantContext'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { ChapterInsertionMode } from '@/types/app'
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

export type ContextModule = 'chapter' | 'outline' | 'characters' | 'worldview' | 'plotThreads' | 'knowledge' | 'deconstructionLibrary'

const ALL_CONTEXT_MODULES: ContextModule[] = ['chapter', 'outline', 'characters', 'worldview', 'plotThreads', 'knowledge', 'deconstructionLibrary']

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
  saveCurrentSession: () => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  refreshSessions: () => Promise<void>
  applyToChapter: (content: string, mode: ChapterInsertionMode) => boolean
  registerStreamListener: () => void
  unregisterStreamListener: () => void
} {
  const appStore = useAppStore()
  const messages = ref<ChapterAiMessage[]>([])
  const isResponding = computed(() => appStore.isAiTaskRunning(TASK_KEY))
  const agentStatus = ref('')
  const enabledContextModules = reactive(new Set<ContextModule>(ALL_CONTEXT_MODULES))

  function toggleContextModule(mod: ContextModule): void {
    if (enabledContextModules.has(mod)) {
      enabledContextModules.delete(mod)
    } else {
      enabledContextModules.add(mod)
    }
  }

  const currentSessionId = ref<string | null>(null)
  const sessions = ref<SessionSummary[]>([])

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
      sessions.value = result.result
    }
  }

  async function saveCurrentSession(): Promise<void> {
    const projectId = appStore.currentProject?.id
    if (!projectId || messages.value.length === 0) return

    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      throw new Error(appStore.persistenceError)
    }

    if (!currentSessionId.value) {
      currentSessionId.value = generateSessionId()
    }
    const result = await window.characterArc.saveSession(toIpcPayload({
      id: currentSessionId.value,
      projectId,
      title: deriveSessionTitle(),
      messages: messages.value
    }))
    if (!result.success) {
      throw new Error(result.error ?? '保存历史会话失败')
    }
    await refreshSessions()
  }

  async function loadSession(sessionId: string): Promise<void> {
    const result = await window.characterArc.loadSession(sessionId)
    if (!result.success || !result.result) {
      throw new Error(result.error ?? '加载历史会话失败')
    }
    currentSessionId.value = result.result.id
    messages.value = result.result.messages as ChapterAiMessage[]
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const result = await window.characterArc.deleteSession(sessionId)
    if (!result.success) {
      throw new Error(result.error ?? '删除历史会话失败')
    }
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = null
      messages.value = []
    }
    await refreshSessions()
  }

  function newSession(): void {
    currentSessionId.value = null
    messages.value = []
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
            knowledgeDocuments: [],
            selectedText: selectedText.value,
            responseMode: 'freeform',
            responseLength: 'medium',
            userPrompt: trimmed,
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
    saveCurrentSession,
    loadSession,
    deleteSession,
    refreshSessions,
    applyToChapter,
    registerStreamListener,
    unregisterStreamListener
  }
}
