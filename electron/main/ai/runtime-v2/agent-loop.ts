/**
 * AgentLoop · Runtime v2 单一执行入口
 *
 * 取代旧 `streamAiTask` 中按 task 分叉的 switch。这里只做三件事：
 *   1. 创建 Turn，进入 streaming 状态
 *   2. 桥接 `runAgent` 的 handlers → TurnEvent 双写（落盘 + 推流）
 *   3. 收敛终态（done / canceled / error），更新 Turn 状态
 *
 * 系统提示词与工具集**已由上层组装完毕**再传进来。AgentLoop 不再感知
 * "全局助手 / 章节助手" 之类的 task 分类——那是 Surface 的事。
 */

import type {
  AssistantSession,
  AssistantEventPush,
  SurfaceDefinition,
  TurnAttachment,
  TurnEvent,
  TurnStatus
} from '@shared/assistant-runtime'
import type {
  AiAgentStreamHandlers,
  AiRunUsage,
  AppSettings,
  ToolCallTrace
} from '../shared-types'
import type { Tool } from '../agent/tools/types'
import { runAgent } from '../agent/run-agent'
import { isToolUseNotSupportedError } from '../provider'
import type { ConversationManager } from './conversation-manager'
import type { StagedChangesStore } from './staged-changes-store'

export interface AgentLoopRunOptions {
  session: AssistantSession
  surface: SurfaceDefinition
  turnInput: {
    userMessage: string
    intentHint?: string
    attachments?: TurnAttachment[]
  }
  /** 已由 ContextBuilder + 规则模板拼装好的 system prompt。 */
  systemPrompt: string
  /**
   * 工具集。可以是静态数组，也可以是**工厂函数**——工厂在 Turn 创建后被调用，
   * 收到 `turnId / sessionId / projectId`，用于让 `stage_*` 工具闭包捕获这些值。
   */
  tools: Tool[] | ToolFactory
  settings: AppSettings
  /** 上层可传 AbortController.signal 用于中断本次 turn。 */
  signal: AbortSignal
  /** 覆盖 Surface 的 maxSteps；缺省用 surface.maxSteps。 */
  maxSteps?: number
  /** 输出 token 上限；无值时使用后端默认。 */
  maxOutputTokens?: number
  /**
   * Turn 创建后立即回调，把新分配的 turnId 交给上层。
   * IPC 层用它把 AbortController 注册到 activeTurns，实现 TURN_CANCEL。
   */
  onTurnCreated?: (turnId: string) => void
}

export interface AgentLoopRunResult {
  turnId: string
  finalText: string
  status: TurnStatus
  usage?: AiRunUsage
  toolCalls: ToolCallTrace[]
  agentIterations: number
  error?: string
}

/** 向渲染进程推送 TurnEvent 的回调（IPC 层实现）。 */
export type EventEmitter = (evt: AssistantEventPush) => void

/** 工具工厂：turn 创建后被调用，闭包 turnId/sessionId 供 stage_* 工具使用。 */
export type ToolFactory = (ctx: {
  turnId: string
  sessionId: string
  projectId: string
}) => Tool[]

/**
 * AgentLoop 类。构造时注入依赖，run 方法执行完整一次 turn。
 *
 * 依赖：
 *   - ConversationManager：Turn 生命周期 + 事件落盘
 *   - StagedChangesStore：变更暂存事件的 replay 落盘（Phase 2 起真正使用）
 *   - EventEmitter：把 TurnEvent 推给渲染进程
 */
export class AgentLoop {
  constructor(
    private readonly conversation: ConversationManager,
    private readonly staged: StagedChangesStore,
    private readonly emit: EventEmitter
  ) {}

  /**
   * 双写：落盘到 assistant_events + 通过 IPC 推给渲染进程。
   * seq 由 ConversationManager 分配。
   */
  private dispatch(sessionId: string, turnId: string, event: TurnEvent): void {
    const persisted = this.conversation.appendEvent(turnId, event)
    // event 里的 seq 会被 appendEvent 覆盖，读回来的才是最终值
    const finalEvent: TurnEvent = {
      ...event,
      seq: persisted.seq
    } as TurnEvent
    this.emit({ sessionId, turnId, event: finalEvent })
  }

  /**
   * 构建桥接 handlers：把 runAgent 的回调 → TurnEvent。
   * onEditApplied / onEditProposed 保留空实现，供旧的 edit_chapter 工具兼容
   * （Phase 2 移除旧工具后即可删掉）。
   */
  private buildHandlers(
    sessionId: string,
    turnId: string,
    toolCalls: ToolCallTrace[]
  ): AiAgentStreamHandlers {
    const toolArgs = new Map<string, Record<string, unknown>>()
    return {
      onTextDelta: (delta) => {
        this.dispatch(sessionId, turnId, { kind: 'chunk', seq: 0, delta })
      },
      onReasoningDelta: (delta) => {
        this.dispatch(sessionId, turnId, { kind: 'reasoning', seq: 0, delta })
      },
      onToolUseStart: (toolUseId, toolName, args) => {
        toolArgs.set(toolUseId, args)
        this.dispatch(sessionId, turnId, {
          kind: 'tool_use_start',
          seq: 0,
          toolUseId,
          toolName,
          args
        })
      },
      onToolResult: (toolUseId, toolName, content, isError, durationMs) => {
        this.dispatch(sessionId, turnId, {
          kind: 'tool_result',
          seq: 0,
          toolUseId,
          content,
          isError,
          durationMs
        })
        toolCalls.push({
          tool: toolName,
          args: toolArgs.get(toolUseId) ?? {},
          durationMs,
          status: isError ? 'error' : 'ok',
          ...(isError ? { error: content.slice(0, 240) } : {})
        })
      },
      onAgentStatus: (message) => {
        this.dispatch(sessionId, turnId, {
          kind: 'agent_status',
          seq: 0,
          message
        })
      },
      // 下面两个是旧工具的编辑通道，Runtime v2 内不使用；空实现保持兼容。
      onEditApplied: () => {},
      onEditProposed: () => {}
    }
  }

