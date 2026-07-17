import type {
  AiAgentStreamHandlers,
  AiKnowledgeDocumentDraft,
  AiRunUsage,
  AiTaskKnowledgeContext,
  AiTaskPayload,
  AiTaskResponse
} from '../shared-types'
import { normalizeSettings, validateSettings, resolveMaxTokens, shouldOmitMaxTokens } from '../settings'
import { getTaskHandler } from '../tasks'
import { getAllSkills, getSkillById, resolveTaskSkills } from '../skills'
import { isSkillEnabledForTask } from '../skills/task-selection'
import { addAiRunUsage, aiGenerateTextWithUsage } from '../generate'
import { buildPromptInput } from '../runtime/context-builder'
import { enrichTaskContextForGeneration } from '../runtime/task-context'
import { buildRunMeta, buildResponsePreview } from '../runtime/run-meta'
import { logPrompt, logResponse, logSelection, logError } from '../runtime/logging'
import { buildRepairPrompt } from '../prompts/repair'
import { runAgent } from './run-agent'
import { createSkillTools } from './tools/skill-tools'
import { createKnowledgeTools } from './tools/knowledge-tools'
import { createChapterTools } from './tools/chapter-tools'
import { createProjectDataTools } from './tools/project-data-tools'
import { buildAgentBehaviorRules, buildSkillIndex } from './system-prompt'
import { formatAiErrorMessage } from '../error-message'

function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

/**
 * 非流式 agent 各任务的工具循环步数上限。
 * 默认 8 步对深度任务太紧：reference-deep-analyze 要多轮读参考文件 + 项目数据，
 * outline-batch 需读大纲/角色再成稿，撞上限会被静默掐断导致结果残缺。
 */
function resolveAgentMaxSteps(taskName: AiTaskPayload['task']): number {
  switch (taskName) {
    case 'reference-deep-analyze':
      return 16
    case 'global-assistant':
      return 12
    case 'outline-batch':
      return 10
    case 'style-fingerprint-extract':
    default:
      return 8
  }
}

const NOOP_AGENT_HANDLERS: AiAgentStreamHandlers = {
  onTextDelta: () => {},
  onToolUseStart: () => {},
  onToolResult: () => {},
  onAgentStatus: () => {},
  onEditApplied: () => {},
  onEditProposed: () => {}
}

