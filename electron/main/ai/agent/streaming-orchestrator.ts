import type { AiAgentStreamHandlers, AiKnowledgeDocumentDraft, AiTaskKnowledgeContext, AiTaskPayload, AiTaskResponse } from '../shared-types'
import { AGENT_STREAM_MAX_ITERATIONS } from '../shared-types'
import { normalizeSettings, validateSettings, resolveMaxTokens } from '../settings'
import { getTaskHandler } from '../tasks'
import { resolveTaskSkills, getSkillById } from '../skills'
import { buildPromptInput } from '../runtime/context-builder'
import { enrichTaskContextForGeneration } from '../runtime/task-context'
import { buildRunMeta, buildResponsePreview } from '../runtime/run-meta'
import { logPrompt, logResponse, logError, logSelection } from '../runtime/logging'
import { runAgent } from './run-agent'
import { createSkillTools } from './tools/skill-tools'
import { createKnowledgeTools } from './tools/knowledge-tools'
import { createChapterTools } from './tools/chapter-tools'
import { createProjectDataTools } from './tools/project-data-tools'
import { buildAgentBehaviorRules, buildSkillIndex } from './system-prompt'
import { getRecentSkillUsage, formatSkillUsageHint, recordSkillUsage } from './skill-usage-memory'

/** 去掉 SKILL.md 开头的 YAML frontmatter 块（--- ... ---）。 */
function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

function resolveStreamingAgentMaxSteps(taskName: AiTaskPayload['task'], optionalSkillCount: number): number | undefined {
  if (taskName === 'chapter-first-draft') {
    const normalizedOptionalSkills = Math.max(0, Math.min(optionalSkillCount, 3))
    // 预算预留给：1 次项目数据读取 + 2-3 次 skill_load + 1-2 轮正文收束/修正。
    return Math.min(6 + normalizedOptionalSkills, AGENT_STREAM_MAX_ITERATIONS)
  }

  if (taskName === 'chapter-assistant') {
    // 创作助理：预留足够步数用于工具调用 + 最终文本回复
    // 典型流程：读取章节(1) + 读取项目数据(1-3) + 多轮推理(2-4) + 最终回复(1)
    // 设置为 20 确保复杂任务有足够余量
    return 20
  }

  if (taskName === 'global-assistant') {
    return 12
  }

  return undefined
}

/**
 * 流式 Agent 模式的 AI 任务入口。与 runAgentTask 类似，但通过 handlers 回调
 * 实时推送文本增量、工具调用状态和编辑事件，适用于前端需要流式渲染的场景。
 *
 * @param task - AI 任务载荷
 * @param handlers - 流式回调处理器（文本增量、工具状态、编辑应用等）
 * @param signal - 中止信号，支持前端取消请求
 * @param knowledgeContext - 可选的知识库上下文
 * @returns 任务结果，包含标准化输出和运行元数据
 */