  /** 订阅 StagedChangesStore：本轮 turn 内的变更 → staged_change 事件双写。 */
  private subscribeStaged(sessionId: string, turnId: string): () => void {
    return this.staged.subscribe((evt) => {
      // 只关心属于本次 turn 的变更
      if (evt.type === 'removed') {
        // 硬删除不通过 event 表达，UI 走另一条通道
        return
      }
      if (evt.change.sessionId !== sessionId || evt.change.turnId !== turnId) return

      if (evt.type === 'added') {
        this.dispatch(sessionId, turnId, {
          kind: 'staged_change',
          seq: 0,
          changeId: evt.change.id,
          toolUseId: evt.change.toolUseId
        })
      } else if (evt.type === 'updated') {
        this.dispatch(sessionId, turnId, {
          kind: 'staged_change_updated',
          seq: 0,
          changeId: evt.change.id,
          status: evt.change.status
        })
      }
    })
  }

  /**
   * 执行一次完整 turn。
   * 内部会：
   *   1. createTurn（数据库落一条 streaming 记录）
   *   2. 订阅 staged store（收敛本轮的变更事件）
   *   3. 调 runAgent
   *   4. 根据成功/取消/错误更新 Turn 状态、追加终态事件
   */
  async run(options: AgentLoopRunOptions): Promise<AgentLoopRunResult> {
    const turn = this.conversation.createTurn({
      sessionId: options.session.id,
      userMessage: options.turnInput.userMessage
    })
    const turnId = turn.id
    const sessionId = options.session.id
    options.onTurnCreated?.(turnId)
    const unsubscribe = this.subscribeStaged(sessionId, turnId)

    // 工厂形态在此展开为具体 tools，让 stage_* 闭包捕获 turnId/sessionId。
    const tools: Tool[] = typeof options.tools === 'function'
      ? options.tools({
          turnId,
          sessionId,
          projectId: options.session.projectId
        })
      : options.tools

    let finalText = ''
    let usage: AiRunUsage | undefined
    let agentIterations = 0
    const toolCalls: ToolCallTrace[] = []
    let status: TurnStatus = 'done'
    let errorMessage: string | undefined

    try {
      const result = await runAgent({
        settings: options.settings,
        systemPrompt: options.systemPrompt,
        userPrompt: options.turnInput.userMessage,
        tools,
        ctx: {
          signal: options.signal,
          projectId: options.session.projectId
        },
        handlers: this.buildHandlers(sessionId, turnId, toolCalls),
        maxTokens: options.maxOutputTokens,
        maxSteps: options.maxSteps ?? options.surface.maxSteps
      })
      finalText = result.finalText
      usage = result.usage
      agentIterations = result.iterations
      if (toolCalls.length === 0 && result.toolCalls.length > 0) {
        toolCalls.push(...result.toolCalls)
      }
      // 若模型未产出任何可见文本，拒绝静默 done——转成 error 并附带诊断信息，
      // 便于定位到 provider/model 层的兼容问题（如中转站不吐流式正文、
      // 只返回工具调用但没最终答复等）。
      if (!finalText.trim()) {
        throw new Error(
          `模型未产出可见回复。iterations=${result.iterations}, ` +
          `toolCalls=${result.toolCalls.length}, ` +
          `usage=${JSON.stringify(result.usage ?? null)}. ` +
          `可能原因：模型/中转站在带 tools 时不吐流式文本；模型名或 API Key 配置有误；上下文触发 provider 内部限流。`
        )
      }
      this.dispatch(sessionId, turnId, {
        kind: 'done',
        seq: 0,
        content: finalText
      })
    } catch (e) {
      if (options.signal.aborted) {
        status = 'canceled'
        this.dispatch(sessionId, turnId, {
          kind: 'canceled',
          seq: 0,
          content: finalText || undefined
        })
      } else {
        status = 'error'
        errorMessage = isToolUseNotSupportedError(e)
          ? '当前模型不支持工具调用（tool_use），无法驱动全局助手 v2 的读取与暂存流程。请在设置中切换到支持工具调用的模型（如 Claude / GPT 系列）后重试。'
          : e instanceof Error ? e.message : String(e)
        this.dispatch(sessionId, turnId, {
          kind: 'error',
          seq: 0,
          error: errorMessage
        })
      }
    } finally {
      unsubscribe()
      this.conversation.updateTurnStatus(turnId, status, finalText)
    }

    return {
      turnId,
      finalText,
      status,
      usage,
      toolCalls,
      agentIterations,
      error: errorMessage
    }
  }
}
