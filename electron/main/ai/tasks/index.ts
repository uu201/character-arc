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
import chapterMemo from './chapter-memo'
import chapterAudit from './chapter-audit'
import plotThreadDetect from './plot-thread-detect'
import workflowDocuments from './workflow-documents'
import referenceStyleChunk from './reference-style-chunk'
import referenceStyleAnalysis from './reference-style-analysis'
import referenceDeepAnalyze from './reference-deep-analyze'
import styleFingerprintExtract from './style-fingerprint-extract'
import storyDeepAudit from './story-deep-audit'
import chapterRepair from './chapter-repair'
import spiralSeed from './spiral-seed'
import spiralExpand from './spiral-expand'
import spiralValidate from './spiral-validate'
import characterEnhance from './character-enhance'
import worldviewEnhance from './worldview-enhance'
import outlineEnhance from './outline-enhance'
import relationEnhance from './relation-enhance'

/** 任务处理器注册表，按任务名称映射 */
const TASK_REGISTRY = new Map<AiTaskName, TaskHandler>()

/**
 * 将任务处理器注册到全局注册表
 * @param handler - 任务处理器
 */
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
register(chapterMemo)
register(chapterAudit)
register(plotThreadDetect)
register(workflowDocuments)
register(referenceStyleChunk)
register(referenceStyleAnalysis)
register(referenceDeepAnalyze)
register(styleFingerprintExtract)
register(storyDeepAudit)
register(chapterRepair)
register(spiralSeed)
register(spiralExpand)
register(spiralValidate)
register(characterEnhance)
register(worldviewEnhance)
register(outlineEnhance)
register(relationEnhance)

/**
 * 根据任务名称获取对应的任务处理器
 * @param name - AI 任务名称
 * @returns 匹配的任务处理器
 */
export function getTaskHandler(name: AiTaskName): TaskHandler {
  const handler = TASK_REGISTRY.get(name)
  if (!handler) throw new Error(`未知任务类型：${name}`)
  return handler
}

export type { TaskHandler } from './base'
