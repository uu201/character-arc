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
import type {
  AssistantEventPush,
  AssistantSession,
  AssistantTurn,
  PersistedTurnEvent,
  StagedChange,
  SurfaceDefinition,
  TurnAttachment,
  TurnEvent
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

export function useAssistant(options: UseAssistantOptions) {
  const A = window.characterArc.assistant

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
  } {
    let assistantMessage = ''
    let reasoning = ''
    const toolCalls: AssistantToolCallView[] = []
    const flowBlocks: AssistantMessageBlock[] = []
    const toolById = new Map<string, AssistantToolCallView>()
    const stagedChangeIds: string[] = []
    let resumable: AssistantMessageView['resumable']
    let finalError: string | undefined
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
          stagedChangeIds.push(evt.changeId)
          break
        case 'resumable':
          resumable = {
            label: evt.label,
            prompt: evt.prompt,
            reason: evt.reason
          }
          break
        case 'agent_status': {
          const last = flowBlocks[flowBlocks.length - 1]
          if (last?.kind === 'commands') forceNewCommandBlock = true
          break
        }
        case 'done':
          if (evt.content && !assistantMessage) {
            assistantMessage = evt.content
            appendTextBlock('assistant', evt.seq, evt.content)
          }
          break
        case 'error':
          finalError = evt.error
          break
        default:
          break
      }
    }

    return { assistantMessage, reasoning, toolCalls, flowBlocks, stagedChangeIds, resumable, finalError }
  }

  const messages = computed<AssistantMessageView[]>(() => {
    return turns.value.map((turn) => {
      const events = eventsByTurn.value.get(turn.id) ?? []
      const folded = foldTurnEvents(events)
      const assistantMessage = folded.assistantMessage || turn.assistantMessage
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
        status: turn.status,
        error: folded.finalError,
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
    const list = map.get(turnId) ?? []
    map.set(turnId, [...list, event])
    eventsByTurn.value = map
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
      return
    }
    try {
      const list = await A.sessionList({ projectId: pid, surfaceId: options.surface.id })
      sessions.value = list
      if (!activeSessionId.value && list.length > 0) {
        await switchSession(list[0].id)
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
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
      list.push(evt)
      map.set(p.turnId, list)
    }
    eventsByTurn.value = map
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
    activeSessionId.value = sessionId
    turns.value = []
    eventsByTurn.value = new Map()
    stagedChanges.value = []
    streamingTurnId.value = null
    await Promise.all([reloadTurns(), reloadStaged()])
  }

  async function deleteSession(sessionId: string): Promise<void> {
    await A.sessionDelete({ sessionId })
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
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

    if (composerValue.value.trim() === trimmedText) {
      composerValue.value = ''
    }
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

    try {
      const result = await A.turnSend({
        sessionId,
        surface: options.surface,
        userMessage: trimmedText,
        intentHint: sendOptions.intentHint,
        attachments: sendOptions.attachments
      })
      // 事件流已经在 handler 里做了乐观 turn 的替换 + 状态更新，
      // 这里只兜底：若乐观 turn 依然存在（没有任何事件推来），清理掉。
      const optimisticStill = turns.value.find((t) => t.id === optimisticTurnId)
      if (optimisticStill) {
        turns.value = turns.value.filter((t) => t.id !== optimisticTurnId)
      }
      if (result.error) lastError.value = result.error
    } catch (e) {
      streamingTurnId.value = null
      turns.value = turns.value.filter((t) => t.id !== optimisticTurnId)
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
    if (!streamingTurnId.value || !activeSessionId.value) return
    // 乐观 turn 还没到后端，直接本地撤销
    if (streamingTurnId.value.startsWith('optimistic-')) {
      streamingTurnId.value = null
      return
    }
    await A.turnCancel({
      sessionId: activeSessionId.value,
      turnId: streamingTurnId.value
    })
    streamingTurnId.value = null
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
    const results = await A.stageCommit({ changeIds: ids })
    const errors = results.filter((r) => !r.ok)
    if (errors.length > 0) {
      lastError.value = `${errors.length} 项提交失败：${errors.map((e) => e.error).join('; ')}`
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
    stagedChanges,
    pendingStaged,
    acceptedStaged,
    composerValue,
    lastError,
    // actions
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    send,
    continueWithPrompt,
    cancel,
    acceptChanges,
    rejectChanges,
    commitAccepted,
    bindTarget,
    reloadSessions,
    reloadStaged
  }
}
