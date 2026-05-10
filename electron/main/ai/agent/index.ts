import type {
  AiKnowledgeDocumentDraft,
  AiTaskKnowledgeContext,
  AiTaskPayload,
  AiTaskResponse
} from '../shared-types'
import { normalizeSettings, validateSettings, resolveMaxTokens } from '../settings'
import { getTaskHandler } from '../tasks'
import { getEnabledSkills, getSkillById, pickSkillsFor, refreshRegistry } from '../skills'
import { requestAiText } from '../transport'
import { buildPromptInput } from '../runtime/context-builder'
import { buildRunMeta, buildResponsePreview } from '../runtime/run-meta'
import { logPrompt, logResponse, logSelection } from '../runtime/logging'
import { buildRepairPrompt } from '../prompts/repair'
import { runAgentLoop } from './loop'
import { createSkillTools } from './tools/skill-tools'
import { createKnowledgeTools } from './tools/knowledge-tools'
import { createToolRegistry } from './tools/registry'
import { buildAgentBehaviorRules, buildSkillIndex } from './system-prompt'

/**
 * 去掉 SKILL.md 开头的 YAML frontmatter 块（--- ... ---）。
 */
function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

/**
 * 跑一次 agent 模式的 AI 任务。签名与 `runAiTask` 对齐——上层 orchestrator 按白名单
 * 分流到这里时，调用方对返回结构没有任何感知（IPC 仍返回 AiTaskResult）。
 *
 * 流程：
 *  1. 复用 pickSkillsFor / handler.buildPrompt 拿 prompt 工程
 *  2. system prompt 末尾追加 skill index + agent 行为约束
 *  3. 用 skill tools 跑 loop
 *  4. final text 走原 handler.normalize / validate / repair
 */
