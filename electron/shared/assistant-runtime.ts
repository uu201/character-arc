/**
 * Assistant Runtime v2 契约
 *
 * 定义主进程 Runtime 与渲染进程 useAssistant 之间的所有共享类型。
 * 覆盖：Surface、Session/Turn/Event、StagedChange、ContextProvider、
 *       工具权限矩阵、IPC 通道枚举、流式事件类型。
 *
 * 与旧的 AI 模块类型（`electron/main/ai/shared-types.ts`）**并行存在**，
 * 待 Phase 3 迁移完毕后再统一。此文件只放共享契约，不含实现。
 */

// ============================================================================
// Surface 定义
// ============================================================================

/** 助手挂载的位置。每个入口是一个 Surface，Runtime 按 Surface 决定行为。 */
export type SurfaceId =
  | 'global-page'
  | 'global-panel'
  | 'chapter-panel'
  | 'inline-selection'

/** Surface 上下文的绑定范围。 */
export type SurfaceScope = 'project' | 'chapter' | 'selection'

/**
 * Surface 声明：由前端组件在挂载时提供，Runtime 据此配置 tools/context/auto-commit。
 * 这里只声明"能力诉求"，不放具体运行时数据。
 */
export interface SurfaceDefinition {
  id: SurfaceId
  scope: SurfaceScope
  /** 工具白名单（支持通配符：'stage_*' / 'read_*'）。缺省 = 全部允许。 */
  allowedTools?: readonly string[]
  /** 声明需要哪些 ContextProvider（按 id）。缺省 = 由 Runtime 决定默认集合。 */
  contextProviders?: readonly ContextProviderId[]
  /** 章节内联预览这类"生成即写入编辑器 buffer"的 Surface 打开这个开关。 */
  autoCommit: boolean
  /** Agent loop 最大步数。 */
  maxSteps: number
}

// ============================================================================
// 会话 / Turn / Event
// ============================================================================

/** 会话元数据。持久化到 assistant_sessions 表。 */
export interface AssistantSession {
  id: string
  projectId: string
  surfaceId: SurfaceId
  /** 上下文锚点，如 'chapter:cha_042' / 'selection:cha_042#§6-7'。project 级留空。 */
  scopeRef?: string
  title: string
  createdAt: string
  updatedAt: string
}

/** 一次用户输入 → 一次完整 agent loop 的最终产物。持久化到 assistant_turns 表。 */
export interface AssistantTurn {
  id: string
  sessionId: string
  /** 用户消息（原始纯文本，含 @引用未展开）。 */
  userMessage: string
  /** Agent 最终回复。streaming 中为空。 */
  assistantMessage: string
  status: TurnStatus
  createdAt: string
}

export type TurnStatus =
  | 'streaming'
  | 'done'
  | 'canceled'
  | 'error'

/**
 * Turn 内的流式事件。所有事件以追加方式持久化到 assistant_events 表，
 * 保证刷新/重连后可 replay 恢复完整对话。
 */
export type TurnEvent =
  | { kind: 'reasoning'; seq: number; delta: string }
  | { kind: 'chunk'; seq: number; delta: string }
  | { kind: 'tool_use_start'; seq: number; toolUseId: string; toolName: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; seq: number; toolUseId: string; content: string; isError: boolean; durationMs: number }
  | { kind: 'staged_change'; seq: number; changeId: string; toolUseId?: string }
  | { kind: 'staged_change_updated'; seq: number; changeId: string; status: StagedChangeStatus }
  | { kind: 'agent_status'; seq: number; message: string }
  | { kind: 'done'; seq: number; content: string }
  | { kind: 'canceled'; seq: number; content?: string }
  | { kind: 'error'; seq: number; error: string }

/** 事件在 SQLite 表中的持久化形态。 */
export interface PersistedTurnEvent {
  id: string
  turnId: string
  seq: number
  kind: TurnEvent['kind']
  payloadJson: string
  createdAt: string
}

// ============================================================================
// Staged Changes
// ============================================================================

