/**
 * useAssistant · Runtime v2 通用 composable
 *
 * 取代旧的 useGlobalAssistant / useChapterAi 双套实现。所有 Surface（global-page /
 * chapter-panel / inline-selection）共享同一份 composable，通过 SurfaceDefinition 区分行为。
 *
 * 完全绕开 appStore.messages / globalAssistantSessions —— 消息、会话、暂存变更
 * 全部由 Runtime v2 IPC 提供，前端只做响应式转换和渲染。
 */

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import type {
  AssistantEventPush,
  AssistantSession,
  AssistantTurn,
  PersistedTurnEvent,
  StagedChange,
  SurfaceDefinition,
  TurnAttachment,
  TurnEvent,
  TurnTruncateResult
} from '@shared/assistant-runtime'

// ============================================================================
// UI 消息模型
// ============================================================================

export interface AssistantToolCallView {
  toolUseId: string
  toolName: string
  args: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  resultPreview?: string
  durationMs?: number
}

export type AssistantMessageBlock =
  | {
      id: string
      kind: 'reasoning' | 'assistant'
      content: string
    }
  | {
      id: string
      kind: 'commands'
      commands: AssistantToolCallView[]
    }
  | {
      id: string
      kind: 'staged'
      changeIds: string[]
    }

export interface AssistantMessageView {
  turnId: string
  userMessage: string
  assistantMessage: string
  reasoning: string
  toolCalls: AssistantToolCallView[]
  flowBlocks: AssistantMessageBlock[]
  stagedChangeIds: string[]
  resumable?: {
    label: string
    prompt: string
    reason?: string
  }
  status: 'streaming' | 'done' | 'canceled' | 'error'
  error?: string
  activityText?: string
  createdAt: string
}

// ============================================================================
// composable
// ============================================================================

export interface UseAssistantOptions {
  /** 项目 ID。响应式引用；切项目时会自动刷新会话列表。 */
  projectId: () => string
  /** 该 Surface 的声明。 */
  surface: SurfaceDefinition
  /** 上下文锚点，如 'chapter:cha_042'；切换章节时会刷新。 */
  scopeRef?: () => string | undefined
}

export interface AssistantSendOptions {
  intentHint?: string
  attachments?: TurnAttachment[]
}

const MAX_ERROR_LENGTH = 1200