export async function runStreamingAgentTask(
  task: AiTaskPayload,
  handlers: AiAgentStreamHandlers,
  signal: AbortSignal,
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
  if (task.task === 'chapter-first-draft') {
    input.skillsBlock = '（skills 已通过工具按需加载，参见 system prompt 中的索引）'
  }
  const prompt = handler.buildPrompt(input)
  const baseMaxTokens = handler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task) ?? 4096
  const maxTokens = Math.max(baseMaxTokens, 4096)

  const candidateSkillDefs = candidateSkills
    .map((sel) => getSkillById(sel.id, projectId || undefined))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const requiredSkillDefs = candidateSkillDefs.filter((s) => s.manifest.required)
  const optionalSkillDefs = candidateSkillDefs.filter((s) => !s.manifest.required)
  const maxSteps = resolveStreamingAgentMaxSteps(task.task, optionalSkillDefs.length)

  const requiredSkillBlock = requiredSkillDefs.length
    ? `\n\n## 强制生效的 SKILLS\n\n${requiredSkillDefs.map((s) => {
        const body = stripSkillFrontmatter(s.content).trim().slice(0, 2000)
        return `### ${s.name}\n${body}`
      }).join('\n\n')}`
    : ''

  const skillUsageHints = task.task === 'chapter-first-draft'
    ? await getRecentSkillUsage(projectId).then(formatSkillUsageHint).catch(() => '')
    : ''

  const enabledModules: string[] = Array.isArray(task.context.enabledContextModules) ? task.context.enabledContextModules : []
  const moduleLabels: Record<string, string> = {
    chapter: '当前章节正文（使用 read_chapter）',
    outline: '章节大纲（使用 read_project_data entity_type=outline）',
    characters: '角色设定卡（使用 read_project_data entity_type=characters）',
    worldview: '世界观设定（使用 read_project_data entity_type=worldview）',
    organizations: '组织设定（使用 read_project_data entity_type=organizations）',
    relationships: '角色关系（使用 read_project_data entity_type=relationships）',
    plotThreads: '剧情线索（使用 read_project_data entity_type=plot_threads）',
    inspiration: '灵感记录（使用 read_project_data entity_type=inspiration）',
    knowledge: '项目知识库（使用 read_project_data entity_type=knowledge）',
    deconstructionLibrary: '拆书知识库（使用 read_project_data entity_type=deconstruction_library）',
    workflowDocuments: '工作流文档（使用 read_project_data entity_type=workflow_documents）',
    projectConstraints: '项目约束（使用 read_project_data entity_type=project_constraints）'
  }
  const enabledModulesList = enabledModules
    .filter((m) => moduleLabels[m])
    .map((m) => `- ${moduleLabels[m]}`)
    .join('\n')

  const contextModulesBlock = enabledModulesList
    ? [
        '',
        '## 用户已启用的上下文模块',
        '',
        '以下模块已启用，你可以按需通过工具读取：',
        enabledModulesList,
        '',
        '根据用户的具体请求，自行判断需要读取哪些模块。不必每次都全部读取，只读取与当前任务相关的即可。'
      ].join('\n')
    : ''

  const globalAssistantRules = task.task === 'global-assistant' || task.task === 'global-assistant-proposal'
    ? [
        '',
        '## Global Assistant Agent Rules',
        '',
        '- Decide which project modules to inspect before answering. Do not rely only on short summaries when the request depends on concrete project facts.',
        '- Prefer `read_project_data` without `entity_type` to get a quick index, then read only the modules that matter.',
        '- Use narrow reads whenever possible: `summary_only=true` for reconnaissance, `limit` to avoid over-reading, `entity_id` for exact entities, and `doc_key` for workflow documents.',
        '- Do not rely on the static skill list alone. When the task may benefit from project skills, you must decide which skills are relevant and explicitly call `skill_load` yourself before concluding.',
        '- Use `search_project` first when the user mentions a specific concept, role, event, clue, workflow artifact, or rule and you are not sure where it lives.',
        '- Treat `project_constraints` as hard boundaries and `workflow_documents` as live planning artifacts. If they may affect the answer, inspect them before concluding.',
        '- Prefer targeted reads over loading every module. Read just enough context to answer well.',
        '- After using tools, produce a direct answer for the user instead of stopping at notes or partial findings.'
      ].join('\n')
    : ''

  const chapterToolRules = task.task === 'chapter-assistant' || task.task === 'chapter-first-draft'
    ? [
        '- 每次对话开始时，先用 `read_chapter` 读取当前章节内容，了解正文现状。',
        '- 涉及创作、改写、续写时，先用 `read_project_data` 或 `search_project` 读取相关设定，优先小范围读取，确保内容一致性。',
        '- 当你不确定资料在哪个模块时，先用 `search_project`；当你只需要目录或概览时，先用 `read_project_data({ summary_only: true, limit: ... })`。',
        '- 知识文档、工作流文档、项目约束都可能影响创作判断；如果请求涉及风格、流程、边界、硬性规则，应主动检查这些模块。',
        '- 【重要】当用户要求修改、改写、应用建议、执行修改时（如"改一下"、"修改吧"、"按建议改"、"应用到正文"等），你必须使用 `edit_chapter` 工具直接修改正文，而不是只输出建议文本。用户说"改"就意味着要你动手改，不是再给建议。',
        '- 修改前先用 `read_chapter` 读取当前内容，确认要修改的位置，然后用 `edit_chapter` 执行替换。',
        '- 如果用户的意图不明确（比如只是问"怎么改比较好"），可以先给建议；但一旦用户确认或要求执行，立即使用工具修改。'
      ]
    : [
        '- 只有在用户明确提到某一章、当前章节，或任务确实依赖章节正文时，才使用 `read_chapter`。',
        '- 如果没有活动章节，就不要盲目调用 `read_chapter`；先用 `list_chapters`、`search_project` 或 `read_project_data` 找到目标章节或改读别的项目资料。',
        '- 只有在用户明确要求修改章节正文，且已有活动章节或明确章节目标时，才使用 `edit_chapter`。',
        '- 当你不确定资料在哪个模块时，先用 `search_project`；当你只需要目录或概览时，先用 `read_project_data({ summary_only: true, limit: ... })`。',
        '- 知识文档、工作流文档、项目约束都可能影响判断；如果请求涉及风格、流程、边界、硬性规则，应主动检查这些模块。'
      ]

  const chapterToolsBlock = [
    '',
    '## 可用工具',
    '',
    '你可以使用以下工具访问项目数据和操作章节：',
    '- `read_project_data`: 读取项目设定与资料，支持先取索引，再按 `entity_id` / `summary_only` / `limit` / `doc_key` 精读世界观、角色、组织、关系、大纲、剧情线索、灵感、知识文档、拆书知识库、工作流文档、项目约束',
    '- `read_chapter`: 读取章节内容和元数据',
    '- `edit_chapter`: 直接编辑章节正文（替换/插入/追加）',
    '- `search_project`: 搜索项目中的世界观、角色、组织、关系、大纲、章节、剧情线索、灵感、工作流文档、项目约束等资料，并返回 `entity_type` / `entity_id`',
    '- `list_chapters`: 获取所有章节列表',
    '',
    '## 工具使用规则',
    '',
    ...chapterToolRules
  ].join('\n')

  const chapterDraftRules = task.task === 'chapter-first-draft'
    ? [
        '',
        '## 章节初稿 Agent 行为约束',
        '',
        '- 你的主要任务是生成完整章节正文，工具调用只是辅助准备。',
        '- 最多加载 2-3 个最相关的 skill，不要贪多。',
        '- 加载 skill 后立即开始写正文，不要再做额外的工具调用。',
        '- 如果 skill index 中没有明显相关的 skill，直接开始写作，不要调用任何工具。',
        '- 最终输出必须是纯正文，不要包含任何工具调用的痕迹或解释。'
      ].join('\n')
    : ''

  const systemPrompt = `${prompt.system}${requiredSkillBlock}${chapterToolsBlock}${contextModulesBlock}\n${buildSkillIndex(optionalSkillDefs)}\n${buildAgentBehaviorRules()}${globalAssistantRules}${chapterDraftRules}${skillUsageHints}`

  const skillTools = createSkillTools({
    resolveSkill: (id) => getSkillById(id, projectId || undefined),
    allowScriptExecution: (skill) => skill.scope === 'builtin'
  })

  const producedKnowledgeDocuments: AiKnowledgeDocumentDraft[] = []
  const knowledgeTools = createKnowledgeTools({
    collectDocument: (doc) => producedKnowledgeDocuments.push(doc),
    defaultSourceLabel: String(task.context.chapterTitle ?? 'agent')
  })

  const chapterTools = createChapterTools({
    currentChapterId: chapterId || '',
    onEditApplied: handlers.onEditApplied
  })

  const projectDataTools = createProjectDataTools()

  const registry = [...skillTools, ...knowledgeTools, ...chapterTools, ...projectDataTools]

  logPrompt('AGENT_STREAM', settings, { system: systemPrompt, user: prompt.user }, task.task, usedSkillIds)
  const requestStartedAt = Date.now()

  try {
    const loopResult = await runAgent({
      settings,
      systemPrompt,
      userPrompt: prompt.user,
      tools: registry,
      ctx: { signal, projectId },
      handlers,
      maxTokens,
      maxSteps
    })

    logResponse('AGENT_STREAM', settings, task.task, loopResult.finalText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })

    const result = handler.normalize(loopResult.finalText)
    const finishedAt = new Date().toISOString()
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'success',
      startedAt, finishedAt,
      loopResult.usage,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      false, buildResponsePreview(result), ''
    )
    meta.toolCalls = loopResult.toolCalls
    meta.agentIterations = loopResult.iterations
    if (producedKnowledgeDocuments.length > 0) {
      meta.producedKnowledgeDocuments = producedKnowledgeDocuments
    }

    void recordSkillUsage(projectId, task.task, loopResult.toolCalls).catch(() => {})

    return { result, meta }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'AI Agent 调用失败'
    logError('AGENT_STREAM', settings, task.task, error, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'error',
      startedAt, finishedAt,
      undefined,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      false, '', message
    )
    throw Object.assign(new Error(message), { aiRunMeta: meta })
  }
}
