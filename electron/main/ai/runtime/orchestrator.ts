import type {
  AiTaskPayload,
  AiTaskKnowledgeContext,
  AiTaskResponse,
  AiTaskResult,
  AppSettings,
  AiStreamHandlers
} from '../shared-types'
import { normalizeSettings, validateSettings, resolveMaxTokens, AGENT_TASK_WHITELIST } from '../settings'
import { getTaskHandler } from '../tasks'
import { getAllSkills, pickSkillsFor, refreshRegistry } from '../skills'
import { requestAiText, requestAiTextStream, providerSupportsTools } from '../transport'
import type { StructuredOutputOptions } from '../transport'
import { buildPromptInput } from './context-builder'
import { probeStructuredOutputMode } from './capability-probe'
import { buildRunMeta, buildResponsePreview } from './run-meta'
import { logPrompt, logResponse, logSelection } from './logging'
import { buildRepairPrompt } from '../prompts/repair'
import { runAgentTask } from '../agent'

export async function runAiTask(
  task: AiTaskPayload,
  knowledgeContext?: AiTaskKnowledgeContext
): Promise<AiTaskResponse> {
  // 灰度分流：白名单内 + provider 支持 tool_use → 走 agent loop（progressive skill disclosure）。
  // 任意一个不满足 → 走原单次调用路径。renderer 完全无感。
  const settingsForRouting = normalizeSettings(task.settings)
  if (AGENT_TASK_WHITELIST.has(task.task) && providerSupportsTools(settingsForRouting)) {
    return runAgentTask(task, knowledgeContext)
  }

  const settings = settingsForRouting
  validateSettings(settings)
  const startedAt = new Date().toISOString()
  const projectId = String(task.context.projectId ?? '').trim()
  const clientKey = task.clientKey

  const handler = getTaskHandler(task.task)
  await refreshRegistry(projectId || undefined).catch(() => {})
  const skills = await pickSkillsFor(task, resolveEnabledSkillOverrides(task, projectId))
  const usedSkillIds = skills.map((s) => s.id)
  logSelection(task.task, skills, knowledgeContext?.usedKnowledge ?? [])

  const input = buildPromptInput(task, skills, knowledgeContext)
  const prompt = handler.buildPrompt(input)
  const maxTokens = handler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task)

  logPrompt('REQUEST', settings, prompt, task.task, usedSkillIds)

  const structured = resolveStructuredOptions(settings, handler.outputType)

  try {
    const requestStartedAt = Date.now()
    let rawText = await requestAiText(settings, prompt, maxTokens, structured)
    logResponse('REQUEST', settings, task.task, rawText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })
    let result: AiTaskResult
    let normalizeFailed = false
    try {
      result = handler.normalize(rawText)
    } catch {
      result = {} as AiTaskResult
      normalizeFailed = true
    }
    let repairTriggered = false

    if (handler.outputType === 'json' && (normalizeFailed || !handler.validate(result))) {
      const repairPromptPair = buildRepairPrompt(prompt.system, prompt.user, rawText)
      logPrompt('REPAIR', settings, repairPromptPair, task.task, usedSkillIds)
      const repairStartedAt = Date.now()
      rawText = await requestAiText(settings, repairPromptPair, maxTokens)
      logResponse('REPAIR', settings, task.task, rawText, Date.now() - repairStartedAt, { usedSkills: usedSkillIds })
      result = handler.normalize(rawText)
      repairTriggered = true

      if (!handler.validate(result)) {
        throw new Error('AI 返回的结构化结果不完整，请稍后重试或调整提示词。')
      }
    }

    const finishedAt = new Date().toISOString()
    return {
      result,
      meta: buildRunMeta(
        task.task,
        projectId,
        String(task.context.chapterId ?? '').trim() || undefined,
        settings,
        'success',
        startedAt,
        finishedAt,
        knowledgeContext?.usedKnowledge ?? [],
        usedSkillIds,
        repairTriggered,
        buildResponsePreview(result),
        '',
        clientKey
      )
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'AI 调用失败'
    throw Object.assign(new Error(message), {
      aiRunMeta: buildRunMeta(
        task.task,
        projectId,
        String(task.context.chapterId ?? '').trim() || undefined,
        settings,
        'error',
        startedAt,
        finishedAt,
        knowledgeContext?.usedKnowledge ?? [],
        usedSkillIds,
        false,
        '',
        message,
        clientKey
      )
    })
  }
}

