/**
 * AI 模块对外暴露的所有类型。
 * IPC、index.ts、referenceAnalysis.ts 都从这里 import。
 */

import type { SpiralSeedResult, SpiralExpandResult, SpiralValidateResult } from './spiral/types'

/** AI 供应商标识。支持预设值或自定义字符串。 */
export type ProviderName =
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'ollama'
  | 'qwen'
  | 'zhipu'
  | 'moonshot'
  | 'siliconflow'
  | 'new-api'
  | 'one-api'
  | string

/**
 * AI 模块的全局设置。
 * 聊天和图片生成共用同一组 provider/model/key，embedding 和图片可单独配置。
 */
export type AppSettings = {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  /** 可选：模型采样温度，留空时使用服务端默认值 */
  temperature?: number
  /** 可选：模型 nucleus sampling 参数，留空时使用服务端默认值 */
  topP?: number
  /** 可选：embedding 专用模型，为空时从 model 推断 */
  embeddingModel: string
  /** 可选：图片生成模型 */
  imageModel: string
  /** 可选：图片生成独立 API Key */
  imageApiKey: string
  /** 可选：图片生成独立 Base URL */
  imageBaseUrl: string
  /** AI 请求超时（秒），默认 180 */
  aiTimeoutSeconds?: number
}

/** 所有 AI 任务类型的联合字面量类型。每个值对应 tasks/ 下的一个 TaskHandler。 */
export type AiTaskName =
  | 'worldview-entry'
  | 'character-card'
  | 'outline-item'
  | 'outline-batch'
  | 'outline-chain'
  | 'reference-style-chunk'
  | 'reference-style-analysis'
  | 'reference-deep-analyze'
  | 'style-fingerprint-extract'
  | 'workflow-documents'
  | 'assistant-intent'
  | 'assistant-action-proposal'
  | 'global-assistant'
  | 'global-assistant-proposal'
  | 'chapter-assistant'
  | 'chapter-first-draft'
  | 'chapter-summarize'
  | 'chapter-scene-plan'
  | 'chapter-memo'
  | 'chapter-audit'
  | 'chapter-humanize'
  | 'plot-thread-detect'
  | 'project-bootstrap'
  | 'spiral-seed'
  | 'spiral-expand'
  | 'spiral-validate'
  | 'chapter-analysis'
  | 'chapter-repair'
  | 'chapter-session-note'
  | 'inspiration-pack'
  | 'story-deep-audit'
  | 'state-backfill'
  | 'character-enhance'
  | 'worldview-enhance'
  | 'outline-enhance'
  | 'relation-enhance'
  | 'catalog-batch'
  | 'cover-generate'

/**
 * AI 运行时注入 prompt 的知识条目。
 * 来自关键词检索模块的输出，随 AiRunMeta 一起记录。
 */
export type AiRunKnowledgeItem = {
  documentId: string
  title: string
  sourceType: 'reference-summary' | 'reference-chunk' | 'workflow-document' | 'canon-fact' | 'chapter-summary'
  sourceLabel: string
  snippet: string
  keywords: string[]
}

export type AiRunUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export type AiRunMeta = {
  task: AiTaskName
  projectId: string
  chapterId?: string
  /**
   * 前端任务注册表里使用的 key（如 `worldview-entry`、`cover-generate`）。
   * 让前端能把 IPC 返回的 AiRunMeta 关联回 `runTrackedAiTask` 发起的那条任务，
   * 从而在进度面板里点击已完成任务跳转到对应的 aiRuns 详情。
   */
  clientKey?: string
  provider: string
  model: string
  status: 'running' | 'success' | 'error' | 'canceled'
  startedAt: string
  finishedAt?: string
  durationMs?: number
  usage?: AiRunUsage
  usedKnowledge: AiRunKnowledgeItem[]
  usedSkills: string[]
  repairTriggered: boolean
  error: string
  responsePreview: string
  /** 该次调用走的是 agent loop 时，记录每次工具调用的轨迹。普通单次调用为 undefined。 */
  toolCalls?: ToolCallTrace[]
  /** 走 agent loop 时，loop 实际跑了几轮（首轮 + 工具循环）。 */
  agentIterations?: number
  /** 走 agent loop 时，agent 通过 knowledge_save_document 工具产生的待入库知识文档。 */
  producedKnowledgeDocuments?: AiKnowledgeDocumentDraft[]
  /** 走 global-assistant agent loop 时，通过 propose_* 工具产生的结构化写回提案草稿。 */
  producedSettingProposal?: Partial<GlobalAssistantProposalResult>
}

