/**
 * AI 模块对外暴露的所有类型。
 * IPC、index.ts、referenceAnalysis.ts 都从这里 import。
 */

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

export type AppSettings = {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  imageModel: string
  imageApiKey: string
  imageBaseUrl: string
}

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
  | 'chapter-assistant'
  | 'chapter-first-draft'
  | 'chapter-summarize'
  | 'chapter-scene-plan'
  | 'plot-thread-detect'
  | 'project-bootstrap'
  | 'chapter-analysis'
  | 'chapter-repair'
  | 'inspiration-pack'
  | 'story-deep-audit'

export type AiRunKnowledgeItem = {
  documentId: string
  title: string
  sourceType: 'reference-summary' | 'reference-chunk' | 'workflow-document' | 'canon-fact' | 'chapter-summary'
  sourceLabel: string
  snippet: string
  keywords: string[]
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
}

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

export type AiTaskKnowledgeContext = {
  usedKnowledge: AiRunKnowledgeItem[]
}

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

export type WorldviewResult = {
  type: string
  title: string
  content: string
}

export type CharacterResult = {
  name: string
  role: string
  description: string
  tags: string[]
}

export type OutlineResult = {
  title: string
  wordTarget: string
  conflict: string
  summary: string
}

export type OutlineBatchResult = {
  entries: OutlineResult[]
}

export type ChapterAssistantResult = {
  content: string
}

export type AssistantIntentResult = {
  intent: 'chat' | 'proposal'
  reason: string
}

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

export type ProjectBootstrapResult = {
  worldviewEntries: WorldviewResult[]
  outlineItems: OutlineResult[]
}

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

export type WorkflowStageDocumentsResult = Partial<WorkflowDocumentsResult>

export type ChapterAnalysisResult = {
  overview: string
  pacing: string
  tension: string
  continuity: string
  highlights: string[]
  risks: string[]
  revisionActions: string[]
}

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

export type InspirationResult = {
  type: string
  title: string
  content: string
  tags: string[]
}

export type InspirationPackResult = {
  entries: InspirationResult[]
}

export type ChapterScenePlanResult = {
  scenes: Array<{ focus: string }>
}

export type PlotThreadDetectEntry = {
  title: string
  description: string
  tags: string[]
}

export type PlotThreadDetectResult = {
  entries: PlotThreadDetectEntry[]
}

export type AiTaskResult =
  | WorldviewResult
  | CharacterResult
  | OutlineResult
  | OutlineBatchResult
  | ChapterAssistantResult
  | AssistantIntentResult
  | AssistantActionProposalResult
  | ProjectBootstrapResult
  | WorkflowDocumentsResult
  | WorkflowStageDocumentsResult
  | ChapterAnalysisResult
  | ReferenceStyleChunkResult
  | ReferenceStyleAnalysisResult
  | InspirationPackResult
  | PlotThreadDetectResult
  | ChapterScenePlanResult

export type AiTaskResponse = {
  result: AiTaskResult
  meta: AiRunMeta
}

export type PromptPair = {
  system: string
  user: string
}

export type AiStreamHandlers = {
  onTextDelta: (delta: string) => void
}

export const AI_REQUEST_TIMEOUT_MS = 180_000

/** Agent loop 单次任务最多允许的工具循环轮数。超过即抛错，避免死循环吃 token。 */
export const AGENT_MAX_TOOL_ITERATIONS = 8

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
