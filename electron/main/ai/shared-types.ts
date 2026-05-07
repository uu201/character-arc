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
}

export type AiTaskName =
  | 'worldview-entry'
  | 'character-card'
  | 'outline-item'
  | 'outline-batch'
  | 'outline-chain'
  | 'reference-style-chunk'
  | 'reference-style-analysis'
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
  | 'inspiration-pack'

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
}

export type AiTaskKnowledgeContext = {
  usedKnowledge: AiRunKnowledgeItem[]
}

export type AiTaskPayload = {
  task: AiTaskName
  settings: AppSettings
  context: Record<string, unknown>
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