export async function runAgentTask(
  task: AiTaskPayload,
  knowledgeContext?: AiTaskKnowledgeContext
): Promise<AiTaskResponse> {
  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const startedAt = new Date().toISOString()
  const projectId = String(task.context.projectId ?? '').trim()
  const chapterId = String(task.context.chapterId ?? '').trim() || undefined

  const handler = getTaskHandler(task.task)
  await refreshRegistry(projectId || undefined).catch(() => {})

  // 候选 skill 仍由现有 matcher 决定（按 task / stage / triggers / priority 打分）。
  // 不同的是：这些 skill 不再被整段 stuff 进 prompt——只暴露 id+description 作为索引，
  // 主体由模型按需通过 skill_load 加载。
  // 例外：manifest.required === true 的 skill 会被直接注入 system prompt，不依赖模型决策。
  const candidateSkills = await pickSkillsFor(task, resolveEnabledSkillOverrides(task, projectId))
  const usedSkillIds = candidateSkills.map((s) => s.id)
  logSelection(task.task, candidateSkills, knowledgeContext?.usedKnowledge ?? [])

  const input = buildPromptInput(task, candidateSkills, knowledgeContext)
  const prompt = handler.buildPrompt(input)
  const maxTokens = handler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task)

  // skill index 用 candidateSkills 的完整 SkillDefinition（pickSkillsFor 返回的是 SkillSelection 投影）
  const candidateSkillDefs = candidateSkills
    .map((sel) => getSkillById(sel.id, projectId || undefined))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  // 分离 required skills：直接注入 system prompt，不走 tool_use 加载
  const requiredSkillDefs = candidateSkillDefs.filter((s) => s.manifest.required)
  const optionalSkillDefs = candidateSkillDefs.filter((s) => !s.manifest.required)

  const requiredSkillBlock = requiredSkillDefs.length
    ? `\n\n## 强制生效的 SKILLS（已直接注入，无需调用 skill_load）\n\n${requiredSkillDefs.map((s) => {
        const body = stripSkillFrontmatter(s.content).trim().slice(0, 2000)
        return `### ${s.name}\n${body}`
      }).join('\n\n')}`
    : ''

  const systemPrompt = `${prompt.system}${requiredSkillBlock}\n${buildSkillIndex(optionalSkillDefs)}\n${buildAgentBehaviorRules()}`

  // 工具注册：模型可以按 id 加载任何已发现的 skill；matcher 只决定 index 里展示哪些。
  const skillTools = createSkillTools({
    resolveSkill: (id) => getSkillById(id, projectId || undefined),
    // PR3 阶段：只允许 builtin skill 跑脚本；project-scope skill 留给后续 settings 控制
    allowScriptExecution: (skill) => skill.scope === 'builtin'
  })

  // knowledge_save_document 工具：通过闭包收集 agent 落库的文档，loop 结束后挂到 meta
  // 上交给 IPC，IPC 通过 ai-run-event 推到 renderer，renderer 自动 merge 进 store。
  const producedKnowledgeDocuments: AiKnowledgeDocumentDraft[] = []
  const referenceTitle = String(task.context.referenceTitle ?? task.context.sourceTitle ?? '').trim()
  const knowledgeTools = createKnowledgeTools({
    collectDocument: (doc) => producedKnowledgeDocuments.push(doc),
    defaultSourceLabel: referenceTitle || 'agent'
  })

  const registry = createToolRegistry([...skillTools, ...knowledgeTools])

  // PR3 阶段：runAgentTask 通过 runAiTask 入口被调用，没有外部 cancel signal。
  // 给一个永不 abort 的 controller，未来 IPC 加 cancel 接口时再接进来。
  const controller = new AbortController()

  logPrompt('AGENT_REQUEST', settings, { system: systemPrompt, user: prompt.user }, task.task, usedSkillIds)

  try {
    const requestStartedAt = Date.now()
    const loopResult = await runAgentLoop({
      settings,
      systemPrompt,
      userPrompt: prompt.user,
      registry,
      ctx: { signal: controller.signal, projectId },
      maxTokens
    })
    logResponse('AGENT_REQUEST', settings, task.task, loopResult.finalText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })

    let rawText = loopResult.finalText
    let result = handler.normalize(rawText)
    let repairTriggered = false

    if (handler.outputType === 'json' && !handler.validate(result)) {
      // 修复走传统单次调用——agent loop 已经决定了结果，再丢回 loop 容易死循环
      const repairPromptPair = buildRepairPrompt(prompt.system, prompt.user, rawText)
      logPrompt('AGENT_REPAIR', settings, repairPromptPair, task.task, usedSkillIds)
      const repairStartedAt = Date.now()
      rawText = await requestAiText(settings, repairPromptPair, maxTokens)
      logResponse('AGENT_REPAIR', settings, task.task, rawText, Date.now() - repairStartedAt, { usedSkills: usedSkillIds })
      result = handler.normalize(rawText)
      repairTriggered = true

      if (!handler.validate(result)) {
        throw new Error('AI 返回的结构化结果不完整，请稍后重试或调整提示词。')
      }
    }

    const finishedAt = new Date().toISOString()
    const meta = buildRunMeta(
      task.task,
      projectId,
      chapterId,
      settings,
      'success',
      startedAt,
      finishedAt,
      knowledgeContext?.usedKnowledge ?? [],
      usedSkillIds,
      repairTriggered,
      buildResponsePreview(result),
      ''
    )
    meta.toolCalls = loopResult.toolCalls
    meta.agentIterations = loopResult.iterations
    if (producedKnowledgeDocuments.length > 0) {
      meta.producedKnowledgeDocuments = producedKnowledgeDocuments
    }

    return { result, meta }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'AI 调用失败'
    const meta = buildRunMeta(
      task.task,
      projectId,
      chapterId,
      settings,
      'error',
      startedAt,
      finishedAt,
      knowledgeContext?.usedKnowledge ?? [],
      usedSkillIds,
      false,
      '',
      message
    )
    throw Object.assign(new Error(message), { aiRunMeta: meta })
  }
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
        if (!skill || typeof skill !== 'object') return ''
        return String((skill as { id?: string }).id ?? '').trim()
      })
      .filter(Boolean)
  )

  const allSkills = getEnabledSkills(projectId || undefined)
  if (!allSkills.length) return undefined

  return new Map(allSkills.map((skill) => [skill.id, enabledIds.has(skill.id)]))
}