/** 变更种类，与项目实体一一对应。 */
export type StagedChangeKind =
  | 'chapter'
  | 'worldview'
  | 'character'
  | 'organization'
  | 'outline'
  | 'constraint'
  | 'plot_thread'
  | 'workflow_document'

/** create = 新增实体；update = 修改已有实体（entityId 必填）。 */
export type StagedChangeAction = 'create' | 'update'

/** 变更生命周期状态。 */
export type StagedChangeStatus =
  | 'streaming'   // 工具执行中，尚未 finalize
  | 'pending'    // 已就绪，等用户处理
  | 'accepted'   // 用户已确认，等待批量 commit
  | 'committed'  // 已写入数据库
  | 'rejected'   // 用户忽略
  | 'stale'     // 目标实体已被外部改动，需要重新解析

/**
 * 统一变更条目。取代旧的 ChapterEditProposal + GlobalAssistantProposal 两套模型。
 * 无论章节正文还是设定条目都走这一张表：staged_changes。
 */
export interface StagedChange {
  id: string
  sessionId: string
  turnId: string
  /** 触发此变更的 tool_use_id，用于对话/工具日志与变更卡片双向跳转。 */
  toolUseId?: string
  kind: StagedChangeKind
  action: StagedChangeAction
  /** update 时的目标实体 id；create 或未解析出目标时为空。 */
  entityId?: string
  /** 展示用标题（章节名/条目名/人物名）。 */
  entityTitle: string
  /** 生成理由（写给用户看的一句话）。 */
  reason: string
  /** diff 用的纯文本（HTML/Markdown 已 strip）。before 为空表示 create。 */
  before: string
  after: string
  /** 章节类专用：完整 HTML 前后态，用于最终 commit 时写回。 */
  chapterHtml?: { old: string; new: string }
  /** 结构化实体载荷。设定类变更 commit 时用，UI 只需要展示 before/after。 */
  entityPayload?: Record<string, unknown>
  /** update 目标未匹配时的候选实体列表，供用户手动绑定。 */
  candidates?: StagedChangeCandidate[]
  status: StagedChangeStatus
  createdAt: string
  updatedAt: string
}

export interface StagedChangeCandidate {
  entityId: string
  label: string
  hint?: string
}

/** commit 结果，返回给渲染进程。 */
export interface StagedChangeCommitResult {
  changeId: string
  ok: boolean
  /** commit 成功后，实体在业务库中的最终 id（create 时新分配）。 */
  entityId?: string
  error?: string
}

// ============================================================================
// Context Providers
// ============================================================================

/** 内置 ContextProvider id。第三方扩展可绕过此联合类型。 */
export type ContextProviderId =
  | 'project-brief'
  | 'current-chapter'
  | 'selection'
  | 'recent-messages'
  | 'worldview'
  | 'characters'
  | 'organizations'
  | 'character-relationships'
  | 'outline'
  | 'plot-threads'
  | 'constraints'
  | 'inspiration'
  | 'knowledge'
  | 'workflow-documents'
  | 'skill-index'

/**
 * 上下文切片：由 ContextProvider 产出，参与最终 system prompt 拼装。
 * priority 越大越重要，token budget 紧张时先保留高优先级 slice。
 */
export interface ContextSlice {
  providerId: ContextProviderId | string
  priority: number
  /** 拼装到 prompt 时用的段落标题。 */
  heading: string
  /** 段落主体。已经是格式化好的 markdown/文本。 */
  body: string
  /** 估算 token 数，用于预算裁剪。 */
  estimatedTokens: number
  /** 是否是被裁剪掉的"占位说明"（如"因超预算已省略，可用 search_project 查询"）。 */
  truncated?: boolean
}

/** ContextProvider 构建 slice 的入参。 */
export interface ContextBuildRequest {
  surface: SurfaceDefinition
  sessionId: string
  projectId: string
  /** Surface 的 scopeRef，例如 chapter id 或 selection ref。 */
  scopeRef?: string
  /** 剩余 token 预算（由 ContextBuilder 分配）。 */
  budgetTokens: number
}

// ============================================================================
// 工具权限矩阵
// ============================================================================