function trimErrorText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_ERROR_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ERROR_LENGTH - 1)}…`
}

/** IPC / 历史回放的错误字段理论上是 string，但 SDK 可能返回普通对象。 */
function formatAssistantError(error: unknown, seen = new Set<object>()): string {
  if (typeof error === 'string') return trimErrorText(error)
  if (error instanceof Error) {
    const message = error.message.trim()
    if (message && message !== '[object Object]') return trimErrorText(message)
  }

  if (error && typeof error === 'object') {
    if (seen.has(error)) return ''
    seen.add(error)
    const record = error as Record<string, unknown>
    for (const key of ['error', 'message', 'detail', 'msg', 'description', 'responseBody', 'response_body', 'data', 'body']) {
      const nested = record[key]
      if (typeof nested === 'string' && nested.trim()) return trimErrorText(nested)
      if (nested && typeof nested === 'object') {
        const nestedText = formatAssistantError(nested, seen)
        if (nestedText) return nestedText
      }
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return trimErrorText(serialized)
    } catch {
      // Ignore circular error objects and use the generic fallback below.
    }
  }

  return '助手请求失败'
}

export function useAssistant(options: UseAssistantOptions) {
  const A = window.characterArc.assistant
  const appStore = useAppStore()

  // === 会话 ===
  const sessions = ref<AssistantSession[]>([])
  const activeSessionId = ref<string | null>(null)
  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null
  )

  // === Turn 序列 + 事件流 ===
  const turns = shallowRef<AssistantTurn[]>([])
  // 每个 turn 累积的事件；用于 replay 和消息 view 计算
  const eventsByTurn = shallowRef<Map<string, TurnEvent[]>>(new Map())

  // === Streaming 状态 ===
  const streamingTurnId = ref<string | null>(null)
  const isStreaming = computed(() => streamingTurnId.value !== null)
  const isCanceling = ref(false)

  // 流式生成时已累积的 assistant 文字数（用于 Composer 进度提示）
  const streamingCharCount = computed(() => {
    if (!streamingTurnId.value) return 0
    const events = eventsByTurn.value.get(streamingTurnId.value) ?? []
    return events.reduce((sum, e) => (e.kind === 'chunk' ? sum + (e.delta?.length ?? 0) : sum), 0)
  })

  // === 初始化加载状态 ===
  const isInitializing = ref(true)

  // === 暂存变更 ===
  const stagedChanges = ref<StagedChange[]>([])
  const pendingStaged = computed(() =>
    stagedChanges.value.filter((c) => c.status === 'pending' || c.status === 'streaming')
  )
  const acceptedStaged = computed(() =>
    stagedChanges.value.filter((c) => c.status === 'accepted')
  )

  // === Composer ===
  const composerValue = ref('')
  const editingTurnId = ref<string | null>(null)
  const editingDraft = ref('')
  const restoredDraftLabel = ref('')
  const isTruncating = ref(false)

  // === 错误 ===
  const lastError = ref<string | null>(null)

  // ==========================================================================
  // 事件 → 消息 view 转换
  // ==========================================================================

  /** 从事件序列中折叠出 assistant 文本、reasoning、工具调用。 */
  function foldTurnEvents(events: TurnEvent[]): {
    assistantMessage: string
    reasoning: string
    toolCalls: AssistantToolCallView[]
    flowBlocks: AssistantMessageBlock[]
    stagedChangeIds: string[]
    resumable?: AssistantMessageView['resumable']
    finalError?: string
    activityText?: string
  } {
    let assistantMessage = ''
    let reasoning = ''
    const toolCalls: AssistantToolCallView[] = []
    const flowBlocks: AssistantMessageBlock[] = []
    const toolById = new Map<string, AssistantToolCallView>()
    const stagedChangeIds: string[] = []
    let resumable: AssistantMessageView['resumable']
    let finalError: string | undefined
    let activityText: string | undefined
    let forceNewCommandBlock = false

    function appendTextBlock(kind: 'reasoning' | 'assistant', seq: number, delta: string): void {
      forceNewCommandBlock = false
      const last = flowBlocks[flowBlocks.length - 1]
      if (last?.kind === kind) {
        last.content += delta
        return
      }
      flowBlocks.push({
        id: `${kind}-${seq}`,
        kind,
        content: delta
      })
    }

    function appendCommand(call: AssistantToolCallView, seq: number): void {
      const last = flowBlocks[flowBlocks.length - 1]
      if (last?.kind === 'commands' && !forceNewCommandBlock) {
        last.commands.push(call)
        forceNewCommandBlock = false
        return
      }
      flowBlocks.push({
        id: `commands-${seq}`,
        kind: 'commands',
        commands: [call]
      })
      forceNewCommandBlock = false
    }

    function appendStaged(changeId: string, seq: number): void {
      const last = flowBlocks[flowBlocks.length - 1]
      if (last?.kind === 'staged') {
        if (!last.changeIds.includes(changeId)) last.changeIds.push(changeId)
        return
      }
      flowBlocks.push({ id: `staged-${seq}`, kind: 'staged', changeIds: [changeId] })
    }

    function normalizeActivity(message: string): string {
      const normalized = message.trim()
      if (/整理最终答案/.test(normalized)) return '整理回复'
      if (/第\s*\d+\s*轮推理/.test(normalized)) return '核对资料与工具结果'
      if (/思考|分析/.test(normalized)) return '分析请求'
      return normalized.replace(/[.。…]+$/, '') || '处理中'
    }

    for (const evt of events) {
      switch (evt.kind) {
        case 'chunk':
          assistantMessage += evt.delta
          appendTextBlock('assistant', evt.seq, evt.delta)
          break
        case 'reasoning':
          reasoning += evt.delta
          appendTextBlock('reasoning', evt.seq, evt.delta)
          break
        case 'tool_use_start': {
          const call: AssistantToolCallView = {
            toolUseId: evt.toolUseId,
            toolName: evt.toolName,
            args: evt.args,
            status: 'running'
          }
          toolCalls.push(call)
          toolById.set(evt.toolUseId, call)
          appendCommand(call, evt.seq)
          break
        }
        case 'tool_result': {
          const existing = toolById.get(evt.toolUseId)
          if (existing) {
            existing.status = evt.isError ? 'error' : 'ok'
            existing.resultPreview = evt.content.slice(0, 200)
            existing.durationMs = evt.durationMs
          }
          break
        }
        case 'staged_change':
          if (!stagedChangeIds.includes(evt.changeId)) stagedChangeIds.push(evt.changeId)
          appendStaged(evt.changeId, evt.seq)
          break
        case 'resumable':
          if (options.surface.scope === 'project') break
          resumable = {
            label: evt.label,
            prompt: evt.prompt,
            reason: evt.reason
          }
          break
        case 'agent_status': {
          const last = flowBlocks[flowBlocks.length - 1]
          if (last?.kind === 'commands') forceNewCommandBlock = true
          activityText = normalizeActivity(evt.message)
          break
        }
        case 'done':
          if (evt.content && !assistantMessage) {
            assistantMessage = evt.content
            appendTextBlock('assistant', evt.seq, evt.content)
          }
          break
        case 'error':
          finalError = formatAssistantError(evt.error)
          break
        default:
          break
      }
    }

    return { assistantMessage, reasoning, toolCalls, flowBlocks, stagedChangeIds, resumable, finalError, activityText }
  }

  const messages = computed<AssistantMessageView[]>(() => {
    return turns.value.map((turn) => {
      const events = eventsByTurn.value.get(turn.id) ?? []
      const folded = foldTurnEvents(events)
      const assistantMessage = folded.assistantMessage || turn.assistantMessage
      const status = turn.status === 'streaming' && streamingTurnId.value !== turn.id
        ? 'canceled'
        : turn.status
      const flowBlocks = folded.flowBlocks.length > 0
        ? folded.flowBlocks
        : assistantMessage
          ? [{ id: `assistant-${turn.id}`, kind: 'assistant' as const, content: assistantMessage }]
          : []
      return {
        turnId: turn.id,
        userMessage: turn.userMessage,
        assistantMessage,
        reasoning: folded.reasoning,
        toolCalls: folded.toolCalls,
        flowBlocks,
        stagedChangeIds: folded.stagedChangeIds,
        resumable: folded.resumable,
        status,
        error: folded.finalError,
        activityText: status === 'streaming' ? folded.activityText : undefined,
        createdAt: turn.createdAt
      }
    })
  })

  // ==========================================================================
  // 事件订阅
  // ==========================================================================

  /** 把 PersistedTurnEvent（含 payloadJson）转成 TurnEvent 结构。 */
  function persistedToEvent(p: PersistedTurnEvent): TurnEvent {
    try {
      return JSON.parse(p.payloadJson) as TurnEvent
    } catch {
      return { kind: p.kind, seq: p.seq } as TurnEvent
    }
  }

  function appendEventToTurn(turnId: string, event: TurnEvent): void {
    const map = new Map(eventsByTurn.value)
    const list = [...(map.get(turnId) ?? [])]
    appendCoalescedEvent(list, event)
    map.set(turnId, list)
    eventsByTurn.value = map
  }

  /** 合并相邻文本事件，避免长回复按 token 累积成数千个响应式节点。 */
  function appendCoalescedEvent(list: TurnEvent[], event: TurnEvent): void {
    const last = list[list.length - 1]
    if (last?.kind === 'chunk' && event.kind === 'chunk') {
      list[list.length - 1] = { ...last, delta: last.delta + event.delta }
      return
    }
    if (last?.kind === 'reasoning' && event.kind === 'reasoning') {
      list[list.length - 1] = { ...last, delta: last.delta + event.delta }
      return
    }
    list.push(event)
  }

  const unsubscribe = A.onEvent((push: AssistantEventPush) => {
    if (push.sessionId !== activeSessionId.value) return

    // 首次遇到真实 turnId 时：把乐观 turn 替换为真实 placeholder，让后续
    // chunk 事件能挂到正确的 turn 上，UI 才能实时渲染流式内容。
    const knownTurn = turns.value.find((t) => t.id === push.turnId)
    if (!knownTurn) {
      const optimisticIdx = turns.value.findIndex((t) => t.id.startsWith('optimistic-'))
      const userMessage = optimisticIdx >= 0 ? turns.value[optimisticIdx].userMessage : ''
      const placeholder: AssistantTurn = {
        id: push.turnId,
        sessionId: push.sessionId,
        userMessage,
        assistantMessage: '',
        status: 'streaming',
        createdAt: new Date().toISOString()
      }
      if (optimisticIdx >= 0) {
        const arr = [...turns.value]
        arr[optimisticIdx] = placeholder
        turns.value = arr
      } else {
        turns.value = [...turns.value, placeholder]
      }
      streamingTurnId.value = push.turnId
    }

    appendEventToTurn(push.turnId, push.event)

    // 终态事件：更新 turn 状态但不需要 reload（本地已经累积好）
    if (push.event.kind === 'done' || push.event.kind === 'error' || push.event.kind === 'canceled') {
      const nextStatus =
        push.event.kind === 'done' ? 'done'
        : push.event.kind === 'canceled' ? 'canceled'
        : 'error'
      turns.value = turns.value.map((t) =>
        t.id === push.turnId ? { ...t, status: nextStatus } : t
      )
      if (streamingTurnId.value === push.turnId) streamingTurnId.value = null
      isCanceling.value = false
    } else if (turns.value.find((turn) => turn.id === push.turnId)?.status === 'streaming') {
      streamingTurnId.value = push.turnId
    }

    // 暂存变更相关：任一 staged_change 事件都重拉一次 stageList，保持简单可靠
    if (push.event.kind === 'staged_change' || push.event.kind === 'staged_change_updated') {
      void reloadStaged()
    }
  })

  onBeforeUnmount(() => {
    unsubscribe()
  })

  // ==========================================================================
  // 数据拉取
  // ==========================================================================

  async function reloadSessions(): Promise<void> {
    const pid = options.projectId()
    if (!pid) {
      sessions.value = []
      isInitializing.value = false
      return
    }
    const scopeRef = options.scopeRef?.()
    if (options.scopeRef && !scopeRef) {
      sessions.value = []
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      streamingTurnId.value = null
      cancelEditing()
      restoredDraftLabel.value = ''
      isInitializing.value = false
      return
    }
    isInitializing.value = true
    try {
      const list = await A.sessionList({ projectId: pid, surfaceId: options.surface.id, scopeRef })
      sessions.value = list
      if (!activeSessionId.value && list.length > 0) {
        await switchSession(list[0].id)
      } else {
        // 没有会话时也标记加载完成
        isInitializing.value = false
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      isInitializing.value = false
    }
  }

  async function reloadTurns(): Promise<void> {
    if (!activeSessionId.value) return
    const loaded = await A.sessionLoad({
      sessionId: activeSessionId.value,
      withReplay: true
    })
    turns.value = loaded.turns

    // 用 replay 事件重建 eventsByTurn（覆盖，保证与后端一致）
    const map = new Map<string, TurnEvent[]>()
    for (const p of loaded.events) {
      const evt = persistedToEvent(p)
      const list = map.get(p.turnId) ?? []
      appendCoalescedEvent(list, evt)
      map.set(p.turnId, list)
    }
    eventsByTurn.value = map
    streamingTurnId.value = [...loaded.turns].reverse().find((turn) => turn.status === 'streaming')?.id ?? null
    isCanceling.value = false

    // 首次加载完成
    isInitializing.value = false
  }

  async function reloadStaged(): Promise<void> {
    if (!activeSessionId.value) return
    try {
      const list = await A.stageList({ sessionId: activeSessionId.value })
      stagedChanges.value = list
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    }
  }

  // ==========================================================================
  // 会话操作
  // ==========================================================================

  async function createSession(title?: string): Promise<AssistantSession | null> {
    if (isStreaming.value) {
      lastError.value = '请先停止当前生成，再新建会话。'
      return null
    }
    const pid = options.projectId()
    if (!pid) return null
    const session = await A.sessionCreate({
      projectId: pid,
      surfaceId: options.surface.id,
      scopeRef: options.scopeRef?.(),
      title: title || `新会话 · ${new Date().toLocaleString()}`
    })
    sessions.value = [session, ...sessions.value]
    await switchSession(session.id)
    return session
  }

  async function switchSession(sessionId: string): Promise<void> {
    if (isStreaming.value && sessionId !== activeSessionId.value) {
      lastError.value = '请先停止当前生成，再切换会话。'
      return
    }
    activeSessionId.value = sessionId
    turns.value = []
    eventsByTurn.value = new Map()
    stagedChanges.value = []
    streamingTurnId.value = null
    isCanceling.value = false
    cancelEditing()
    restoredDraftLabel.value = ''
    await Promise.all([reloadTurns(), reloadStaged()])
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (isStreaming.value) {
      lastError.value = '请先停止当前生成，再删除会话。'
      return
    }
    await A.sessionDelete({ sessionId })
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      cancelEditing()
      restoredDraftLabel.value = ''
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].id)
      }
    }
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    await A.sessionRename({ sessionId, title })
    sessions.value = sessions.value.map((s) =>
      s.id === sessionId ? { ...s, title } : s
    )
  }

  /** 会话标题是否仍是系统默认值（未被用户或自动摘要覆盖）。 */
  function isDefaultTitle(title: string): boolean {
    return !title || title.startsWith('新会话')
  }

  /** 从用户首条提问摘要出简短会话标题。 */
  function deriveSessionTitle(text: string): string {
    // 压平空白，取首句（中英文标点断句），再截断到合理长度
    const flat = text.replace(/\s+/g, ' ').trim()
    const firstSentence = flat.split(/[。！？.!?\n]/)[0]?.trim() || flat
    const base = firstSentence || flat
    const MAX = 18
    return base.length > MAX ? base.slice(0, MAX) + '…' : base
  }

  // ==========================================================================
  // Turn 操作
  // ==========================================================================

  async function sendText(text: string, sendOptions: AssistantSendOptions = {}): Promise<void> {
    const trimmedText = text.trim()
    if (!trimmedText || isStreaming.value) return
    let sessionId = activeSessionId.value
    if (!sessionId) {
      const session = await createSession(deriveSessionTitle(trimmedText))
      if (!session) return
      sessionId = session.id
    } else {
      // 已有会话但仍是默认标题（如通过"新建对话"按钮创建）：用首条提问摘要覆盖
      const current = sessions.value.find((s) => s.id === sessionId)
      if (current && isDefaultTitle(current.title)) {
        void renameSession(sessionId, deriveSessionTitle(trimmedText))
      }
    }

    if (!await appStore.flushAppSettings()) {
      lastError.value = appStore.persistenceError ?? 'AI 设置保存失败，未发送本次请求。'
      return
    }

    if (composerValue.value.trim() === trimmedText) {
      composerValue.value = ''
    }
    restoredDraftLabel.value = ''
    lastError.value = null

    // 先乐观塞一个 streaming turn（真实 turnId 由后端事件确认）
    const optimisticTurnId = `optimistic-${Date.now()}`
    turns.value = [
      ...turns.value,
      {
        id: optimisticTurnId,
        sessionId,
        userMessage: trimmedText,
        assistantMessage: '',
        status: 'streaming',
        createdAt: new Date().toISOString()
      }
    ]
    streamingTurnId.value = optimisticTurnId
    isCanceling.value = false

    try {
      const result = await A.turnSend({
        sessionId,
        clientRequestId: optimisticTurnId,
        surface: options.surface,
        scopeRef: options.scopeRef?.(),
        userMessage: trimmedText,
        intentHint: sendOptions.intentHint,
        attachments: sendOptions.attachments
      })
      // 事件流已经在 handler 里做了乐观 turn 的替换 + 状态更新，
      // 这里只兜底：若乐观 turn 依然存在（没有任何事件推来），清理掉。
      const optimisticStill = turns.value.find((t) => t.id === optimisticTurnId)
      if (optimisticStill) {
        turns.value = turns.value.filter((t) => t.id !== optimisticTurnId)
        if (streamingTurnId.value === optimisticTurnId) streamingTurnId.value = null
      }
      if (result.error) lastError.value = result.error
    } catch (e) {
      streamingTurnId.value = null
      isCanceling.value = false
      turns.value = turns.value.filter((t) => t.id !== optimisticTurnId)
      if (!composerValue.value.trim()) composerValue.value = trimmedText
      lastError.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function send(sendOptions: AssistantSendOptions = {}): Promise<void> {
    await sendText(composerValue.value, sendOptions)
  }

  async function continueWithPrompt(prompt: string): Promise<void> {
    await sendText(prompt, {
      intentHint: `assistant-v2:continue`
    })
  }

  async function cancel(): Promise<void> {
    if (!streamingTurnId.value || !activeSessionId.value || isCanceling.value) return
    isCanceling.value = true
    try {
      const result = await A.turnCancel({
        sessionId: activeSessionId.value,
        turnId: streamingTurnId.value
      })
      if (!result.ok) {
        isCanceling.value = false
        lastError.value = result.reason || '当前生成未能停止，请稍后重试。'
      }
    } catch (error) {
      isCanceling.value = false
      lastError.value = error instanceof Error ? error.message : '停止生成失败'
    }
  }

  function startEditingTurn(turnId: string): void {
    if (isStreaming.value || isTruncating.value) {
      lastError.value = '请先停止当前生成，再编辑历史对话。'
      return
    }
    const turn = turns.value.find((item) => item.id === turnId)
    if (!turn) return
    editingTurnId.value = turnId
    editingDraft.value = turn.userMessage
    restoredDraftLabel.value = ''
    lastError.value = null
  }

  function startEditingLastTurn(): void {
    const last = turns.value[turns.value.length - 1]
    if (last) startEditingTurn(last.id)
  }

  function updateEditingDraft(value: string): void {
    editingDraft.value = value
  }

  function cancelEditing(): void {
    editingTurnId.value = null
    editingDraft.value = ''
  }

  function clearRestoredDraft(): void {
    composerValue.value = ''
    restoredDraftLabel.value = ''
  }

  async function truncateTurn(turnId: string): Promise<TurnTruncateResult | null> {
    const sessionId = activeSessionId.value
    if (!sessionId || isStreaming.value || isTruncating.value) {
      if (isStreaming.value) lastError.value = '请先停止当前生成，再撤回或编辑历史对话。'
      return null
    }

    isTruncating.value = true
    try {
      const result = await A.turnTruncate({ sessionId, fromTurnId: turnId })
      const removed = new Set(result.removedTurnIds)
      turns.value = turns.value.filter((turn) => !removed.has(turn.id))

      const nextEvents = new Map(eventsByTurn.value)
      for (const removedTurnId of removed) nextEvents.delete(removedTurnId)
      eventsByTurn.value = nextEvents
      stagedChanges.value = stagedChanges.value.filter((change) => !removed.has(change.turnId))
      await reloadStaged()
      lastError.value = null
      return result
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '撤回对话失败'
      return null
    } finally {
      isTruncating.value = false
    }
  }

  async function undoTurn(turnId: string): Promise<TurnTruncateResult | null> {
    const index = turns.value.findIndex((turn) => turn.id === turnId)
    if (index < 0 || index !== turns.value.length - 1) {
      lastError.value = '只能撤回最后一轮对话。'
      return null
    }
    const result = await truncateTurn(turnId)
    if (!result) return null
    cancelEditing()
    composerValue.value = result.restoredUserMessage
    restoredDraftLabel.value = `已回填 · 撤回的第 ${index + 1} 轮原文`
    return result
  }

  async function resendEditedTurn(
    sendOptions: AssistantSendOptions = {}
  ): Promise<TurnTruncateResult | null> {
    const turnId = editingTurnId.value
    const draft = editingDraft.value.trim()
    if (!turnId || !draft) return null

    const result = await truncateTurn(turnId)
    if (!result) return null
    cancelEditing()
    composerValue.value = draft
    void sendText(draft, sendOptions)
    return result
  }

  // ==========================================================================
  // 暂存变更操作
  // ==========================================================================

  async function acceptChanges(ids: string[]): Promise<void> {
    await A.stageAccept({ changeIds: ids })
    await reloadStaged()
  }

  async function rejectChanges(ids: string[]): Promise<void> {
    await A.stageReject({ changeIds: ids })
    await reloadStaged()
  }

  async function commitAccepted(ids?: string[]): Promise<{ committed: number; failed: number }> {
    if (!activeSessionId.value) return { committed: 0, failed: 0 }
    const expectedAcceptedCount = ids?.length
      ? stagedChanges.value.filter((change) =>
        ids.includes(change.id) && change.status === 'accepted'
      ).length
      : acceptedStaged.value.length
    const results = await A.stageCommit({
      sessionId: activeSessionId.value,
      changeIds: ids
    })
    const errors = results.filter((r) => !r.ok)
    if (results.length === 0 && expectedAcceptedCount > 0) {
      lastError.value = '没有变更被写回：暂存区状态可能已过期，请刷新后重试。'
    } else if (errors.length > 0) {
      lastError.value = `${errors.length} 项提交失败：${errors.map((e) => e.error).join('; ')}`
    } else {
      lastError.value = null
    }
    await reloadStaged()
    return { committed: results.length - errors.length, failed: errors.length }
  }

  async function bindTarget(changeId: string, entityId: string): Promise<void> {
    await A.stageBindTarget({ changeId, entityId })
    await reloadStaged()
  }

  // ==========================================================================
  // 生命周期
  // ==========================================================================

  // projectId 变化 → 重新拉会话列表
  watch(
    () => options.projectId(),
    async () => {
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      streamingTurnId.value = null
      cancelEditing()
      restoredDraftLabel.value = ''
      await reloadSessions()
    },
    { immediate: true }
  )

  // scopeRef 变化（切换章节）→ 重新拉会话列表
  if (options.scopeRef) {
    watch(
      () => options.scopeRef!(),
      async (newRef, oldRef) => {
        if (newRef !== oldRef) {
          activeSessionId.value = null
          turns.value = []
          eventsByTurn.value = new Map()
          stagedChanges.value = []
          streamingTurnId.value = null
          cancelEditing()
          restoredDraftLabel.value = ''
          await reloadSessions()
        }
      }
    )
  }

  return {
    // state
    sessions,
    activeSessionId,
    activeSession,
    messages,
    isStreaming,
    isCanceling,
    isInitializing,
    streamingCharCount,
    stagedChanges,
    pendingStaged,
    acceptedStaged,
    composerValue,
    editingTurnId,
    editingDraft,
    restoredDraftLabel,
    isTruncating,
    lastError,
    // actions
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    send,
    continueWithPrompt,
    cancel,
    startEditingTurn,
    startEditingLastTurn,
    updateEditingDraft,
    cancelEditing,
    clearRestoredDraft,
    undoTurn,
    resendEditedTurn,
    acceptChanges,
    rejectChanges,
    commitAccepted,
    bindTarget,
    reloadSessions,
    reloadStaged
  }
}