/** Agent loop 中单次工具调用的追踪记录 */
export type ToolCallTrace = {
  tool: string
  args: Record<string, unknown>
  durationMs: number
  status: 'ok' | 'error'
  error?: string
}

/**
 * agent 通过 knowledge_save_document 工具落库的知识文档草稿。
 * 不带 id / projectId / 时间戳——renderer 落地时补全。
 */
export type AiKnowledgeDocumentDraft = {
  title: string
  sourceType: 'reference-summary' | 'reference-chunk' | 'workflow-document' | 'canon-fact' | 'chapter-summary'
  sourceLabel: string
  content: string
  summary?: string
  keywords?: string[]
  metadata?: Record<string, unknown>
}

/** 注入任务的知识上下文 */
export type AiTaskKnowledgeContext = {
  usedKnowledge: AiRunKnowledgeItem[]
}

/**
 * 从前端通过 IPC 传入的 AI 任务请求体。
 * 包含任务类型、设置、上下文数据及可选的客户端追踪字段。
 */
export type AiTaskPayload = {
  task: AiTaskName
  settings: AppSettings
  context: Record<string, unknown>
  /**
   * 前端任务注册表 key（如 `worldview-entry`、`cover-generate`）。
   * 可选；随 IPC 一路带到 AiRunMeta，让前端进度面板能关联对应的运行记录。
   */
  clientKey?: string
  /**
   * 前端发起这次 IPC 请求时的唯一任务 id（`runTrackedAiTask` 内部生成）。
   * 用于：
   *   1. 非流式任务的取消 —— `ipcMain.handle('ai-cancel', clientTaskId)` 按此 id 找 AbortController
   *   2. 客户端超时抛错时告诉主进程放弃
   */
  clientTaskId?: string
}

/** 世界观条目生成结果 */
export type WorldviewResult = {
  type: string
  title: string
  content: string
}

/** 角色卡片生成结果 */
export type CharacterResult = {
  name: string
  role: string
  description: string
  tags: string[]
}

/** 单条大纲条目生成结果 */
export type OutlineResult = {
  title: string
  wordTarget: string
  conflict: string
  summary: string
}

/** 批量大纲生成结果 */
export type OutlineBatchResult = {
  entries: OutlineResult[]
}

/** 章节助手（对话）的回复结果 */
export type ChapterAssistantResult = {
  content: string
}

/** 项目级全局助手回复结果 */
export type GlobalAssistantResult = {
  content: string
}

export type GlobalAssistantProposalResult = {
  summary: string
  constraintCreates: Array<{
    title: string
    content: string
    scope: string
    weight?: 'core' | 'important' | 'supporting'
    locked?: boolean
    reason: string
    keywords: string[]
  }>
  worldviewCreates: WorldviewResult[]
  worldviewUpdates: Array<{
    matchTitle: string
    reason: string
    type?: string
    title?: string
    content?: string
  }>
  characterCreates: CharacterResult[]
  characterUpdates: Array<{
    matchName: string
    reason: string
    name?: string
    role?: string
    description?: string
    tags?: string[]
  }>
  organizationCreates: Array<{
    name: string
    type: string
    description: string
    motto?: string
  }>
  organizationUpdates: Array<{
    matchName: string
    reason: string
    name?: string
    type?: string
    description?: string
    motto?: string
  }>
  outlineCreates: OutlineResult[]
  outlineUpdates: Array<{
    matchTitle: string
    reason: string
    title?: string
    wordTarget?: string
    conflict?: string
    summary?: string
  }>
  notes: string[]
}