export async function streamAiTask(
  task: AiTaskPayload,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  knowledgeContext?: AiTaskKnowledgeContext
): Promise<AiTaskResponse> {
  if (task.task !== 'chapter-assistant' && task.task !== 'chapter-first-draft') {
    throw new Error('当前流式输出仅支持章节创作助理和章节初稿生成。')
  }

  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const startedAt = new Date().toISOString()
  const projectId = String(task.context.projectId ?? '').trim()
  const clientKey = task.clientKey

  const taskHandler = getTaskHandler(task.task)
  await refreshRegistry(projectId || undefined).catch(() => {})
  const skills = await pickSkillsFor(task, resolveEnabledSkillOverrides(task, projectId))
  const usedSkillIds = skills.map((s) => s.id)
  logSelection(task.task, skills, knowledgeContext?.usedKnowledge ?? [])

  const input = buildPromptInput(task, skills, knowledgeContext)
  const prompt = taskHandler.buildPrompt(input)
  const maxTokens = taskHandler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task)

  logPrompt('STREAM', settings, prompt, task.task, usedSkillIds)

  try {
    const requestStartedAt = Date.now()
    const rawText = await requestAiTextStream(settings, prompt, handlers, signal, maxTokens)
    logResponse('STREAM', settings, task.task, rawText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })
    const result = taskHandler.normalize(rawText)
    const finishedAt = new Date().toISOString()
    const status = signal.aborted ? 'canceled' : 'success'

    return {
      result,
      meta: buildRunMeta(
        task.task,
        projectId,
        String(task.context.chapterId ?? '').trim() || undefined,
        settings,
        status,
        startedAt,
        finishedAt,
        knowledgeContext?.usedKnowledge ?? [],
        usedSkillIds,
        false,
        buildResponsePreview(result),
        '',
        clientKey
      )
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const status = signal.aborted ? 'canceled' : 'error'
    const message = signal.aborted ? '' : (error instanceof Error ? error.message : 'AI 流式调用失败')
    throw Object.assign(new Error(message || 'AI 流式调用失败'), {
      aiRunMeta: buildRunMeta(
        task.task,
        projectId,
        String(task.context.chapterId ?? '').trim() || undefined,
        settings,
        status,
        startedAt,
        finishedAt,
        knowledgeContext?.usedKnowledge ?? [],
        usedSkillIds,
        false,
        '',
        message,
        clientKey
      )
    })
  }
}

export async function testAiConnection(rawSettings: AppSettings): Promise<{ provider: string; model: string }> {
  const settings = normalizeSettings(rawSettings)
  validateSettings(settings)
  const probePrompt = {
    system: 'You are a connectivity probe. Reply with CONNECTED only.',
    user: 'Return CONNECTED'
  }
  logPrompt('TEST', settings, probePrompt, 'test-connection')
  const text = await requestAiText(settings, probePrompt)
  if (!text.trim()) {
    throw new Error('模型连接成功，但没有返回可读内容。')
  }
  return { provider: settings.provider, model: settings.model }
}

function resolveStructuredOptions(settings: AppSettings, outputType: 'json' | 'text'): StructuredOutputOptions | undefined {
  if (outputType !== 'json') return undefined
  const mode = probeStructuredOutputMode(settings)
  if (mode === 'prompt_only') return undefined
  return { mode }
}

function resolveEnabledSkillOverrides(
  task: AiTaskPayload,
  projectId: string
): Map<string, boolean> | undefined {
  if (!Array.isArray(task.context.projectSkills)) {
    return undefined
  }

  const enabledIds = new Set(
    task.context.projectSkills
      .map((skill) => {
        if (!skill || typeof skill !== 'object') {
          return ''
        }
        return String((skill as { id?: string }).id ?? '').trim()
      })
      .filter(Boolean)
  )

  const allSkills = getAllSkills(projectId || undefined)
  if (!allSkills.length) {
    return undefined
  }

  return new Map(allSkills.map((skill) => [skill.id, enabledIds.has(skill.id)]))
}