export async function runAgentTask(
  task: AiTaskPayload,
  knowledgeContext?: AiTaskKnowledgeContext
): Promise<AiTaskResponse> {
  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const startedAt = new Date().toISOString()
  const chapterId = String(task.context.chapterId ?? '').trim() || undefined

  const handler = getTaskHandler(task.task)
  const { projectId, skills: candidateSkills, usedSkillIds } = await resolveTaskSkills(task)
  logSelection(task.task, candidateSkills, knowledgeContext?.usedKnowledge ?? [])
  await enrichTaskContextForGeneration(task, settings)

  const input = buildPromptInput(task, candidateSkills, knowledgeContext)
  const prompt = handler.buildPrompt(input)
  const baseMaxTokens = handler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task) ?? 4096
  // 与流式 agent 路径保持一致：抬高输出预算下限，避免推理模型把预算耗在推理 token 上导致空输出。
  const maxTokens = shouldOmitMaxTokens(task.task) ? undefined : Math.max(baseMaxTokens, 16000)

  const candidateSkillDefs = candidateSkills
    .map((sel) => getSkillById(sel.id, projectId || undefined))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const requiredSkillDefs = candidateSkillDefs.filter((s) => s.manifest.required)
  const optionalSkillDefs = candidateSkillDefs.filter((s) => !s.manifest.required)

  const requiredSkillBlock = requiredSkillDefs.length
    ? `\n\n## 强制生效的 SKILLS（已直接注入，无需调用 skill_load）\n\n${requiredSkillDefs.map((s) => {
        const body = stripSkillFrontmatter(s.content).trim().slice(0, 2000)
        return `### ${s.name}\n${body}`
      }).join('\n\n')}`
    : ''

  const globalAssistantRules = task.task === 'global-assistant' || task.task === 'global-assistant-proposal'
    ? [
        '',
        '## Global Assistant Agent Rules',
        '',
        '- Decide which project modules to inspect before answering. Do not rely only on short summaries when the request depends on concrete project facts.',
        '- Prefer `read_project_data` without `entity_type` to get a quick index, then read only the modules that matter.',
        '- Use narrow reads whenever possible: `summary_only=true` for reconnaissance, `limit` to avoid over-reading, `entity_id` for exact entities, and `doc_key` for creative memory.',
        '- When the user asks what skills exist, what skills are enabled, or asks to summarize every skill, you must call `skill_list` first and answer from its result. The skill index above is only the current task-matched subset, not the complete registry.',
        '- Do not rely on the static skill list alone. When the task may benefit from project skills, you must decide which skills are relevant and explicitly call `skill_load` yourself before concluding.',
        '- Use `search_project` first when the user mentions a specific concept, role, event, clue, workflow artifact, or rule and you are not sure where it lives.',
        '- Treat `project_constraints` as hard boundaries and `workflow_documents` as creative memory. If they may affect the answer, inspect them before concluding.',
        '- Prefer targeted reads over loading every module. Read just enough context to answer well.',
        '- After using tools, produce a direct answer for the user instead of stopping at notes or partial findings.'
      ].join('\n')
    : ''

  const systemPrompt = `${prompt.system}${requiredSkillBlock}\n${buildSkillIndex(optionalSkillDefs)}\n${buildAgentBehaviorRules()}${globalAssistantRules}`

  const skillTools = createSkillTools({
    resolveSkill: (id) => getSkillById(id, projectId || undefined),
    listSkills: () => getAllSkills(projectId || undefined),
    resolveSkillEnabled: (skill) => isSkillEnabledForTask(task, skill.id, projectId),
    allowScriptExecution: (skill) => skill.scope === 'builtin'
  })

  const producedKnowledgeDocuments: AiKnowledgeDocumentDraft[] = []
  const referenceTitle = String(task.context.referenceTitle ?? task.context.sourceTitle ?? '').trim()
  const knowledgeTools = createKnowledgeTools({
    collectDocument: (doc) => {
      producedKnowledgeDocuments.push(doc)
    },
    defaultSourceLabel: referenceTitle || 'agent'
  })

  const chapterTools = createChapterTools({
    currentChapterId: chapterId || '',
    originalUserPrompt: String(task.context.originalUserPrompt ?? task.context.userPrompt ?? ''),
    blockVagueChapterEdit: task.task === 'global-assistant',
    onEditApplied: NOOP_AGENT_HANDLERS.onEditApplied
  })

  const projectDataTools = createProjectDataTools()

  const tools = [...skillTools, ...knowledgeTools, ...chapterTools, ...projectDataTools]
  const controller = new AbortController()

  logPrompt('AGENT_REQUEST', settings, { system: systemPrompt, user: prompt.user }, task.task, usedSkillIds)
  const requestStartedAt = Date.now()
  let totalUsage: AiRunUsage | undefined

  try {
    const loopResult = await runAgent({
      settings,
      systemPrompt,
      userPrompt: prompt.user,
      tools,
      ctx: { signal: controller.signal, projectId },
      handlers: NOOP_AGENT_HANDLERS,
      maxTokens,
      maxSteps: resolveAgentMaxSteps(task.task)
    })
    totalUsage = addAiRunUsage(totalUsage, loopResult.usage)
    logResponse('AGENT_REQUEST', settings, task.task, loopResult.finalText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })

    let rawText = loopResult.finalText
    let result: ReturnType<typeof handler.normalize>
    let normalizeFailed = false
    try {
      result = handler.normalize(rawText, task.context)
    } catch {
      result = {} as ReturnType<typeof handler.normalize>
      normalizeFailed = true
    }
    let repairTriggered = false

    if (handler.outputType === 'json' && (normalizeFailed || !handler.validate(result))) {
      const MAX_REPAIR_ATTEMPTS = 2
      for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
        const validationErrors = (!normalizeFailed && handler.describeValidationErrors)
          ? handler.describeValidationErrors(result)
          : ['JSON 解析失败或结构不完整']
        const repairPromptPair = buildRepairPrompt(prompt.system, prompt.user, rawText, validationErrors)
        logPrompt(`AGENT_REPAIR_${attempt}`, settings, repairPromptPair, task.task, usedSkillIds)
        const repairStartedAt = Date.now()
        const repairResult = await aiGenerateTextWithUsage(settings, repairPromptPair, maxTokens)
        totalUsage = addAiRunUsage(totalUsage, repairResult.usage)
        rawText = repairResult.text
        logResponse(`AGENT_REPAIR_${attempt}`, settings, task.task, rawText, Date.now() - repairStartedAt, { usedSkills: usedSkillIds })
        normalizeFailed = false
        try {
          result = handler.normalize(rawText, task.context)
        } catch {
          result = {} as ReturnType<typeof handler.normalize>
          normalizeFailed = true
        }
        repairTriggered = true

        if (!normalizeFailed && handler.validate(result)) {
          break
        }

        if (attempt === MAX_REPAIR_ATTEMPTS) {
          throw new Error('AI 返回的结构化结果经过 2 次修复仍不完整，请稍后重试或调整提示词。')
        }
      }
    }

    const finishedAt = new Date().toISOString()
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'success',
      startedAt, finishedAt,
      totalUsage,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      repairTriggered, buildResponsePreview(result), ''
    )
    meta.toolCalls = loopResult.toolCalls
    meta.agentIterations = loopResult.iterations
    if (producedKnowledgeDocuments.length > 0) {
      meta.producedKnowledgeDocuments = producedKnowledgeDocuments
    }

    return { result, meta }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = formatAiErrorMessage(error, 'AI 调用失败')
    logError('AGENT_REQUEST', settings, task.task, error, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'error',
      startedAt, finishedAt,
      totalUsage,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      false, '', message
    )
    throw Object.assign(new Error(message), { aiRunMeta: meta })
  }
}
