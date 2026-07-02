/**
 * Assistant Runtime v2 · IPC 层
 *
 * 注册 `characterarc:assistant:*` 命名空间下的全部通道。
 * 与旧的 `characterarc:ai:*` 并存互不影响，Phase 3 迁移完毕后合并。
 *
 * Phase 1 阶段：Session / Stage 类通道全部就绪；Turn 类通道需要
 * `resolveTurnExecutionPlan` + `commitChange` 依赖，由 Phase 2 注入。
 * 未注入时相关通道返回明确错误，不静默失败。
 */

import { ipcMain } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import {
  ASSISTANT_IPC_CHANNELS,
  type AssistantEventPush,
  type AssistantSession,
  type StageAcceptRequest,
  type StageBindTargetRequest,
  type StageCommitRequest,
  type StageRejectRequest,
  type SurfaceDefinition,
  type TurnCancelRequest,
  type TurnSendRequest
} from '@shared/assistant-runtime'
import type { AppSettings } from '../shared-types'
import type { Tool } from '../agent/tools/types'
import type { ConversationManager } from './conversation-manager'
import { stagedChangesStore, type StagedChangeCommitter } from './staged-changes-store'
import { AgentLoop, type ToolFactory } from './agent-loop'
import { configureRuntimeState, getSharedConversation } from './state'

/** Phase 2 才注入的执行计划解析器：把 Surface + user request → prompt + tools。 */
export type ResolveTurnExecutionPlan = (params: {
  session: AssistantSession
  surface: SurfaceDefinition
  request: TurnSendRequest
}) => Promise<{
  systemPrompt: string
  /**
   * 工具集。可给静态数组或工厂函数——工厂会在 Turn 创建后收到 turnId 再构造，
   * 让 `stage_*` 工具能闭包捕获 turnId/sessionId。
   */
  tools: Tool[] | ToolFactory
  settings: AppSettings
  maxOutputTokens?: number
}>

/** 外部依赖注入。 */
export interface AssistantIpcDeps {
  /** 惰性拿到 workspace db。首次调用时会 ensure schema。 */
  ensureDb: () => Promise<DatabaseSync>
  /** Phase 2 注入。缺省时 turn 相关通道拒绝服务。 */
  resolveTurnExecutionPlan?: ResolveTurnExecutionPlan
  /** Phase 2 注入。缺省时 stage:commit 通道拒绝服务。 */
  commitChange?: StagedChangeCommitter
}

// ============================================================================
// 模块状态
// ============================================================================

let deps: AssistantIpcDeps | null = null

/** 每个 in-flight turn 的 AbortController，用于 TURN_CANCEL。 */
const activeTurns = new Map<string, AbortController>()

/**
 * 惰性拿到 ConversationManager 单例。委托给 runtime-v2/state.ts 的共享实例。
 * committer / provider / plan 等模块可通过 `getSharedConversation` 拿同一份。
 */
export async function getConversation(): Promise<ConversationManager> {
  return getSharedConversation()
}

/** 抛清晰错误：Phase 2 依赖未注入。 */
function requireDep<K extends keyof AssistantIpcDeps>(
  key: K
): NonNullable<AssistantIpcDeps[K]> {
  const value = deps?.[key]
  if (!value) {
    throw new Error(
      `[Assistant Runtime v2] dependency "${String(key)}" not injected yet. ` +
        `This channel becomes available after Phase 2 wiring.`
    )
  }
  return value as NonNullable<AssistantIpcDeps[K]>
}

// ============================================================================
// 注册入口
// ============================================================================

export function registerAssistantIpcHandlers(injected: AssistantIpcDeps): void {
  deps = injected
  configureRuntimeState(injected.ensureDb)
  registerSessionHandlers()
  registerTurnHandlers()
  registerStageHandlers()
}

// ============================================================================
// Session handlers
// ============================================================================

interface SessionListRequest {
  projectId: string
  surfaceId?: string
  scopeRef?: string
  limit?: number
}
interface SessionCreateRequest {
  projectId: string
  surfaceId: string
  scopeRef?: string
  title: string
}
interface SessionDeleteRequest { sessionId: string }
interface SessionLoadRequest { sessionId: string; withReplay?: boolean }
interface SessionRenameRequest { sessionId: string; title: string }

function registerSessionHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_LIST,
    async (_event, payload: SessionListRequest) => {
      const cm = await getConversation()
      return cm.listSessions({
        projectId: payload.projectId,
        surfaceId: payload.surfaceId as never,
        scopeRef: payload.scopeRef,
        limit: payload.limit
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_CREATE,
    async (_event, payload: SessionCreateRequest) => {
      const cm = await getConversation()
      return cm.createSession({
        projectId: payload.projectId,
        surfaceId: payload.surfaceId as never,
        scopeRef: payload.scopeRef,
        title: payload.title
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_DELETE,
    async (_event, payload: SessionDeleteRequest) => {
      const cm = await getConversation()
      cm.deleteSession(payload.sessionId)
      stagedChangesStore.clearSession(payload.sessionId)
      return { ok: true }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_LOAD,
    async (_event, payload: SessionLoadRequest) => {
      const cm = await getConversation()
      const session = cm.getSession(payload.sessionId)
      if (!session) return { session: null, turns: [], events: [] }
      const turns = cm.listTurns(payload.sessionId)
      // withReplay=true 时把每个 turn 的完整事件流也一起返回，供前端还原状态
      const events = payload.withReplay
        ? turns.flatMap((t) => cm.listEvents(t.id))
        : []
      return { session, turns, events }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_RENAME,
    async (_event, payload: SessionRenameRequest) => {
      const cm = await getConversation()
      cm.renameSession(payload.sessionId, payload.title)
      return { ok: true }
    }
  )
}

// ============================================================================
// Turn handlers（含流式事件推送）
// ============================================================================

function registerTurnHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.TURN_SEND,
    async (event, payload: TurnSendRequest) => {
      const resolvePlan = requireDep('resolveTurnExecutionPlan')
      const cm = await getConversation()
      const session = cm.getSession(payload.sessionId)
      if (!session) throw new Error(`session not found: ${payload.sessionId}`)

      // 组装执行计划（Phase 2 实现），拿到 systemPrompt + tools + settings
      const plan = await resolvePlan({
        session,
        surface: payload.surface,
        request: payload
      })

      // Emitter：把 TurnEvent 通过 EVENT_STREAM 通道 push 到发起方 window
      const emitter = (evt: AssistantEventPush): void => {
        try {
          event.sender.send(ASSISTANT_IPC_CHANNELS.EVENT_STREAM, evt)
        } catch {
          // renderer 已销毁则忽略
        }
      }

      // 每个 turn 一个 AbortController，供 TURN_CANCEL 取消
      const controller = new AbortController()

      const loop = new AgentLoop(cm, stagedChangesStore, emitter)
      const result = await loop.run({
        session,
        surface: payload.surface,
        turnInput: {
          userMessage: payload.userMessage,
          intentHint: payload.intentHint,
          attachments: payload.attachments
        },
        systemPrompt: plan.systemPrompt,
        tools: plan.tools,
        settings: plan.settings,
        signal: controller.signal,
        maxSteps: payload.surface.maxSteps,
        maxOutputTokens: plan.maxOutputTokens,
        onTurnCreated: (turnId) => activeTurns.set(turnId, controller)
      })
      activeTurns.delete(result.turnId)
      return result
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.TURN_CANCEL,
    async (_event, payload: TurnCancelRequest) => {
      const controller = activeTurns.get(payload.turnId)
      if (!controller) return { ok: false, reason: 'turn not active or already finished' }
      controller.abort()
      activeTurns.delete(payload.turnId)
      return { ok: true }
    }
  )
}

// ============================================================================
// Stage handlers
// ============================================================================

interface StageListRequest {
  sessionId?: string
  status?: readonly string[]
  kind?: readonly string[]
  turnId?: string
}

function registerStageHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_LIST,
    async (_event, payload: StageListRequest) => {
      return stagedChangesStore.list(
        {
          status: payload.status as never,
          kind: payload.kind as never,
          turnId: payload.turnId
        },
        payload.sessionId
      )
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_ACCEPT,
    async (_event, payload: StageAcceptRequest) => {
      return stagedChangesStore.accept(payload.changeIds)
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_REJECT,
    async (_event, payload: StageRejectRequest) => {
      return stagedChangesStore.reject(payload.changeIds)
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_BIND_TARGET,
    async (_event, payload: StageBindTargetRequest) => {
      const updated = stagedChangesStore.bindTarget(payload.changeId, payload.entityId)
      return updated ?? null
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_COMMIT,
    async (_event, payload: StageCommitRequest) => {
      const committer = requireDep('commitChange')
      return stagedChangesStore.commit(committer, {
        changeIds: payload.changeIds
      })
    }
  )
}