/** 助手意图识别结果：普通聊天或操作提案 */
export type AssistantIntentResult = {
  intent: 'chat' | 'proposal'
  reason: string
}

/** 助手操作提案详情：包含命令类型、目标、变更预览和确认要求 */
export type AssistantActionProposalResult = {
  commandType:
    | 'insert-into-chapter'
    | 'update-chapter-title'
    | 'update-chapter-summary'
    | 'create-outline-item'
    | 'append-workflow-document-entry'
    | 'update-workflow-document'
    | 'save-knowledge-document'
  target:
    | 'chapter-content'
    | 'chapter-title'
    | 'chapter-summary'
    | 'outline-item'
    | 'workflow-document'
    | 'knowledge-document'
  reason: string
  title: string
  summary: string
  before?: string
  after?: string
  destructive: boolean
  requiresConfirmation: boolean
  payload: Record<string, unknown>
}

/** 项目初始化（一键生成世界观 + 大纲）的结果 */
export type ProjectBootstrapResult = {
  worldviewEntries: WorldviewResult[]
  outlineItems: OutlineResult[]
}

/**
 * 创作记忆集合生成结果。
 * 每个 key 对应一种创作记忆（任务计划、发现、进度等）。
 */
export type WorkflowDocumentsResult = {
  task_plan: string
  findings: string
  progress: string
  current_status: string
  novel_setting: string
  character_relationships: string
  pending_hooks: string
  resource_ledger: string
}

/** 工作流阶段文档的部分更新结果 */
export type WorkflowStageDocumentsResult = Partial<WorkflowDocumentsResult>

/** 章节分析结果：概览、节奏、张力、连续性、亮点、风险和修改建议 */
export type ChapterAnalysisResult = {
  overview: string
  pacing: string
  tension: string
  continuity: string
  highlights: string[]
  risks: string[]
  revisionActions: string[]
}

/** 参考小说整体风格分析结果 */
export type ReferenceStyleAnalysisResult = {
  overview: string
  sentenceStyle: string
  dialogueRatio: string
  pacingControl: string
  emotionExpression: string
  narrativePerspective: string
  styleRules: string[]
  plotOutline: string
  reusableStylePrompt: string
  avoidRules: string[]
}

/** 参考小说片段风格分析结果 */
export type ReferenceStyleChunkResult = {
  overview: string
  sentenceStyle: string
  dialogueRatio: string
  pacingControl: string
  emotionExpression: string
  plotFunction: string
  hookDesign: string
  informationRelease: string
  characterShift: string
  tensionCurve: string
  styleRules: string[]
}

/** 单条灵感条目 */
export type InspirationResult = {
  type: string
  title: string
  content: string
  tags: string[]
}

/** 灵感包生成结果（多条灵感条目） */
export type InspirationPackResult = {
  entries: InspirationResult[]
}

/** 图鉴类数据的批量生成结果，由调用方根据 mode 解释字段。 */
export type CatalogBatchResult = {
  entries: Array<Record<string, unknown>>
}

/** 章节场景规划结果 */
export type ChapterScenePlanResult = {
  scenes: Array<{ focus: string }>
}

/** 章节写作备忘：Writer 写正文前的硬指令清单（参考 inkos chapter_memo 设计） */
export type ChapterMemoResult = {
  memo: {
    currentTask: string
    readerExpectation: string
    payoffs: string[]
    holds: string[]
    transitionFunctions: string
    decisionChecks: string[]
    endingChanges: string[]
    doNotDo: string[]
    emotionArc: string
  }
}

/** 章节审计结果：写完整章后对照 memo 检查兑现情况（参考 inkos Auditor 设计） */
export type ChapterAuditResult = {
  audit: {
    pass: boolean
    wordCount: number
    issues: Array<{
      severity: 'critical' | 'warning' | 'hint'
      category: string
      ref: string
      hint: string
    }>
  }
}