/** 支持通配符的工具名匹配。 */
export type ToolMatcher = string  // 例如 'stage_*' / 'read_chapter' / '*'

/** Surface → 允许的工具集。Runtime 组装 registry 时按此过滤。 */
export type PermissionMatrix = Readonly<Record<SurfaceId, readonly ToolMatcher[]>>

/**
 * 默认权限矩阵。Runtime 内部用；渲染进程只读，用于 UI 展示。
 * 用 `*` 通配简化维护；后续新增工具时按前缀自动生效。
 */
export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  'global-page': ['read_*', 'search_*', 'list_*', 'stage_*', 'skill_*', 'knowledge_*'],
  'global-panel': ['read_*', 'search_*', 'list_*', 'stage_*', 'skill_*', 'knowledge_*'],
  'chapter-panel': ['read_*', 'search_*', 'list_*', 'stage_chapter_edit', 'skill_*', 'knowledge_*'],
  'inline-selection': ['read_chapter', 'stage_chapter_edit']
} as const

// ============================================================================
// IPC 通道
// ============================================================================

/**
 * 新命名空间：`characterarc:assistant:*`。与旧的 `characterarc:ai:*` 并存，
 * Phase 3 迁移完毕后合并。
 */
export const ASSISTANT_IPC_CHANNELS = {
  // 会话
  SESSION_LIST: 'characterarc:assistant:session:list',
  SESSION_CREATE: 'characterarc:assistant:session:create',
  SESSION_DELETE: 'characterarc:assistant:session:delete',
  SESSION_LOAD: 'characterarc:assistant:session:load',
  SESSION_RENAME: 'characterarc:assistant:session:rename',
  // Turn（用户发起一次输入）
  TURN_SEND: 'characterarc:assistant:turn:send',
  TURN_CANCEL: 'characterarc:assistant:turn:cancel',
  // 流式事件订阅（主 → 渲染 push）
  EVENT_STREAM: 'characterarc:assistant:event:stream',
  // Staged Changes
  STAGE_LIST: 'characterarc:assistant:stage:list',
  STAGE_ACCEPT: 'characterarc:assistant:stage:accept',
  STAGE_REJECT: 'characterarc:assistant:stage:reject',
  STAGE_COMMIT: 'characterarc:assistant:stage:commit',
  STAGE_BIND_TARGET: 'characterarc:assistant:stage:bind-target'
} as const

export type AssistantIpcChannel =
  typeof ASSISTANT_IPC_CHANNELS[keyof typeof ASSISTANT_IPC_CHANNELS]

// ============================================================================
// IPC 请求 / 响应 payload
// ============================================================================

export interface TurnSendRequest {
  sessionId: string
  surface: SurfaceDefinition
  /** 用户消息原始文本。 */
  userMessage: string
  /**
   * @引用附件（如 @selection / @chapter），Runtime 会展开为 context input。
   * 前端只负责收集用户意图，具体展开由 ContextBuilder 做。
   */
  attachments?: TurnAttachment[]
  /** 若命中已知快捷指令（如 /polish），前端可以显式传，减少模型推断。 */
  intentHint?: string
}

export interface TurnAttachment {
  kind: 'chapter' | 'selection' | 'entity' | 'skill'
  ref: string        // 例如 'chapter:cha_042' / 'skill:polish-v2'
  label?: string
}

export interface TurnCancelRequest {
  sessionId: string
  turnId: string
}

export interface StageAcceptRequest {
  changeIds: string[]
}

export interface StageRejectRequest {
  changeIds: string[]
}

export interface StageCommitRequest {
  /** 只 commit 已 accepted 的变更；缺省时 commit 所有 accepted。 */
  changeIds?: string[]
}

export interface StageBindTargetRequest {
  changeId: string
  entityId: string
}

// ============================================================================
// 事件推流 payload
// ============================================================================

/**
 * 主进程通过 EVENT_STREAM 频道推送的事件。
 * 一条消息 = 一个 TurnEvent + 会话/turn 标识 + seq 号（用于断线续传去重）。
 */
export interface AssistantEventPush {
  sessionId: string
  turnId: string
  event: TurnEvent
}
