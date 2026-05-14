import type { TaskHandler } from './base'
import type { AiTaskName } from '../shared-types'

import worldviewEntry from './worldview-entry'
import characterCard from './character-card'
import outlineItem from './outline-item'
import outlineBatch from './outline-batch'
import outlineChain from './outline-chain'
import projectBootstrap from './project-bootstrap'
import chapterAnalysis from './chapter-analysis'
import inspirationPack from './inspiration-pack'
import assistantIntent from './assistant-intent'
import assistantActionProposal from './assistant-action-proposal'
import chapterAssistant from './chapter-assistant'
import chapterFirstDraft from './chapter-first-draft'
import chapterSummarize from './chapter-summarize'
import chapterScenePlan from './chapter-scene-plan'
import plotThreadDetect from './plot-thread-detect'
import workflowDocuments from './workflow-documents'
import referenceStyleChunk from './reference-style-chunk'
import referenceStyleAnalysis from './reference-style-analysis'
import referenceDeepAnalyze from './reference-deep-analyze'
import styleFingerprintExtract from './style-fingerprint-extract'
import storyDeepAudit from './story-deep-audit'
import chapterRepair from './chapter-repair'

const TASK_REGISTRY = new Map<AiTaskName, TaskHandler>()

function register(handler: TaskHandler): void {
  TASK_REGISTRY.set(handler.name, handler)
}

register(worldviewEntry)
register(characterCard)
register(outlineItem)
register(outlineBatch)
register(outlineChain)
register(projectBootstrap)
register(chapterAnalysis)
register(inspirationPack)
register(assistantIntent)
register(assistantActionProposal)
register(chapterAssistant)
register(chapterFirstDraft)
register(chapterSummarize)
register(chapterScenePlan)
register(plotThreadDetect)
register(workflowDocuments)
register(referenceStyleChunk)
register(referenceStyleAnalysis)
register(referenceDeepAnalyze)
register(styleFingerprintExtract)
register(storyDeepAudit)
register(chapterRepair)

export function getTaskHandler(name: AiTaskName): TaskHandler {
  const handler = TASK_REGISTRY.get(name)
  if (!handler) throw new Error(`未知任务类型：${name}`)
  return handler
}

export type { TaskHandler } from './base'