/** 单条情节线索检测结果 */
export type PlotThreadDetectEntry = {
  title: string
  description: string
  tags: string[]
}

/** 情节线索检测结果（多条线索） */
export type PlotThreadDetectResult = {
  entries: PlotThreadDetectEntry[]
}

/** 所有 AI 任务结果类型的联合类型 */
export type AiTaskResult =
  | WorldviewResult
  | CharacterResult
  | OutlineResult
  | OutlineBatchResult
  | ChapterAssistantResult
  | GlobalAssistantResult
  | GlobalAssistantProposalResult
  | AssistantIntentResult
  | AssistantActionProposalResult
  | ProjectBootstrapResult
  | WorkflowDocumentsResult
  | WorkflowStageDocumentsResult
  | ChapterAnalysisResult
  | ReferenceStyleChunkResult
  | ReferenceStyleAnalysisResult
  | InspirationPackResult
  | CatalogBatchResult
  | PlotThreadDetectResult
  | ChapterScenePlanResult
  | ChapterMemoResult
  | ChapterAuditResult
  | SpiralSeedResult
  | SpiralExpandResult
  | SpiralValidateResult

/** AI 任务的完整响应：结果 + 运行元数据 */
export type AiTaskResponse = {
  result: AiTaskResult
  meta: AiRunMeta
}

/** System + User 的 prompt 对 */
export type PromptPair = {
  system: string
  user: string
}

/** 流式 AI 生成的回调处理器 */
export type AiStreamHandlers = {
  onTextDelta: (delta: string) => void
  /** 推理模型的思考过程增量。可选——只有支持 reasoning 的模型会触发。 */
  onReasoningDelta?: (delta: string) => void
}

/** Agent 流式生成的回调处理器（含工具调用和编辑事件） */
export type AiAgentStreamHandlers = {
  onTextDelta: (delta: string) => void
  /** 推理模型的思考过程增量。可选——只有支持 reasoning 的模型会触发。 */
  onReasoningDelta?: (delta: string) => void
  onToolUseStart: (toolUseId: string, toolName: string, args: Record<string, unknown>) => void
  onToolResult: (toolUseId: string, toolName: string, content: string, isError: boolean, durationMs: number) => void
  onAgentStatus: (message: string, iteration: number, maxIterations: number) => void
  onEditApplied: (chapterId: string, editType: string, preview: string, versionId: string) => void
  onEditProposed: (chapterId: string, proposalId: string, editType: string, preview: string, oldContent: string, newContent: string) => void
}

export const AI_REQUEST_TIMEOUT_MS = 180_000

/** Agent loop 单次任务最多允许的工具循环轮数。超过即抛错，避免死循环吃 token。 */
export const AGENT_MAX_TOOL_ITERATIONS = 8

export const AGENT_STREAM_MAX_ITERATIONS = 16

/**
 * 章节轻检告警事件 payload。章节生成后的异步后处理流水线产出，
 * 通过 `characterarc:chapter-state-warnings` 广播给 renderer，
 * 由章节编辑器展示为 n-alert 供用户修正。
 */
export type ChapterStateWarningsPayload = {
  projectId: string
  chapterId: string
  chapterIndex: number
  generatedAt: string
  violations: Array<{
    type: 'location_mismatch' | 'item_not_owned' | 'timeline_break' | 'rule_violation' | 'state_conflict'
    severity: 'error' | 'warning'
    message: string
  }>
}

/**
 * 章节正文生成成功后的异步后处理问题事件 payload。
 * 即使 issues 为空也会广播一次，用于清理 renderer 里上一轮遗留的旧问题提示。
 */
export type ChapterPostGenerationIssuesPayload = {
  projectId: string
  chapterId: string
  chapterIndex: number
  generatedAt: string
  issues: Array<{
    stage: 'state-delta' | 'vector-index' | 'pipeline'
    severity: 'warning' | 'error'
    message: string
    detail?: string
  }>
}
