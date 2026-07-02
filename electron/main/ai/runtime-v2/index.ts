/**
 * Assistant Runtime v2 · 主进程入口
 *
 * Phase 0 骨架。当前仅导出契约类型，方便渲染进程和主进程其他模块提前引用。
 * 后续 Phase 1 会在此目录下实现：
 *   - conversation-manager.ts   会话/Turn/Event 持久化
 *   - context-builder.ts        Surface-aware 上下文构建
 *   - agent-loop.ts             单一入口的 streamText 主循环
 *   - staged-changes-store.ts   变更暂存与批量 commit
 *   - permission.ts             ToolMatcher → tool registry 过滤
 *   - ipc.ts                    ASSISTANT_IPC_CHANNELS 处理器注册
 *
 * 与旧的 electron/main/ai/ 并存，不侵入现有代码路径。
 */

export type {
  SurfaceId,
  SurfaceScope,
  SurfaceDefinition,
  AssistantSession,
  AssistantTurn,
  TurnStatus,
  TurnEvent,
  PersistedTurnEvent,
  StagedChange,
  StagedChangeKind,
  StagedChangeAction,
  StagedChangeStatus,
  StagedChangeCandidate,
  StagedChangeCommitResult,
  ContextProviderId,
  ContextSlice,
  ContextBuildRequest,
  ToolMatcher,
  PermissionMatrix,
  AssistantEventPush,
  TurnSendRequest,
  TurnCancelRequest,
  TurnAttachment,
  StageAcceptRequest,
  StageRejectRequest,
  StageCommitRequest,
  StageBindTargetRequest,
  AssistantIpcChannel
} from '@shared/assistant-runtime'

export {
  ASSISTANT_IPC_CHANNELS,
  DEFAULT_PERMISSION_MATRIX
} from '@shared/assistant-runtime'

export {
  matchesTool,
  isToolAllowed,
  resolveAllowedMatchers,
  filterToolsBySurface,
  listAllowedToolNames,
  type NamedTool
} from './permission'

export {
  StagedChangesStore,
  stagedChangesStore,
  type StageChangeInput,
  type StagedChangeCommitter,
  type StagedChangesListener,
  type StagedChangesEvent,
  type StagedChangesFilter
} from './staged-changes-store'

export {
  ConversationManager,
  initAssistantRuntimeSchema,
  type CreateSessionInput,
  type ListSessionsFilter,
  type CreateTurnInput
} from './conversation-manager'

export {
  ContextBuilder,
  contextBuilder,
  assembleContextBlock,
  estimateTokens,
  type ContextProvider,
  type BuildResult
} from './context-builder'

export {
  AgentLoop,
  type AgentLoopRunOptions,
  type AgentLoopRunResult,
  type EventEmitter
} from './agent-loop'

export {
  registerAssistantIpcHandlers,
  type AssistantIpcDeps,
  type ResolveTurnExecutionPlan
} from './ipc'

export {
  bootstrapAssistantRuntime,
  type BootstrapAssistantRuntimeDeps
} from './bootstrap'
